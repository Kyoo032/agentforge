import { eq } from "drizzle-orm";
import { ApiError, type EditJobKind } from "@agentforge/core";
import { db, editCards, editJobs, editUnplaced } from "@agentforge/db";
import { appendOps, foldProject } from "./ops";
import { editEvents } from "./events";
import { appendEditMetric } from "./metrics";
import { mapJob } from "./projects";
import { runGenerateJob } from "./generate";
import { assetAbsPath, extractAudio, render, silenceDetect } from "./ffmpeg/recipes";
import { transcribeAudioChunks } from "./asr";

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
    return runGenerateJob(job.kind, job.requestJson, signal);
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
    await transcribeAudioChunks(extracted.files, (job.requestJson as { language?: string }).language);
    onProgress(1);
    return { outputAssetIds: extracted.files };
  }
  if (job.kind === "ffmpeg_op") {
    const request = job.requestJson as { recipe?: string; assetId?: string };
    const doc = await foldProject(job.projectId);
    const asset = request.assetId ? doc.assets[request.assetId] : undefined;
    if (request.recipe === "silenceDetect" && asset) {
      await silenceDetect(assetAbsPath(asset), job.projectId, doc.fps);
    }
    onProgress(1);
    return { outputAssetIds: [] };
  }
  return { outputAssetIds: [] };
}

async function completeSucceeded(job: JobRow, outputAssetIds: string[]): Promise<void> {
  const doc = await foldProject(job.projectId);
  const existing = job.targetClipIdsJson.filter((id) => doc.clips.some((clip) => clip.id === id));
  if (existing.length > 0) {
    const assetId = outputAssetIds[0] ?? `asset-${job.id}`;
    const ensureAsset: Array<{ type: "add_asset"; payload: unknown } | { type: "set_source"; payload: unknown } | { type: "set_clip_status"; payload: unknown }> = [];
    if (!doc.assets[assetId]) {
      ensureAsset.push({
        type: "add_asset",
        payload: {
          asset: {
            id: assetId,
            kind: "video",
            storagePath: `edit/${job.projectId}/${assetId}.mp4`,
          },
        },
      });
    }
    const ops = [
      ...ensureAsset,
      ...existing.flatMap((clipId) => [
        { type: "set_source" as const, payload: { clipId, assetId, inFrame: 0 } },
        { type: "set_clip_status" as const, payload: { clipId, status: "ready" as const } },
      ]),
    ];
    await appendOps(job.projectId, ops, { actor: "owner" });
  } else if (outputAssetIds.length > 0) {
    const assetId = outputAssetIds[0]!;
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
  editEvents.emitEvent({ type: "job.done", projectId: job.projectId, job: mapJob(finished) });
  return finished;
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
  await interruptRunningJobsOnBoot();
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
