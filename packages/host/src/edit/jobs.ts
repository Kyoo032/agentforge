import { and, eq } from "drizzle-orm";
import { ApiError, secondsToFrames, type Asset, type EditJobKind } from "@agentforge/core";
import { db, editCards, editJobs, editUnplaced } from "@agentforge/db";
import { requireGatewayAllowedFor } from "../gateway-gate";
import { readMediaDataUrl } from "../media";
import { mediaRelativePath } from "../media-root";
import { materializeTenantObject } from "../tenant-storage";
import { withInlinedStill } from "./still-source";
import { appendOps, foldProject, workerTenant, workerTenantId, workerWorkspaceId } from "./ops";
import { editEvents } from "./events";
import { appendEditMetric } from "./metrics";
import { mapJob } from "./projects";
import { runGenerateJob } from "./generate";
import { ensureGenerateSubmitWired, loadMediaRow } from "./wire-generate";
import { assetAbsPath, extractAudio, probe, render, silenceDetect } from "./ffmpeg/recipes";
import type { EditScope } from "./ffmpeg/paths";
import { transcribeAudioChunks } from "./asr";
import { log } from "../log";

/** Every kind the queue runs — the runtime twin of `EditJobKind`, which is a type only. */
export const EDIT_JOB_KINDS = [
  "generate_image",
  "generate_video",
  "ffmpeg_op",
  "render",
  "asr",
] as const satisfies readonly EditJobKind[];

/** Fails to compile if `EditJobKind` in core gains a kind this list does not name. */
const EVERY_KIND_LISTED: Exclude<EditJobKind, (typeof EDIT_JOB_KINDS)[number]> extends never ? true : false = true;
void EVERY_KIND_LISTED;

export type GenerateJobKind = Extract<EditJobKind, "generate_image" | "generate_video">;

export function isEditJobKind(value: unknown): value is EditJobKind {
  return typeof value === "string" && (EDIT_JOB_KINDS as readonly string[]).includes(value);
}

export function isGenerateJobKind(value: unknown): value is GenerateJobKind {
  return value === "generate_image" || value === "generate_video";
}

/** A kind from a request body, or a 400. The column is plain text, so nothing below it would refuse. */
export function parseEditJobKind(value: unknown): EditJobKind {
  if (!isEditJobKind(value)) {
    throw new ApiError("invalid_request", `kind must be one of ${EDIT_JOB_KINDS.join(", ")}`, 400);
  }
  return value;
}

/**
 * Keys of a job request that name a person or a tenant. Only `enqueueEditJob` writes
 * `requestedBy`, from its own argument; neither key is ever taken from the request it is handed.
 */
const IDENTITY_KEYS = new Set(["tenant", "requestedBy"]);

/** A job request with every identity key removed. Anything that is not a plain object reads as `{}`. */
function withoutIdentity(request: unknown): Record<string, unknown> {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return {};
  }
  return Object.fromEntries(Object.entries(request).filter(([key]) => !IDENTITY_KEYS.has(key)));
}

