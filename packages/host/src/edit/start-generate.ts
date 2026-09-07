import { eq } from "drizzle-orm";
import {
  ApiError,
  estimateJobUsd,
  imageToVideoForModel,
  routeEditModel,
  secondsToFrames,
  type Clip,
  type EditProject,
  type EditStartGenerateJobInput,
  type EditStartGenerateJobResult,
  type TenantContext,
} from "@agentforge/core";
import { db, editCards } from "@agentforge/db";
import { listImageModels, listVideoModels } from "../selectable-models";
import { appendOps, foldProject, writeSnapshot } from "./ops";
import { enqueueEditJob } from "./jobs";
import { mapCard, mapJob } from "./projects";
import { editEvents } from "./events";
import { loadMediaRow } from "./wire-generate";

function imageAspectForEdit(aspect: "16:9" | "9:16" | "1:1"): "square" | "landscape" | "portrait" {
  if (aspect === "9:16") {
    return "portrait";
  }
  if (aspect === "1:1") {
    return "square";
  }
  return "landscape";
}

function timelineTailFrame(project: EditProject, trackId = "v1"): number {
  let end = 0;
  for (const clip of project.clips) {
    if (clip.trackId === trackId) {
      end = Math.max(end, clip.timelineStartFrame + clip.durationFrames);
    }
  }
  return end;
}

function stillClipDurationFrames(project: EditProject): number {
  return Math.max(1, project.fps);
}

function projectAspect(doc: EditProject): "16:9" | "9:16" | "1:1" {
  if (doc.width === doc.height) {
    return "1:1";
  }
  return doc.width > doc.height ? "16:9" : "9:16";
}

function asSubmitUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    new URL(url);
    return url;
  } catch {
    return undefined;
  }
}

function liveModelIds(extra?: string): string[] {
  const ids = [...listImageModels(), ...listVideoModels()].map((model) => model.id);
  if (extra && !ids.includes(extra)) {
    ids.push(extra);
  }
  return ids;
}

function routeModel(input: EditStartGenerateJobInput, requireImageToVideo: boolean): string {
  const kind = input.kind === "generate_image" ? "image" : "video";
  const tier = input.tier ?? "standard";
  const routed = routeEditModel({
    kind,
    tier,
    liveModelIds: liveModelIds(input.model),
    requireImageToVideo,
  });
  return routed ?? input.model ?? (kind === "image" ? "gpt-image-2" : "grok-imagine-video");
}

async function resolveStillUrl(doc: EditProject, input: EditStartGenerateJobInput): Promise<string | undefined> {
  const direct = asSubmitUrl(input.imageUrl);
  if (direct) {
    return direct;
  }
  if (!input.imageAssetId) {
    return undefined;
  }
  const asset = doc.assets[input.imageAssetId];
  if (!asset?.mediaId) {
    return undefined;
  }
  const row = await loadMediaRow(asset.mediaId);
  return asSubmitUrl(row?.url) ?? asSubmitUrl(`https://local.invalid/api/v1/media/${asset.mediaId}/file`);
}

function nextClipId(): string {
  return crypto.randomUUID();
}

function placeholderClips(doc: EditProject, input: EditStartGenerateJobInput, model: string): Clip[] {
  const toolKey = input.toolKey ?? input.kind;
  const count = Math.min(4, Math.max(1, input.count ?? 1));
  const aspectTrack = input.placeAt?.trackId ?? "v1";
  const fps = doc.fps;
  const videoSeconds = input.addSeconds ?? input.seconds ?? 5;
  const duration =
    toolKey === "extend_clip"
      ? Math.max(1, secondsToFrames(input.addSeconds ?? 4, fps))
      : input.kind === "generate_image"
        ? stillClipDurationFrames(doc)
        : Math.max(1, secondsToFrames(videoSeconds, fps));
  const parent = input.clipId ? doc.clips.find((clip) => clip.id === input.clipId) : undefined;

  if (toolKey === "regenerate_clip" && parent) {
    return [
      {
        ...parent,
        status: "pending",
        lineage: {
          parentClipId: parent.id,
          prompt: input.prompt,
          model,
          tier: input.tier ?? parent.lineage?.tier,
          ingredientIds: input.ingredientIds ?? parent.lineage?.ingredientIds,
        },
      },
    ];
  }

  const clips: Clip[] = [];
  let start =
    input.placeAt?.timelineStartFrame ??
    (parent ? parent.timelineStartFrame + parent.durationFrames : timelineTailFrame(doc, aspectTrack));
  const n = toolKey === "variations" || toolKey === "extend_clip" ? count : count;
  for (let i = 0; i < n; i += 1) {
    clips.push({
      id: nextClipId(),
      trackId: aspectTrack,
      timelineStartFrame: start,
      durationFrames: duration,
      status: "pending",
      fallbackAssetId: input.imageAssetId,
      lineage: {
        parentClipId: parent?.id,
        prompt: input.prompt,
        model,
        tier: input.tier,
        ingredientIds: input.ingredientIds,
      },
    });
    start += duration;
  }
  return clips;
}

