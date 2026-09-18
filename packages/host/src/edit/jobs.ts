import path from "node:path";
import { eq } from "drizzle-orm";
import { ApiError, secondsToFrames, type Asset, type EditJobKind, type TenantContext } from "@agentforge/core";
import { db, editCards, editJobs, editUnplaced } from "@agentforge/db";
import { readMediaDataUrl } from "../media";
import { mediaRoot } from "../media-root";
import { withInlinedStill } from "./still-source";
import { appendOps, foldProject } from "./ops";
import { editEvents } from "./events";
import { appendEditMetric } from "./metrics";
import { mapJob } from "./projects";
import { runGenerateJob } from "./generate";
import { ensureGenerateSubmitWired, loadMediaRow } from "./wire-generate";
import { assetAbsPath, extractAudio, probe, render, silenceDetect } from "./ffmpeg/recipes";
import { transcribeAudioChunks } from "./asr";
import { log } from "../log";

export type EnqueueJobInput = {
  kind: EditJobKind;
  request: unknown;
  targetClipIds: string[];
  cardId?: string;
  model?: string;
  tier?: string;
  estimateUsd?: number | null;
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
let runnerOverride: ((job: JobRow, signal: AbortSignal, onProgress: (n: number) => void) => Promise<{ outputAssetIds: string[] }>) | null =
  null;

const FFMPEG_KINDS = new Set(["ffmpeg_op", "render", "asr"]);
const GEN_KINDS = new Set(["generate_image", "generate_video"]);

export function setEditJobRunnerForTests(
  next: ((job: JobRow, signal: AbortSignal, onProgress: (n: number) => void) => Promise<{ outputAssetIds: string[] }>) | null,
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

async function patchJob(id: string, values: Partial<typeof editJobs.$inferInsert>): Promise<JobRow> {
  const rows = await db.update(editJobs).set(values).where(eq(editJobs.id, id)).returning();
  const row = rows[0];
  if (!row) {
    throw new ApiError("not_found", "Edit job not found", 404);
  }
  return row;
}

export async function getEditJob(jobId: string): Promise<JobRow> {
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
  if (job.kind === "generate_image" || job.kind === "generate_video") {
    const request = await withInlinedStill(job.requestJson as Record<string, unknown>, (mediaId) => {
      const tenant = (job.requestJson as { tenant?: TenantContext }).tenant;
      return tenant ? readMediaDataUrl(tenant, mediaId) : Promise.resolve(null);
    });
    return runGenerateJob(job.kind, request, signal);
  }
  if (job.kind === "render") {
    const doc = await foldProject(job.projectId);
    const preset = (job.requestJson as { preset?: "h264-1080p" | "h264-720p" })?.preset ?? "h264-1080p";
    const out = await render(doc, preset);
    onProgress(1);
    return { outputAssetIds: [out.file] };
  }
  if (job.kind === "asr") {
    const doc = await foldProject(job.projectId);
    const assetId = (job.requestJson as { assetId?: string })?.assetId;
    const asset = assetId ? doc.assets[assetId] : undefined;
    if (!asset) {
      return { outputAssetIds: [] };
    }
    const extracted = await extractAudio(assetAbsPath(asset), job.projectId);
    await transcribeAudioChunks(
      extracted.files,
      (job.requestJson as { language?: string }).language,
      undefined,
      doc.workspaceId,
    );
    onProgress(1);
    return { outputAssetIds: extracted.files };
  }
  if (job.kind === "ffmpeg_op") {
    const request = job.requestJson as { recipe?: string; assetId?: string; clipId?: string; note?: string };
    const doc = await foldProject(job.projectId);
    if (request.recipe === "matchLook") {
      onProgress(1);
      const clipId = request.clipId;
      const clip = clipId ? doc.clips.find((item) => item.id === clipId) : undefined;
      const assetId = clip?.source?.assetId;
      return { outputAssetIds: assetId ? [assetId] : [] };
    }
    const asset = request.assetId ? doc.assets[request.assetId] : undefined;
    if (request.recipe === "silenceDetect" && asset) {
      await silenceDetect(assetAbsPath(asset), job.projectId, doc.fps);
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
): Promise<{ assetId: string; addOps: Array<{ type: "add_asset"; payload: unknown }> }> {
  if (outputId && doc.assets[outputId]) {
    return { assetId: outputId, addOps: [] };
  }
  if (outputId && (job.kind === "generate_image" || job.kind === "generate_video")) {
    const row = await loadMediaRow(outputId);
    if (row) {
      const assetId = crypto.randomUUID();
      const kind = row.kind === "image" || row.kind === "audio" ? row.kind : "video";
      const meta = kind === "video" ? await probeGeneratedMeta(row.storagePath, job.projectId) : {};
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
            storagePath: `edit/${job.projectId}/${assetId}.${ext}`,
          },
        },
      },
    ],
  };
}

async function completeSucceeded(job: JobRow, outputAssetIds: string[]): Promise<void> {
  const doc = await foldProject(job.projectId);
  const existing = job.targetClipIdsJson.filter((id) => doc.clips.some((clip) => clip.id === id));
  if (existing.length > 0) {
    const resolved = await resolveGenerateAsset(job, doc, outputAssetIds[0]);
    const assetId = resolved.assetId;
    const ensureAsset: Array<{ type: "add_asset"; payload: unknown } | { type: "set_source"; payload: unknown } | { type: "set_clip_status"; payload: unknown }> = [
      ...resolved.addOps,
    ];
    const ops = [
      ...ensureAsset,
      ...existing.flatMap((clipId) => [
        { type: "set_source" as const, payload: { clipId, assetId, inFrame: 0 } },
        { type: "set_clip_status" as const, payload: { clipId, status: "ready" as const } },
      ]),
    ];
    await appendOps(job.projectId, ops, { actor: "owner" });
  } else if (outputAssetIds.length > 0) {
    const resolved = await resolveGenerateAsset(job, doc, outputAssetIds[0]);
    if (resolved.addOps.length > 0) {
      await appendOps(job.projectId, resolved.addOps, { actor: "owner" });
    }
    const assetId = resolved.assetId;
    const [item] = await db
      .insert(editUnplaced)
      .values({
        id: crypto.randomUUID(),
        projectId: job.projectId,
        jobId: job.id,
        assetId,
        prompt: typeof (job.requestJson as { prompt?: unknown })?.prompt === "string"
          ? ((job.requestJson as { prompt: string }).prompt)
          : null,
      })
      .returning();
    editEvents.emitEvent({ type: "unplaced.landed", projectId: job.projectId, item });
    appendEditMetric({ projectId: job.projectId, jobId: job.id, event: "unplaced.landed" });
    if (job.cardId) {
      await db
        .update(editCards)
        .set({ status: "ready", decidedAt: new Date() })
        .where(eq(editCards.id, job.cardId));
    }
  }
  const finished = await patchJob(job.id, {
    status: "succeeded",
    progress: 1,
    outputAssetIdsJson: outputAssetIds,
    finishedAt: new Date(),
  });
  if (job.cardId && existing.length > 0) {
    await db.update(editCards).set({ status: "ready" }).where(eq(editCards.id, job.cardId));
  }
  editEvents.emitEvent({ type: "job.done", projectId: job.projectId, job: mapJob(finished) });
}

async function failJob(job: JobRow, status: "failed" | "cancelled" | "interrupted", error?: string): Promise<JobRow> {
  const finished = await patchJob(job.id, {
    status,
    error,
    finishedAt: new Date(),
    cancelRequestedAt: status === "cancelled" ? new Date() : job.cancelRequestedAt,
  });
  if (job.cardId) {
    const cardStatus = status === "cancelled" ? "undone" : "failed";
    await db.update(editCards).set({ status: cardStatus, decidedAt: new Date() }).where(eq(editCards.id, job.cardId));
    const cards = await db.select().from(editCards).where(eq(editCards.id, job.cardId)).limit(1);
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
    const doc = await foldProject(job.projectId);
    const pending = job.targetClipIdsJson.filter((id) =>
      doc.clips.some((clip) => clip.id === id && clip.status === "pending"),
    );
    if (pending.length === 0) {
      return;
    }
    await appendOps(
      job.projectId,
      pending.map((clipId) => ({ type: "set_clip_status" as const, payload: { clipId, status: "failed" as const } })),
      { actor: "owner" },
    );
  } catch (error) {
    log.warn("edit_clips_not_marked_failed", { jobId: job.id, error });
  }
}

/** Real dimensions and length of a generated video, when ffprobe is available. */
async function probeGeneratedMeta(
  storagePath: string,
  projectId: string,
): Promise<Partial<Pick<Asset, "durationFrames" | "width" | "height" | "fps" | "hasAudio">>> {
  try {
    const probed = await probe(path.join(mediaRoot(), storagePath), projectId);
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
  const job = await getEditJob(jobId);
  if (job.status !== "queued") {
    return;
  }
  await slotReady(job.kind, job.projectId);
  const controller = new AbortController();
  active.set(jobId, { controller, partials: [] });
  try {
    const running = await patchJob(jobId, { status: "running", startedAt: new Date() });
    const onProgress = (progress: number) => {
      void patchJob(jobId, { progress }).then((row) => {
        editEvents.emitEvent({ type: "job.progress", projectId: row.projectId, jobId, progress });
      });
    };
    const runner = runnerOverride ?? defaultRunner;
    const result = await runner(running, controller.signal, onProgress);
    const current = await getEditJob(jobId);
    if (current.status === "cancelled") {
      return;
    }
    await completeSucceeded(current, result.outputAssetIds);
  } catch (error) {
    const current = await getEditJob(jobId).catch(() => job);
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

export async function enqueueEditJob(projectId: string, input: EnqueueJobInput): Promise<JobRow> {
  ensureGenerateSubmitWired();
  const [row] = await db
    .insert(editJobs)
    .values({
      id: crypto.randomUUID(),
      projectId,
      kind: input.kind,
      status: "queued",
      targetClipIdsJson: input.targetClipIds,
      cardId: input.cardId,
      requestJson: input.request,
      model: input.model,
      tier: input.tier,
      estimateUsd: input.estimateUsd ?? null,
      progress: 0,
    })
    .returning();
  void processJob(row.id);
  return row;
}

export async function cancelEditJob(jobId: string, reason = "cancel"): Promise<JobRow> {
  const job = await getEditJob(jobId);
  if (job.status === "succeeded" || job.status === "failed" || job.status === "interrupted") {
    return job;
  }
  const handle = active.get(jobId);
  handle?.controller.abort();
  const finished = await failJob(job, "cancelled", reason);
  appendEditMetric({ projectId: job.projectId, jobId, event: "job.cancelled", data: { reason } });
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
