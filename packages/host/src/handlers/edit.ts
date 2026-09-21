import path from "node:path";
import { and, eq } from "drizzle-orm";
import { ApiError, isServerMode, modeMessage, videoCapabilities, type TenantContext } from "@agentforge/core";
import { db, editUnplaced, media } from "@agentforge/db";
import { jsonError, jsonOk } from "../errors";
import { requireGatewayAllowedFor } from "../gateway-gate";
import { getTenant } from "../tenant";
import { mediaRelativePath } from "../media-root";
import { materializeTenantObject, putTenantObject, removeTenantObject } from "../tenant-storage";
import type { HostRequest, HostResult } from "../types";
import { getEditDoctor } from "../edit/doctor";
import { createEditProject, getEditProjectBundle, listEditProjects, mapJob, mapUnplaced } from "../edit/projects";
import { appendOps, foldProject } from "../edit/ops";
import { keepCard, undoCard } from "../edit/undo";
import { cancelEditJob, enqueueEditJob, getEditJob, interruptRunningJobsOnBoot } from "../edit/jobs";
import { ensureGenerateSubmitWired } from "../edit/wire-generate";
import { startGenerateJob } from "../edit/start-generate";
import { runEditAgent } from "../edit/agent-run";
import { encodeEditSse, subscribeProjectEvents } from "../edit/events";
import { reviewGateOpen } from "../edit/review";
import { foldEditMetrics } from "../edit/metrics";
import { renderParityFrame } from "../edit/parity";
import { probe } from "../edit/ffmpeg/recipes";
import { importedClipDurationFrames, STILL_IMAGE_SECONDS } from "../edit/import-duration";
import { localeForRun } from "../run-context";

export const EDIT_UPLOAD_MAX = 500 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/wav", "audio/aac", "audio/mp4"]);