export async function startGenerateJob(
  tenant: TenantContext,
  projectId: string,
  input: EditStartGenerateJobInput,
  options: { runId?: string } = {},
): Promise<EditStartGenerateJobResult> {
  const doc = await foldProject(projectId, tenant.workspaceId);
  const hasStill = Boolean(input.imageUrl || input.imageAssetId);
  const model = routeModel(input, input.kind === "generate_video" && hasStill);
  if (input.kind === "generate_video" && hasStill && !imageToVideoForModel(model)) {
    throw new ApiError("video_still_unsupported", "This model does not accept a still image", 400);
  }
  const imageUrl = hasStill ? await resolveStillUrl(doc, input) : undefined;
  const aspect = input.aspect && ["16:9", "9:16", "1:1"].includes(input.aspect) ? input.aspect : projectAspect(doc);
  const count = Math.min(4, Math.max(1, input.count ?? 1));
  const seconds = input.addSeconds ?? input.seconds ?? (input.kind === "generate_video" ? 5 : undefined);
  const estimateUsd = estimateJobUsd(model, {
    seconds,
    count,
    resolution: "720p",
  });
  const clips = placeholderClips(doc, input, model);
  const cardId = crypto.randomUUID();
  const runId = options.runId ?? "owner";
  const actor = runId === "owner" ? ("owner" as const) : (`agent:${runId}` as const);
  const toolKey = input.toolKey ?? input.kind;
  const [cardRow] = await db
    .insert(editCards)
    .values({
      id: cardId,
      projectId,
      runId,
      toolKey,
      verb: toolKey.replaceAll("_", " "),
      object: input.prompt.slice(0, 80),
      opIdsJson: [],
      status: "pending",
      thumbsJson: [],
      estimateUsd,
      tier: input.tier,
    })
    .returning();
  const parent = input.clipId ? doc.clips.find((clip) => clip.id === input.clipId) : undefined;
  const ops =
    toolKey === "regenerate_clip" && parent
      ? [{ type: "set_clip_status" as const, payload: { clipId: parent.id, status: "pending" as const } }]
      : clips.map((clip) => ({ type: "add_clip" as const, payload: { clip } }));
  const applied = await appendOps(
    projectId,
    ops.map((op) => ({ ...op, cardId })),
    { actor, cardId },
  );
  const targetClipIds =
    toolKey === "regenerate_clip" && parent ? [parent.id] : clips.map((clip) => clip.id);
  const job = await enqueueEditJob(projectId, {
    kind: input.kind,
    request: {
      tenant,
      prompt: input.prompt,
      aspect: input.kind === "generate_image" ? imageAspectForEdit(aspect as "16:9" | "9:16" | "1:1") : aspect,
      model,
      imageUrl,
      imageAssetId: input.imageAssetId,
      seconds: seconds ?? 5,
      resolution: "720p",
      projectId,
    },
    targetClipIds,
    cardId,
    model,
    tier: input.tier,
    estimateUsd,
  });
  const [updated] = await db
    .update(editCards)
    .set({ jobId: job.id, opIdsJson: applied.applied.map((op) => op.id) })
    .where(eq(editCards.id, cardId))
    .returning();
  const folded = await foldProject(projectId);
  const stamped = structuredClone(folded);
  for (const clip of stamped.clips) {
    if (targetClipIds.includes(clip.id)) {
      clip.badge = { cardId };
      clip.jobId = job.id;
    }
  }
  await writeSnapshot(projectId, stamped.seq, stamped);
  const card = mapCard(updated ?? cardRow);
  editEvents.emitEvent({ type: "card.updated", projectId, card });
  return {
    job: mapJob(job),
    clips: stamped.clips.filter((clip) => targetClipIds.includes(clip.id)),
    estimateUsd,
    card,
  };
}