/** Who queued the job, as `enqueueEditJob` recorded it. */
function requesterOf(requestJson: unknown): string | undefined {
  const value = (requestJson as { requestedBy?: unknown } | null)?.requestedBy;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export type EnqueueJobInput = {
  kind: EditJobKind;
  request: unknown;
  targetClipIds: string[];
  cardId?: string;
  model?: string;
  tier?: string;
  estimateUsd?: number | null;
  /**
   * The user who asked, taken from a `TenantContext` the caller has already verified — a handler's
   * `getTenant(request)`, or the agent run's own context. Recorded on the job as `requestedBy`. The
   * generate worker runs as this user inside the project's own tenant (`workerTenant`), so a job
   * with none recorded does not generate anything.
   */
  requestedBy?: string;
};

type JobRow = typeof editJobs.$inferSelect;

type ActiveJob = {
  controller: AbortController;
  partials: string[];
};

const active = new Map<string, ActiveJob>();
let ffmpegRunning = 0;
const generationByProject = new Map<string, number>();
const waiters: Array<() => void> = [];
let bootDone = false;
let runnerOverride:
  | ((job: JobRow, signal: AbortSignal, onProgress: (n: number) => void) => Promise<{ outputAssetIds: string[] }>)
  | null = null;

const FFMPEG_KINDS = new Set(["ffmpeg_op", "render", "asr"]);
const GEN_KINDS = new Set(["generate_image", "generate_video"]);

export function setEditJobRunnerForTests(
  next:
    | ((job: JobRow, signal: AbortSignal, onProgress: (n: number) => void) => Promise<{ outputAssetIds: string[] }>)
    | null,
): void {
  runnerOverride = next;
}

export function resetEditJobsForTests(): void {
  active.clear();
  ffmpegRunning = 0;
  generationByProject.clear();
  waiters.length = 0;
  bootDone = false;
  runnerOverride = null;
}

function wake(): void {
  while (waiters.length > 0) {
    waiters.shift()?.();
  }
}

async function slotReady(kind: string, projectId: string): Promise<void> {
  for (;;) {
    if (FFMPEG_KINDS.has(kind) && ffmpegRunning < 2) {
      ffmpegRunning += 1;
      return;
    }
    if (GEN_KINDS.has(kind) && (generationByProject.get(projectId) ?? 0) < 3) {
      generationByProject.set(projectId, (generationByProject.get(projectId) ?? 0) + 1);
      return;
    }
    if (!FFMPEG_KINDS.has(kind) && !GEN_KINDS.has(kind)) {
      return;
    }
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  }
}

function releaseSlot(kind: string, projectId: string): void {
  if (FFMPEG_KINDS.has(kind)) {
    ffmpegRunning = Math.max(0, ffmpegRunning - 1);
  }
  if (GEN_KINDS.has(kind)) {
    generationByProject.set(projectId, Math.max(0, (generationByProject.get(projectId) ?? 1) - 1));
  }
  wake();
}

async function patchJob(id: string, projectId: string, values: Partial<typeof editJobs.$inferInsert>): Promise<JobRow> {
  const rows = await db
    .update(editJobs)
    .set(values)
    .where(and(eq(editJobs.id, id), eq(editJobs.projectId, projectId)))
    .returning();
  const row = rows[0];
  if (!row) {
    throw new ApiError("not_found", "Edit job not found", 404);
  }
  return row;
}

/**
 * Read a job, pinned to the project it must belong to.
 *
 * A job id alone says nothing about who owns it, and `edit_jobs` carries no workspace of its own.
 * The caller has already proved the project belongs to its desk, so pinning the job to that project
 * is what keeps one desk's id from reaching another's job — and it is in the WHERE clause, so a
 * caller cannot forget the follow-up check.
 */
export async function getEditJob(jobId: string, projectId: string): Promise<JobRow> {
  const rows = await db
    .select()
    .from(editJobs)
    .where(and(eq(editJobs.id, jobId), eq(editJobs.projectId, projectId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new ApiError("not_found", "Edit job not found", 404);
  }
  return row;
}

/**
 * Read a job by id alone, for the background runner that was handed the id and nothing else.
 *
 * Nothing a request carries reaches this: `processJob` is driven by ids this module minted itself
 * in `enqueueEditJob`. Every request path must use `getEditJob(jobId, projectId)` instead.
 * `edit-scope.test.ts` asserts no handler imports it.
 */
async function workerJob(jobId: string): Promise<JobRow> {
  const rows = await db.select().from(editJobs).where(eq(editJobs.id, jobId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new ApiError("not_found", "Edit job not found", 404);
  }
  return row;
}

async function defaultRunner(
  job: JobRow,
  signal: AbortSignal,
  onProgress: (n: number) => void,
): Promise<{ outputAssetIds: string[] }> {
  onProgress(0.1);
  const workspaceId = await workerWorkspaceId(job.projectId);
  // Phase 3 lane D: scratch files and the ffmpeg allowlist are per tenant, and the worker has no
  // request to read one from. Same reasoning as `workerWorkspaceId` one line up.
  const tenantId = await workerTenantId(job.projectId);
  const scope = { tenantId, projectId: job.projectId };
  const kind = job.kind;
  if (isGenerateJobKind(kind)) {
    // Whose key, ledger, desk and media: the project's tenant and the recorded requester, never a
    // `tenant` in the stored request (`workerTenant`). The gate is applied to that tenant here as
    // well as on the route, so no way of queueing a job reaches the gateway past a closed gate.
    const tenant = await workerTenant(job.projectId, requesterOf(job.requestJson));
    requireGatewayAllowedFor(tenant);
    const request = await withInlinedStill(withoutIdentity(job.requestJson), (mediaId) =>
      readMediaDataUrl(tenant, mediaId),
    );
    return runGenerateJob(kind, request, signal, tenant);
  }
  if (job.kind === "render") {
    const doc = await foldProject(job.projectId, workspaceId);
    const preset = (job.requestJson as { preset?: "h264-1080p" | "h264-720p" })?.preset ?? "h264-1080p";
    const out = await render(tenantId, doc, preset);
    onProgress(1);
    return { outputAssetIds: [out.file] };
  }
  if (job.kind === "asr") {
    const doc = await foldProject(job.projectId, workspaceId);
    const assetId = (job.requestJson as { assetId?: string })?.assetId;
    const asset = assetId ? doc.assets[assetId] : undefined;
    if (!asset) {
      return { outputAssetIds: [] };
    }
    const extracted = await extractAudio(await assetAbsPath(tenantId, asset), scope);
    await transcribeAudioChunks(extracted.files, (job.requestJson as { language?: string }).language, undefined, {
      tenantId,
      workspaceId: doc.workspaceId,
    });
    onProgress(1);
    return { outputAssetIds: extracted.files };
  }
  if (job.kind === "ffmpeg_op") {
    const request = job.requestJson as { recipe?: string; assetId?: string; clipId?: string; note?: string };
    const doc = await foldProject(job.projectId, workspaceId);
    if (request.recipe === "matchLook") {
      onProgress(1);
      const clipId = request.clipId;
      const clip = clipId ? doc.clips.find((item) => item.id === clipId) : undefined;
      const assetId = clip?.source?.assetId;
      return { outputAssetIds: assetId ? [assetId] : [] };
    }
    const asset = request.assetId ? doc.assets[request.assetId] : undefined;
    if (request.recipe === "silenceDetect" && asset) {
      await silenceDetect(await assetAbsPath(tenantId, asset), scope, doc.fps);
    }
    onProgress(1);
    return { outputAssetIds: [] };
  }
  return { outputAssetIds: [] };
}

async function resolveGenerateAsset(
  job: JobRow,
  doc: Awaited<ReturnType<typeof foldProject>>,
  outputId: string | undefined,
  tenantId: string,
): Promise<{ assetId: string; addOps: Array<{ type: "add_asset"; payload: unknown }> }> {
  if (outputId && doc.assets[outputId]) {
    return { assetId: outputId, addOps: [] };
  }
  if (outputId && (job.kind === "generate_image" || job.kind === "generate_video")) {
    const row = await loadMediaRow(outputId);
    if (row) {
      const assetId = crypto.randomUUID();
      const kind = row.kind === "image" || row.kind === "audio" ? row.kind : "video";
      const meta =
        kind === "video" ? await probeGeneratedMeta(row.storagePath, { tenantId, projectId: job.projectId }) : {};
      return {
        assetId,
        addOps: [
          {
            type: "add_asset",
            payload: {
              asset: {
                id: assetId,
                mediaId: row.id,
                kind,
                storagePath: row.storagePath,
                ...meta,
              },
            },
          },
        ],
      };
    }
  }
  const assetId = outputId ?? `asset-${job.id}`;
  if (doc.assets[assetId]) {
    return { assetId, addOps: [] };
  }
  const kind = job.kind === "generate_image" ? "image" : "video";
  const ext = kind === "image" ? "png" : "mp4";
  return {
    assetId,
    addOps: [
      {
        type: "add_asset",
        payload: {
          asset: {
            id: assetId,
            kind,
            // Phase 6: tenant-prefixed, like every other storage path since lane D. Before this
            // it was a bare `edit/<projectId>/…`, which resolves under the media root's TOP level
            // — inside the local tenant's subtree and outside every hosted tenant's, so a hosted
            // tenant's generated asset was refused by its own containment check and answered 404.
            storagePath: mediaRelativePath(tenantId, ["edit", job.projectId], `${assetId}.${ext}`),
          },
        },
      },
    ],
  };
}

async function completeSucceeded(job: JobRow, outputAssetIds: string[]): Promise<void> {
  const workspaceId = await workerWorkspaceId(job.projectId);
  const tenantId = await workerTenantId(job.projectId);
  const doc = await foldProject(job.projectId, workspaceId);
  const existing = job.targetClipIdsJson.filter((id) => doc.clips.some((clip) => clip.id === id));
  if (existing.length > 0) {
    const resolved = await resolveGenerateAsset(job, doc, outputAssetIds[0], tenantId);
    const assetId = resolved.assetId;
    const ensureAsset: Array<
      | { type: "add_asset"; payload: unknown }
      | { type: "set_source"; payload: unknown }
      | { type: "set_clip_status"; payload: unknown }
    > = [...resolved.addOps];
    const ops = [
      ...ensureAsset,
      ...existing.flatMap((clipId) => [
        { type: "set_source" as const, payload: { clipId, assetId, inFrame: 0 } },
        { type: "set_clip_status" as const, payload: { clipId, status: "ready" as const } },
      ]),
    ];
    await appendOps(job.projectId, ops, { actor: "owner", workspaceId });
  } else if (outputAssetIds.length > 0) {
    const resolved = await resolveGenerateAsset(job, doc, outputAssetIds[0], tenantId);
    if (resolved.addOps.length > 0) {
      await appendOps(job.projectId, resolved.addOps, { actor: "owner", workspaceId });
    }
    const assetId = resolved.assetId;
    const [item] = await db
      .insert(editUnplaced)
      .values({
        id: crypto.randomUUID(),
        projectId: job.projectId,
        jobId: job.id,
        assetId,
        prompt:
          typeof (job.requestJson as { prompt?: unknown })?.prompt === "string"
            ? (job.requestJson as { prompt: string }).prompt
            : null,
      })
      .returning();
    editEvents.emitEvent({ type: "unplaced.landed", projectId: job.projectId, item });
    await appendEditMetric({ projectId: job.projectId, jobId: job.id, event: "unplaced.landed" });
    if (job.cardId) {
      await db
        .update(editCards)
        .set({ status: "ready", decidedAt: new Date() })
        .where(and(eq(editCards.id, job.cardId), eq(editCards.projectId, job.projectId)));
    }
  }
  const finished = await patchJob(job.id, job.projectId, {
    status: "succeeded",
    progress: 1,
    outputAssetIdsJson: outputAssetIds,
    finishedAt: new Date(),
  });
  if (job.cardId && existing.length > 0) {
    await db
      .update(editCards)
      .set({ status: "ready" })
      .where(and(eq(editCards.id, job.cardId), eq(editCards.projectId, job.projectId)));
  }
  editEvents.emitEvent({ type: "job.done", projectId: job.projectId, job: mapJob(finished) });
}

async function failJob(job: JobRow, status: "failed" | "cancelled" | "interrupted", error?: string): Promise<JobRow> {
  const finished = await patchJob(job.id, job.projectId, {
    status,
    error,
    finishedAt: new Date(),
    cancelRequestedAt: status === "cancelled" ? new Date() : job.cancelRequestedAt,
  });
  if (job.cardId) {
    const cardStatus = status === "cancelled" ? "undone" : "failed";
    const cardScope = and(eq(editCards.id, job.cardId), eq(editCards.projectId, job.projectId));
    await db.update(editCards).set({ status: cardStatus, decidedAt: new Date() }).where(cardScope);
    const cards = await db.select().from(editCards).where(cardScope).limit(1);
    if (cards[0]) {
      editEvents.emitEvent({ type: "card.updated", projectId: job.projectId, card: cards[0] });
    }
  }
  await markPendingTargetsFailed(job);
  editEvents.emitEvent({ type: "job.done", projectId: job.projectId, job: mapJob(finished) });
  return finished;
}

/** A failed generation must not leave its placeholder clips shimmering "pending" forever. */
async function markPendingTargetsFailed(job: JobRow): Promise<void> {
  try {
    const workspaceId = await workerWorkspaceId(job.projectId);
    const doc = await foldProject(job.projectId, workspaceId);
    const pending = job.targetClipIdsJson.filter((id) =>
      doc.clips.some((clip) => clip.id === id && clip.status === "pending"),
    );
    if (pending.length === 0) {
      return;
    }
    await appendOps(
      job.projectId,
      pending.map((clipId) => ({ type: "set_clip_status" as const, payload: { clipId, status: "failed" as const } })),
      { actor: "owner", workspaceId },
    );
  } catch (error) {
    log.warn("edit_clips_not_marked_failed", { jobId: job.id, error });
  }
}

/** Real dimensions and length of a generated video, when ffprobe is available. */
async function probeGeneratedMeta(
  storagePath: string,
  scope: EditScope,
): Promise<Partial<Pick<Asset, "durationFrames" | "width" | "height" | "fps" | "hasAudio">>> {
  try {
    const probed = await probe(await materializeTenantObject(scope.tenantId, storagePath), scope);
    return {
      durationFrames: Math.max(1, secondsToFrames(probed.durationSeconds || 1 / 30, probed.fps || 30)),
      width: probed.width,
      height: probed.height,
      fps: probed.fps,
      hasAudio: probed.hasAudio,
    };
  } catch {
    return {};
  }
}

async function processJob(jobId: string): Promise<void> {
  const job = await workerJob(jobId);
  if (job.status !== "queued") {
    return;
  }
  await slotReady(job.kind, job.projectId);
  const controller = new AbortController();
  active.set(jobId, { controller, partials: [] });
  try {
    const running = await patchJob(jobId, job.projectId, { status: "running", startedAt: new Date() });
    const onProgress = (progress: number) => {
      void patchJob(jobId, job.projectId, { progress }).then((row) => {
        editEvents.emitEvent({ type: "job.progress", projectId: row.projectId, jobId, progress });
      });
    };
    const runner = runnerOverride ?? defaultRunner;
    const result = await runner(running, controller.signal, onProgress);
    const current = await workerJob(jobId);
    if (current.status === "cancelled") {
      return;
    }
    await completeSucceeded(current, result.outputAssetIds);
  } catch (error) {
    const current = await workerJob(jobId).catch(() => job);
    if (current.status === "cancelled") {
      return;
    }
    const message = error instanceof ApiError ? error.message : "job failed";
    await failJob(current, "failed", message);
  } finally {
    active.delete(jobId);
    releaseSlot(job.kind, job.projectId);
  }
}

/**
 * Queue a job on a project the caller has already scoped to its desk.
 *
 * The stored request never carries identity. Whatever `tenant` or `requestedBy` the caller's request
 * held — from a body on `POST …/jobs`, or put there by an agent tool — is dropped, and `requestedBy`
 * is written from `input.requestedBy` alone, which the caller took from a verified tenant.
 */
export async function enqueueEditJob(projectId: string, input: EnqueueJobInput): Promise<JobRow> {
  ensureGenerateSubmitWired();
  const kind = parseEditJobKind(input.kind);
  const request = withoutIdentity(input.request);
  const [row] = await db
    .insert(editJobs)
    .values({
      id: crypto.randomUUID(),
      projectId,
      kind,
      status: "queued",
      targetClipIdsJson: input.targetClipIds,
      cardId: input.cardId,
      requestJson: input.requestedBy ? { ...request, requestedBy: input.requestedBy } : request,
      model: input.model,
      tier: input.tier,
      estimateUsd: input.estimateUsd ?? null,
      progress: 0,
    })
    .returning();
  void processJob(row.id);
  return row;
}

export async function cancelEditJob(jobId: string, projectId: string, reason = "cancel"): Promise<JobRow> {
  const job = await getEditJob(jobId, projectId);
  if (job.status === "succeeded" || job.status === "failed" || job.status === "interrupted") {
    return job;
  }
  const handle = active.get(jobId);
  handle?.controller.abort();
  const finished = await failJob(job, "cancelled", reason);
  await appendEditMetric({ projectId: job.projectId, jobId, event: "job.cancelled", data: { reason } });
  editEvents.emitEvent({ type: "job.cancelled", projectId: job.projectId, jobId, reason });
  return finished;
}

export async function interruptRunningJobsOnBoot(): Promise<void> {
  if (bootDone) {
    return;
  }
  bootDone = true;
  const running = await db.select().from(editJobs).where(eq(editJobs.status, "running"));
  for (const job of running) {
    await failJob(job, "interrupted", "host restarted");
  }
}

export { mapJob };