function transportOf(request: HostRequest): string {
  return (request.headers["x-agentforge-transport"] ?? "").toLowerCase();
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function kindFromMime(mime: string): "image" | "video" | "audio" | null {
  if (IMAGE_TYPES.has(mime)) {
    return "image";
  }
  if (VIDEO_TYPES.has(mime)) {
    return "video";
  }
  if (AUDIO_TYPES.has(mime)) {
    return "audio";
  }
  return null;
}

function extFor(mime: string): string {
  if (mime === "video/quicktime") {
    return "mov";
  }
  if (mime === "audio/mpeg") {
    return "mp3";
  }
  if (mime === "audio/wav") {
    return "wav";
  }
  if (mime === "audio/aac") {
    return "aac";
  }
  return mime.split("/")[1] ?? "bin";
}

async function saveEditFile(
  tenant: TenantContext,
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<{ id: string; kind: "image" | "video" | "audio"; storagePath: string; url: string; sizeBytes: number }> {
  assertEditUpload(mime, bytes.byteLength);
  const kind = kindFromMime(mime)!;
  const id = crypto.randomUUID();
  const relative = mediaRelativePath(tenant.tenantId, [tenant.organizationId], `${id}.${extFor(mime)}`);
  // Through the object store, like every other media writer: it is what applies the tenant's
  // ceiling (a 500 MB Edit import is the largest single write the product takes), moves the
  // counter, and puts the bytes where `GET /api/v1/media/:id/file` will look for them. Writing the
  // media root directly left this route unmetered, and under the COS backend it left the file on a
  // disk the reader never consults, so an import answered 201 and then 404'd on playback.
  await putTenantObject(tenant.tenantId, relative, bytes, mime);
  const url = `/api/v1/media/${id}/file`;
  await db.insert(media).values({
    id,
    organizationId: tenant.organizationId,
    userId: tenant.userId,
    kind,
    mime,
    sizeBytes: bytes.byteLength,
    storagePath: relative,
    url,
  });
  void filename;
  return { id, kind, storagePath: relative, url, sizeBytes: bytes.byteLength };
}

export async function handleGetEditDoctor(request?: HostRequest): Promise<HostResult> {
  const recheck = request?.query.recheck === "1" || request?.query.recheck === "true";
  return jsonOk(getEditDoctor({ recheck }));
}

export async function handleGetEditProjects(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    return jsonOk({ items: await listEditProjects(tenant) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEditProjects(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = asRecord(request.body);
    const project = await createEditProject(tenant, {
      name: typeof body.name === "string" ? body.name : undefined,
      aspect: typeof body.aspect === "string" ? body.aspect : undefined,
      fps: typeof body.fps === "number" ? body.fps : undefined,
      starterId: typeof body.starterId === "string" ? body.starterId : undefined,
    });
    return jsonOk(project, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetEditProject(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    return jsonOk(await getEditProjectBundle(tenant, request.params.projectId));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEditOps(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    await foldProject(request.params.projectId, tenant.workspaceId);
    const body = asRecord(request.body);
    const ops = Array.isArray(body.ops) ? body.ops : [];
    const result = await appendOps(
      request.params.projectId,
      ops.map((op) => {
        const row = asRecord(op);
        return {
          type: String(row.type),
          payload: row.payload,
          cardId: typeof row.cardId === "string" ? row.cardId : undefined,
          undoOf: typeof row.undoOf === "string" ? row.undoOf : undefined,
        };
      }),
      {
        actor: "owner",
        workspaceId: tenant.workspaceId,
        parent: typeof body.parent === "string" ? body.parent : null,
        clock: typeof body.clock === "number" ? body.clock : undefined,
      },
    );
    return jsonOk({ applied: result.applied, seq: result.seq });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEditUndo(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Scope first: without it another desk's project id is enough to rewind this one.
    await foldProject(request.params.projectId, tenant.workspaceId);
    const body = asRecord(request.body);
    const cardId = typeof body.cardId === "string" ? body.cardId : "";
    if (!cardId) {
      return jsonOk({ error: { code: "invalid_request", message: "cardId is required" } }, 400);
    }
    return jsonOk(await undoCard(request.params.projectId, cardId, tenant.workspaceId));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEditKeep(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    await foldProject(request.params.projectId, tenant.workspaceId);
    return jsonOk(await keepCard(request.params.projectId, request.params.cardId, tenant.workspaceId));
  } catch (error) {
    return jsonError(error);
  }
}

/** Reason code and message for a file path the hosted service will not read. */
export const LOCAL_PATH_DISABLED_CODE = "local_path_disabled";
export const LOCAL_PATH_DISABLED_MESSAGE =
  "Importing by file path is not available on the hosted service, because the path would be a " +
  "path on the server rather than on your machine. Upload the file instead.";

export async function handlePostEditImport(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const projectId = request.params.projectId;
    const doc = await foldProject(projectId, tenant.workspaceId);
    const body = asRecord(request.body);
    let bytes: Uint8Array | undefined;
    let mime = "application/octet-stream";
    let filename = "upload.bin";
    if (typeof body.sourcePath === "string") {
      /*
       * Phase 8 — a path is a desktop idea, and the hosted server refuses it by name.
       *
       * The transport check below has kept this branch off HTTP since it was written, and it is
       * still the rule for the desktop and webdev. What it does not do is SAY anything: a hosted
       * tenant who sends a path gets `invalid_request`, the same answer a typo gets, and the
       * refusal reads as an accident of plumbing rather than as policy. It is policy — reading a
       * caller-named path off the server's own filesystem is the whole of what a hosted deployment
       * must never do — so in server mode it gets its own code, checked first, and a capability
       * flag (`localPaths`) that tells the renderer not to offer the picker at all.
       *
       * Belt and braces on purpose. `nativeFilePicker` hides the button, `localPaths` says why,
       * this refuses the route, and the transport check refuses it again for anything that is not
       * the packaged shell. A hidden button is a courtesy; the refusal is the control.
       */
      if (isServerMode()) {
        return jsonOk(
          {
            error: {
              code: LOCAL_PATH_DISABLED_CODE,
              message: LOCAL_PATH_DISABLED_MESSAGE,
            },
          },
          403,
        );
      }
      if (transportOf(request) !== "ipc") {
        return jsonOk({ error: { code: "invalid_request", message: "sourcePath is only valid over IPC" } }, 400);
      }
      const { readFile } = await import("node:fs/promises");
      const buf = await readFile(body.sourcePath);
      bytes = new Uint8Array(buf);
      filename = path.basename(body.sourcePath);
      const ext = path.extname(filename).toLowerCase();
      mime =
        ext === ".mp4"
          ? "video/mp4"
          : ext === ".webm"
            ? "video/webm"
            : ext === ".mov"
              ? "video/quicktime"
              : ext === ".png"
                ? "image/png"
                : ext === ".jpg" || ext === ".jpeg"
                  ? "image/jpeg"
                  : ext === ".mp3"
                    ? "audio/mpeg"
                    : ext === ".wav"
                      ? "audio/wav"
                      : ext === ".aac"
                        ? "audio/aac"
                        : ext === ".m4a"
                          ? "audio/mp4"
                          : "application/octet-stream";
    } else {
      const file = request.files?.find((item) => item.field === "file") ?? request.files?.[0];
      if (!file) {
        return jsonOk(
          { error: { code: "invalid_request", message: modeMessage("editFileRequired", localeForRun()) } },
          400,
        );
      }
      bytes = file.bytes;
      mime = file.mime;
      filename = file.filename;
    }
    const saved = await saveEditFile(tenant, bytes, mime, filename);
    // ffprobe takes a path, so the object is materialized: under the file backend that is the
    // object itself, under COS a cached copy in the tenant's own cache root.
    const abs = await materializeTenantObject(tenant.tenantId, saved.storagePath);
    let probed: Awaited<ReturnType<typeof probe>>;
    try {
      probed = await probe(abs, { tenantId: tenant.tenantId, projectId });
    } catch {
      try {
        // Through the store so the refund reaches the counter; the bytes are unreadable either way.
        await removeTenantObject(tenant.tenantId, saved.storagePath);
      } catch {
        // ignore
      }
      return jsonOk(
        { error: { code: "unsupported_media", message: modeMessage("editMediaUnreadable", localeForRun()) } },
        400,
      );
    }
    const assetId = crypto.randomUUID();
    const clipId = crypto.randomUUID();
    const durationFrames = importedClipDurationFrames({
      kind: saved.kind,
      probedSeconds: probed.durationSeconds,
      probedFps: probed.fps,
      projectFps: doc.fps,
    });
    const trackId = saved.kind === "audio" ? "a1" : "v1";
    const applied = await appendOps(
      projectId,
      [
        {
          type: "add_asset",
          payload: {
            asset: {
              id: assetId,
              mediaId: saved.id,
              kind: saved.kind,
              storagePath: saved.storagePath,
              durationFrames,
              width: probed.width,
              height: probed.height,
              fps: probed.fps,
              hasAudio: probed.hasAudio,
              probe: { codec: probed.codec, sampleRate: probed.sampleRate },
            },
          },
        },
        {
          type: "add_clip",
          payload: {
            clip: {
              id: clipId,
              trackId,
              timelineStartFrame: 0,
              durationFrames,
              source: { assetId, inFrame: 0 },
              status: "ready",
            },
          },
        },
      ],
      { actor: "owner", workspaceId: tenant.workspaceId },
    );
    return jsonOk({ asset: applied.doc.assets[assetId], op: applied.applied[0], clipId }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEditAgent(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    const body = asRecord(request.body);
    const text = typeof body.text === "string" ? body.text : "";
    const events = await runEditAgent({
      tenant,
      projectId: request.params.projectId,
      text,
      abortSignal: request.abortSignal,
    });
    return { type: "stream", status: 200, events };
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetEditEvents(request: HostRequest): Promise<HostResult> {
  const projectId = request.params.projectId;
  try {
    // The stream carries every op on the project, so the desk check belongs before the first frame.
    const tenant = await getTenant(request);
    await foldProject(projectId, tenant.workspaceId);
  } catch (error) {
    return jsonError(error);
  }
  const abort = request.abortSignal;
  const events = (async function* () {
    const queue: string[] = [];
    let notify: (() => void) | null = null;
    const unsub = subscribeProjectEvents(projectId, (event) => {
      queue.push(encodeEditSse(event));
      notify?.();
    });
    try {
      yield encodeEditSse({ type: "hello", projectId });
      while (!abort?.aborted) {
        if (queue.length > 0) {
          yield queue.shift() as string;
          continue;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
          abort?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    } finally {
      unsub();
    }
  })();
  return { type: "stream", status: 200, events };
}

export async function handlePostEditJobs(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    await foldProject(request.params.projectId, tenant.workspaceId);
    const body = asRecord(request.body);
    const job = await enqueueEditJob(request.params.projectId, {
      kind: body.kind as "ffmpeg_op",
      request: body.request,
      targetClipIds: Array.isArray(body.targetClipIds) ? body.targetClipIds.map(String) : [],
      cardId: typeof body.cardId === "string" ? body.cardId : undefined,
    });
    return jsonOk(mapJob(job), 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetEditJob(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    await foldProject(request.params.projectId, tenant.workspaceId);
    return jsonOk(mapJob(await getEditJob(request.params.jobId, request.params.projectId)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEditJobCancel(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    await foldProject(request.params.projectId, tenant.workspaceId);
    await getEditJob(request.params.jobId, request.params.projectId);
    return jsonOk(mapJob(await cancelEditJob(request.params.jobId, request.params.projectId)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEditExport(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const doc = await foldProject(request.params.projectId, tenant.workspaceId);
    if (!reviewGateOpen(doc.review)) {
      return jsonOk({ error: { code: "review_required", message: "Review the timeline before export" } }, 400);
    }
    const body = asRecord(request.body);
    const preset = body.preset === "h264-720p" ? "h264-720p" : "h264-1080p";
    const job = await enqueueEditJob(request.params.projectId, {
      kind: "render",
      request: { preset },
      targetClipIds: [],
    });
    return jsonOk(mapJob(job), 202);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetEditExportFile(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    await foldProject(request.params.projectId, tenant.workspaceId);
    const job = await getEditJob(request.params.jobId, request.params.projectId);
    const file = job.outputAssetIdsJson?.[0];
    if (!file || job.status !== "succeeded") {
      return jsonOk({ error: { code: "not_found", message: "Export is not ready" } }, 404);
    }
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(file);
    return {
      type: "bytes",
      status: 200,
      bytes: new Uint8Array(bytes),
      contentType: "video/mp4",
      filename: "export.mp4",
    };
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEditUnplacedPlace(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const projectId = request.params.projectId;
    const doc = await foldProject(projectId, tenant.workspaceId);
    const body = asRecord(request.body);
    const rows = await db
      .select()
      .from(editUnplaced)
      .where(and(eq(editUnplaced.id, request.params.itemId), eq(editUnplaced.projectId, projectId)))
      .limit(1);
    const item = rows[0];
    if (!item) {
      return jsonOk({ error: { code: "not_found", message: "Unplaced item not found" } }, 404);
    }
    const clipId = crypto.randomUUID();
    const placedAsset = doc.assets[item.assetId];
    const durationFrames = placedAsset?.durationFrames ?? Math.max(1, Math.round(doc.fps * STILL_IMAGE_SECONDS));
    const applied = await appendOps(
      projectId,
      [
        {
          type: "add_clip",
          payload: {
            clip: {
              id: clipId,
              trackId: typeof body.trackId === "string" ? body.trackId : "v1",
              timelineStartFrame: typeof body.timelineStartFrame === "number" ? body.timelineStartFrame : 0,
              durationFrames,
              source: { assetId: item.assetId, inFrame: 0 },
              status: "ready",
            },
          },
        },
      ],
      { actor: "owner", workspaceId: tenant.workspaceId },
    );
    await db
      .update(editUnplaced)
      .set({ placedClipId: clipId })
      .where(and(eq(editUnplaced.id, item.id), eq(editUnplaced.projectId, projectId)));
    return jsonOk({ applied: applied.applied, item: { ...mapUnplaced(item), placedClipId: clipId } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEditUnplacedDiscard(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const projectId = request.params.projectId;
    // Scope first, exactly as ...Place does: edit_unplaced carries only project_id, so without this
    // the item id alone would soft-delete and read back another desk's row.
    await foldProject(projectId, tenant.workspaceId);
    const rows = await db
      .update(editUnplaced)
      .set({ discardedAt: new Date() })
      .where(and(eq(editUnplaced.id, request.params.itemId), eq(editUnplaced.projectId, projectId)))
      .returning();
    if (!rows[0]) {
      return jsonOk({ error: { code: "not_found", message: "Unplaced item not found" } }, 404);
    }
    return jsonOk(mapUnplaced(rows[0]));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostEditParity(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = asRecord(request.body);
    const frame = typeof body.frame === "number" ? body.frame : 0;
    const result = await renderParityFrame(request.params.projectId, frame, tenant);
    return jsonOk({
      frame: result.frame,
      width: result.width,
      height: result.height,
      contentType: result.contentType,
      pngBase64: Buffer.from(result.bytes).toString("base64"),
      titleBox: result.titleBox,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetEditMetrics(request: HostRequest): Promise<HostResult> {
  const range = request.query.range === "day" || request.query.range === "month" ? request.query.range : "week";
  return jsonOk(foldEditMetrics(range));
}

export async function handlePostEditGenerate(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    const projectId = request.params.projectId;
    await foldProject(projectId, tenant.workspaceId);
    const body = asRecord(request.body);
    const kind = body.kind === "image" || body.kind === "generate_image" ? "generate_image" : "generate_video";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return jsonOk({ error: { code: "invalid_request", message: "prompt is required" } }, 400);
    }
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : undefined;
    const model = typeof body.model === "string" ? body.model : undefined;
    if (kind === "generate_video" && imageUrl && model && !videoCapabilities(model).imageToVideo) {
      return jsonOk(
        { error: { code: "video_still_unsupported", message: "This model does not accept a still image" } },
        400,
      );
    }
    const placeAt =
      body.placeAt && typeof body.placeAt === "object"
        ? {
            trackId: String((body.placeAt as { trackId?: unknown }).trackId ?? "v1"),
            timelineStartFrame:
              typeof (body.placeAt as { timelineStartFrame?: unknown }).timelineStartFrame === "number"
                ? (body.placeAt as { timelineStartFrame: number }).timelineStartFrame
                : 0,
          }
        : undefined;
    const result = await startGenerateJob(
      tenant,
      projectId,
      {
        kind,
        prompt,
        aspect: typeof body.aspect === "string" ? body.aspect : undefined,
        tier: body.tier === "draft" || body.tier === "standard" || body.tier === "cinematic" ? body.tier : undefined,
        model,
        seconds: typeof body.seconds === "number" ? body.seconds : undefined,
        imageUrl,
        imageAssetId: typeof body.imageAssetId === "string" ? body.imageAssetId : undefined,
        count: typeof body.count === "number" ? body.count : undefined,
        placeAt,
        toolKey: kind,
      },
      { runId: "owner" },
    );
    return jsonOk(result, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleBootEditJobs(): Promise<void> {
  ensureGenerateSubmitWired();
  await interruptRunningJobsOnBoot();
}

export function assertEditUpload(mime: string, size: number): void {
  if (size > EDIT_UPLOAD_MAX) {
    throw new ApiError("invalid_request", "File exceeds 500 MB", 400);
  }
  if (!kindFromMime(mime)) {
    throw new ApiError("unsupported_content_type", "Unsupported media type", 400);
  }
}
