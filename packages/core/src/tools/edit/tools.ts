import { z } from "zod";
import { ApiError } from "../../errors";
import { ASPECT_SIZE, DEFAULT_TITLE_STYLE, titleStyleSchema, type Clip } from "../../edit/document";
import { RECIPES } from "../../edit/recipes";
import { imageToVideoForModel } from "../../models/video-capabilities";
import type { TenantContext } from "../../tenancy/types";
import { defineTool } from "../define-tool";
import { requireEditToolBackend, type EditStartGenerateJobInput } from "./backend";
import { editToolRefusal } from "./refusals";
import {
  animateStoryboardSchema,
  generateStoryboardSchema,
  imageAspectForEdit,
  splitSceneToShots,
  stillClipDurationFrames,
  tierOrDefault,
  timelineTailFrame,
} from "./storyboard";

function newId(): string {
  return crypto.randomUUID();
}

export const getProjectTool = defineTool({
  key: "get_project",
  name: "Get project",
  description: "Return a compact view of the current Edit project.",
  schema: z.object({}).strict(),
  execute: async (_args, tenant) => {
    const project = await requireEditToolBackend().getProject(tenant);
    return { success: true, project };
  },
});

export const listClipsTool = defineTool({
  key: "list_clips",
  name: "List clips",
  description: "List clips on the timeline, optionally filtered by track id.",
  schema: z
    .object({
      trackId: z.string().min(1).optional(),
    })
    .strict(),
  execute: async ({ trackId }, tenant) => {
    const clips = await requireEditToolBackend().listClips(tenant, trackId);
    return { success: true, clips };
  },
});

export const probeAssetTool = defineTool({
  key: "probe_asset",
  name: "Probe asset",
  description: "Return probe metadata for an imported or generated asset.",
  schema: z
    .object({
      assetId: z.string().min(1),
    })
    .strict(),
  execute: async ({ assetId }, tenant) => {
    const probe = await requireEditToolBackend().probeAsset(tenant, assetId);
    return { success: true, probe };
  },
});

export const listIngredientsTool = defineTool({
  key: "list_ingredients",
  name: "List ingredients",
  description: "List named ingredients (@refs) on the current project.",
  schema: z.object({}).strict(),
  execute: async (_args, tenant) => {
    const ingredients = await requireEditToolBackend().listIngredients(tenant);
    return { success: true, ingredients };
  },
});

export const detectSilenceTool = defineTool({
  key: "detect_silence",
  name: "Detect silence",
  description: "Read-only. Call `remove_silence` to act.",
  schema: z
    .object({
      assetId: z.string().min(1),
      noiseDb: z.number().min(-60).max(-10).optional(),
      minSeconds: z.number().min(0.2).max(5).optional(),
    })
    .strict(),
  execute: async (args, tenant) => {
    const result = await requireEditToolBackend().detectSilence(tenant, args);
    return { success: true, ...result };
  },
});

export const detectScenesTool = defineTool({
  key: "detect_scenes",
  name: "Detect scenes",
  description: "Detect scene-cut frames on an asset (read-only).",
  schema: z
    .object({
      assetId: z.string().min(1),
      threshold: z.number().min(0.1).max(0.9).optional(),
    })
    .strict(),
  execute: async (args, tenant) => {
    const result = await requireEditToolBackend().detectScenes(tenant, args);
    return { success: true, ...result };
  },
});

export const transcribeTool = defineTool({
  key: "transcribe",
  name: "Transcribe",
  description: "Only when ASR is available; otherwise say so and ask for a script or SRT.",
  schema: z
    .object({
      assetId: z.string().min(1),
      language: z.string().min(1).optional(),
    })
    .strict(),
  execute: async (args, tenant) => {
    const backend = requireEditToolBackend();
    if (!(await backend.asrAvailable(tenant))) {
      return editToolRefusal("asr_unavailable", "Auto captions unavailable on this key");
    }
    const project = await backend.getProject(tenant);
    return backend
      .startJob(tenant, {
        kind: "asr",
        request: args,
        targetClipIds: [],
      })
      .then((result) => ({ success: true, ...result, projectId: project.id }));
  },
});

export const splitClipTool = defineTool({
  key: "split_clip",
  name: "Split clip",
  description: "Split a clip at a timeline frame. atFrame must be strictly inside the clip.",
  schema: z
    .object({
      clipId: z.string().min(1),
      atFrame: z.number().int(),
    })
    .strict(),
  execute: async ({ clipId, atFrame }, tenant) => {
    return requireEditToolBackend().applyAgentOps(tenant, [
      { type: "split_clip", payload: { clipId, atFrame, newClipId: newId() } },
    ]);
  },
});

export const trimClipTool = defineTool({
  key: "trim_clip",
  name: "Trim clip",
  description: "Trim a clip. Duration must be at least 1 frame and stay inside the asset when duration is known.",
  schema: z
    .object({
      clipId: z.string().min(1),
      inFrame: z.number().int().nonnegative().optional(),
      durationFrames: z.number().int().optional(),
    })
    .strict(),
  execute: async (args, tenant) => {
    return requireEditToolBackend().applyAgentOps(tenant, [{ type: "trim_clip", payload: args }]);
  },
});

export const moveClipTool = defineTool({
  key: "move_clip",
  name: "Move clip",
  description: "Move a clip by track id and timeline start frame (ids only; never array indices).",
  schema: z
    .object({
      clipId: z.string().min(1),
      trackId: z.string().min(1),
      timelineStartFrame: z.number().int().nonnegative(),
    })
    .strict(),
  execute: async (args, tenant) => {
    return requireEditToolBackend().applyAgentOps(tenant, [{ type: "move_clip", payload: args }]);
  },
});

export const deleteClipsTool = defineTool({
  key: "delete_clips",
  name: "Delete clips",
  description: "More than 3 clips requires `confirm: true` after the user agreed.",
  schema: z
    .object({
      clipIds: z.array(z.string().min(1)).min(1).max(50),
      confirm: z.boolean().optional(),
    })
    .strict(),
  execute: async ({ clipIds, confirm }, tenant) => {
    if (clipIds.length > 3 && confirm !== true) {
      return editToolRefusal("confirm_required", "More than 3 clips requires confirm: true");
    }
    return requireEditToolBackend().applyAgentOps(
      tenant,
      clipIds.map((clipId) => ({ type: "delete_clip" as const, payload: { clipId } })),
    );
  },
});

export const removeSilenceTool = defineTool({
  key: "remove_silence",
  name: "Remove silence",
  description: "Emits split + delete ops; one card.",
  schema: z
    .object({
      clipId: z.string().min(1),
      ranges: z.array(
        z
          .object({
            startFrame: z.number().int(),
            endFrame: z.number().int(),
          })
          .strict(),
      ),
      paddingFrames: z.number().int().nonnegative().optional(),
    })
    .strict(),
  execute: async ({ clipId, ranges, paddingFrames }, tenant) => {
    const backend = requireEditToolBackend();
    const project = await backend.getProject(tenant);
    const clip = project.clips.find((item) => item.id === clipId);
    const pad = paddingFrames ?? 0;
    const ops = [];
    const currentId = clipId;
    const sorted = [...ranges].sort((a, b) => b.startFrame - a.startFrame);
    for (const range of sorted) {
      const start = range.startFrame + pad;
      const end = range.endFrame - pad;
      if (!clip || !(end > start)) {
        continue;
      }
      const midId = newId();
      const rightId = newId();
      ops.push({ type: "split_clip" as const, payload: { clipId: currentId, atFrame: start, newClipId: midId } });
      ops.push({ type: "split_clip" as const, payload: { clipId: midId, atFrame: end, newClipId: rightId } });
      ops.push({ type: "delete_clip" as const, payload: { clipId: midId } });
    }
    return backend.applyAgentOps(tenant, ops);
  },
});

export const splitAtScenesTool = defineTool({
  key: "split_at_scenes",
  name: "Split at scenes",
  description: "Split a clip at detected scene frames. Emits split ops; one card.",
  schema: z
    .object({
      clipId: z.string().min(1),
      frames: z.array(z.number().int()),
    })
    .strict(),
  execute: async ({ clipId, frames }, tenant) => {
    const unique = [...new Set(frames)].sort((a, b) => b - a);
    const ops = unique.map((atFrame) => ({
      type: "split_clip" as const,
      payload: { clipId, atFrame, newClipId: newId() },
    }));
    return requireEditToolBackend().applyAgentOps(tenant, ops);
  },
});

export const addTitleTool = defineTool({
  key: "add_title",
  name: "Add title",
  description:
    "Add a title card now. text is the words on screen. style, startFrame and durationFrames are optional; omit them for a 3 second title at the start. Style, when sent, must stay inside the ASS subset.",
  schema: z
    .object({
      text: z.string().min(1).max(120),
      style: titleStyleSchema.optional(),
      startFrame: z.number().int().nonnegative().optional(),
      durationFrames: z.number().int().min(1).optional(),
      trackId: z.string().min(1).optional(),
    })
    .strict(),
  execute: async ({ text, style, startFrame, durationFrames, trackId }, tenant) => {
    const clip: Clip = {
      id: newId(),
      trackId: trackId ?? "v1",
      timelineStartFrame: startFrame ?? 0,
      durationFrames: durationFrames ?? 90,
      status: "ready",
      title: { text, style: style ?? DEFAULT_TITLE_STYLE },
    };
    return requireEditToolBackend().applyAgentOps(tenant, [{ type: "add_clip", payload: { clip } }]);
  },
});

export const addCaptionTool = defineTool({
  key: "add_caption",
  name: "Add caption",
  description: "Add caption clips from a pasted script, SRT/VTT, or a transcript.",
  schema: z
    .object({
      source: z.enum(["script", "srt", "transcript"]),
      text: z.string().optional(),
      assetId: z.string().min(1).optional(),
      startFrame: z.number().int().nonnegative().optional(),
      endFrame: z.number().int().nonnegative().optional(),
    })
    .strict(),
  execute: async (args, tenant) => {
    const backend = requireEditToolBackend();
    if (args.source === "transcript") {
      if (!(await backend.asrAvailable(tenant))) {
        return editToolRefusal("asr_unavailable", "Auto captions unavailable on this key");
      }
    }
    const project = await backend.getProject(tenant);
    const start = args.startFrame ?? 0;
    const end = args.endFrame ?? Math.max(start + project.fps, start + 1);
    const span = Math.max(1, end - start);
    const lines =
      args.source === "script"
        ? (args.text ?? "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        : parseSrtCues(args.text ?? "").map((cue) => cue.text);
    const cues = lines.length > 0 ? lines : [args.text ?? ""];
    const slice = Math.max(1, Math.floor(span / cues.length));
    const ops = cues.map((text, index) => ({
      type: "add_clip" as const,
      payload: {
        clip: {
          id: newId(),
          trackId: "c1",
          timelineStartFrame: start + index * slice,
          durationFrames: slice,
          status: "ready" as const,
          caption: { text: text.slice(0, 500) },
        },
      },
    }));
    return backend.applyAgentOps(tenant, ops);
  },
});

export const reframeTool = defineTool({
  key: "reframe",
  name: "Reframe",
  description: "Changes canvas size; requires `confirm`.",
  schema: z
    .object({
      aspect: z.enum(["16:9", "9:16", "1:1"]),
      mode: z.enum(["pad", "crop-center"]),
      confirm: z.boolean().optional(),
    })
    .strict(),
  execute: async ({ aspect, confirm }, tenant) => {
    if (confirm !== true) {
      return editToolRefusal("confirm_required", "Changing canvas size requires confirm");
    }
    const size = ASPECT_SIZE[aspect];
    return requireEditToolBackend().applyAgentOps(tenant, [
      { type: "set_project", payload: { width: size.width, height: size.height, confirm: true } },
    ]);
  },
});

export const setClipVolumeTool = defineTool({
  key: "set_clip_volume",
  name: "Set clip volume",
  description: "Set clip volume in 0..2 (1 is unity).",
  schema: z
    .object({
      clipId: z.string().min(1),
      volume: z.number().min(0).max(2),
    })
    .strict(),
  execute: async (args, tenant) => {
    return requireEditToolBackend().applyAgentOps(tenant, [{ type: "set_volume", payload: args }]);
  },
});

export const clearTimelineTool = defineTool({
  key: "clear_timeline",
  name: "Clear timeline",
  description: "Only when the user explicitly asked to clear everything.",
  schema: z
    .object({
      confirm: z.boolean().optional(),
    })
    .strict(),
  execute: async ({ confirm }, tenant) => {
    if (confirm !== true) {
      return editToolRefusal("confirm_required", "clear_timeline requires confirm: true");
    }
    return requireEditToolBackend().applyAgentOps(tenant, [{ type: "clear_timeline", payload: { confirm: true } }]);
  },
});

export const proposePlanTool = defineTool({
  key: "propose_plan",
  name: "Propose plan",
  description: "Nothing runs until the user presses Go.",
  schema: z
    .object({
      steps: z.array(
        z
          .object({
            tool: z.string().min(1),
            args: z.record(z.string(), z.unknown()),
            estimateUsd: z.number().optional(),
          })
          .strict(),
      ),
      totalUsd: z.number(),
    })
    .strict(),
  execute: async (args, tenant) => {
    const result = await requireEditToolBackend().proposePlan(tenant, args);
    return { success: true, ...result };
  },
});

export const cancelJobTool = defineTool({
  key: "cancel_job",
  name: "Cancel job",
  description: "Cancel a queued or running Edit job.",
  schema: z
    .object({
      jobId: z.string().min(1),
    })
    .strict(),
  execute: async ({ jobId }, tenant) => {
    const job = await requireEditToolBackend().cancelJob(tenant, jobId);
    return { success: true, job };
  },
});

async function runGenerateTool(tenant: TenantContext, input: EditStartGenerateJobInput) {
  try {
    const result = await requireEditToolBackend().startGenerateJob(tenant, input);
    return { success: true, ...result };
  } catch (error) {
    if (error instanceof ApiError && (error.code === "video_still_unsupported" || error.code === "still_unsupported")) {
      return editToolRefusal("still_unsupported", error.message);
    }
    throw error;
  }
}

export const generateImageTool = defineTool({
  key: "generate_image",
  name: "Generate image",
  description: "Refused with `turn_cap_exceeded` or `price_unknown`; then propose a plan.",
  schema: z
    .object({
      prompt: z.string().min(1).max(2000),
      aspect: z.enum(["16:9", "9:16", "1:1"]).optional(),
      tier: z.enum(["draft", "standard", "cinematic"]).optional(),
      count: z.number().int().min(1).max(4).optional(),
      ingredientIds: z.array(z.string().min(1)).max(8).optional(),
      placeAt: z
        .object({
          trackId: z.string().min(1),
          timelineStartFrame: z.number().int().nonnegative(),
        })
        .strict()
        .optional(),
      trackId: z.string().min(1).optional(),
      startFrame: z.number().int().nonnegative().optional(),
      model: z.string().min(1).optional(),
    })
    .strict(),
  execute: async (args, tenant) => {
    return runGenerateTool(tenant, {
      kind: "generate_image",
      toolKey: "generate_image",
      prompt: args.prompt,
      aspect: args.aspect,
      tier: args.tier,
      count: args.count,
      ingredientIds: args.ingredientIds,
      placeAt:
        args.placeAt ??
        (args.trackId != null || args.startFrame != null
          ? { trackId: args.trackId ?? "v1", timelineStartFrame: args.startFrame ?? 0 }
          : undefined),
      model: args.model,
    });
  },
});

export const generateVideoTool = defineTool({
  key: "generate_video",
  name: "Generate video",
  description: "Refuses a still when the routed model has `imageToVideo: false`.",
  schema: z
    .object({
      prompt: z.string().min(1).max(2000),
      aspect: z.enum(["16:9", "9:16", "1:1"]).optional(),
      tier: z.enum(["draft", "standard", "cinematic"]).optional(),
      seconds: z.number().int().min(2).max(12).optional(),
      imageAssetId: z.string().min(1).optional(),
      imageUrl: z.string().min(1).optional(),
      clipId: z.string().min(1).optional(),
      ingredientIds: z.array(z.string().min(1)).optional(),
      placeAt: z
        .object({
          trackId: z.string().min(1),
          timelineStartFrame: z.number().int().nonnegative(),
        })
        .strict()
        .optional(),
      model: z.string().min(1).optional(),
    })
    .strict(),
  execute: async (args, tenant) => {
    const still = args.imageAssetId ?? args.imageUrl;
    if (still && args.model && !imageToVideoForModel(args.model)) {
      return editToolRefusal("still_unsupported", "This model does not accept a still image");
    }
    return runGenerateTool(tenant, {
      kind: "generate_video",
      toolKey: "generate_video",
      prompt: args.prompt,
      aspect: args.aspect,
      tier: args.tier,
      seconds: args.seconds,
      imageAssetId: args.imageAssetId,
      imageUrl: args.imageUrl,
      clipId: args.clipId,
      ingredientIds: args.ingredientIds,
      placeAt: args.placeAt,
      model: args.model,
    });
  },
});

export const regenerateClipTool = defineTool({
  key: "regenerate_clip",
  name: "Regenerate clip",
  description: "Regenerate a clip. Lineage is carried on the new job.",
  schema: z
    .object({
      clipId: z.string().min(1),
      prompt: z.string().min(1).optional(),
      tier: z.enum(["draft", "standard", "cinematic"]).optional(),
      model: z.string().min(1).optional(),
    })
    .strict(),
  execute: async (args, tenant) => {
    const backend = requireEditToolBackend();
    const project = await backend.getProject(tenant);
    const clip = project.clips.find((item) => item.id === args.clipId);
    return runGenerateTool(tenant, {
      kind: "generate_video",
      toolKey: "regenerate_clip",
      prompt: args.prompt ?? clip?.lineage?.prompt ?? "Regenerate this clip",
      clipId: args.clipId,
      tier: args.tier ?? clip?.lineage?.tier,
      model: args.model ?? clip?.lineage?.model,
    });
  },
});

export const variationsTool = defineTool({
  key: "variations",
  name: "Variations",
  description: "Create up to 4 variations of a clip. Lineage is carried.",
  schema: z
    .object({
      clipId: z.string().min(1),
      prompt: z.string().min(1).optional(),
      tier: z.enum(["draft", "standard", "cinematic"]).optional(),
      count: z.number().int().min(1).max(4).optional(),
      model: z.string().min(1).optional(),
    })
    .strict(),
  execute: async (args, tenant) => {
    const backend = requireEditToolBackend();
    const project = await backend.getProject(tenant);
    const clip = project.clips.find((item) => item.id === args.clipId);
    return runGenerateTool(tenant, {
      kind: "generate_video",
      toolKey: "variations",
      prompt: args.prompt ?? clip?.lineage?.prompt ?? "Variations of this clip",
      clipId: args.clipId,
      count: args.count ?? 2,
      tier: args.tier ?? clip?.lineage?.tier,
      model: args.model ?? clip?.lineage?.model,
    });
  },
});

export const extendClipTool = defineTool({
  key: "extend_clip",
  name: "Extend clip",
  description: "Extend a clip by addSeconds. Lineage is carried.",
  schema: z
    .object({
      clipId: z.string().min(1),
      addSeconds: z.number().int().min(1).max(12),
      prompt: z.string().min(1).optional(),
      tier: z.enum(["draft", "standard", "cinematic"]).optional(),
      model: z.string().min(1).optional(),
    })
    .strict(),
  execute: async (args, tenant) => {
    const backend = requireEditToolBackend();
    const project = await backend.getProject(tenant);
    const clip = project.clips.find((item) => item.id === args.clipId);
    return runGenerateTool(tenant, {
      kind: "generate_video",
      toolKey: "extend_clip",
      prompt: args.prompt ?? clip?.lineage?.prompt ?? "Extend this clip",
      clipId: args.clipId,
      addSeconds: args.addSeconds,
      tier: args.tier ?? clip?.lineage?.tier,
      model: args.model ?? clip?.lineage?.model,
    });
  },
});

export const generateStoryboardTool = defineTool({
  key: "generate_storyboard",
  name: "Generate storyboard",
  description: "Split a scene into still shots, add pending image clips, and queue image jobs.",
  schema: generateStoryboardSchema,
  execute: async (args, tenant) => {
    const backend = requireEditToolBackend();
    const project = await backend.getProject(tenant);
    const prompts = splitSceneToShots(args.scene, args.shots);
    const durationFrames = stillClipDurationFrames(project);
    let cursor = timelineTailFrame(project);
    const clipIds: string[] = [];
    const ops = prompts.map((prompt) => {
      const clipId = newId();
      clipIds.push(clipId);
      const clip: Clip = {
        id: clipId,
        trackId: "v1",
        timelineStartFrame: cursor,
        durationFrames,
        status: "pending",
        lineage: {
          prompt,
          tier: args.tier,
          ingredientIds: args.ingredientIds,
        },
      };
      cursor += durationFrames;
      return { type: "add_clip" as const, payload: { clip } };
    });
    const applied = await backend.applyAgentOps(tenant, ops);
    const cardId = (applied.card as { id?: string }).id;
    const jobs = [];
    for (let index = 0; index < clipIds.length; index += 1) {
      const clipId = clipIds[index]!;
      const prompt = prompts[index]!;
      const job = await backend.startJob(tenant, {
        kind: "generate_image",
        request: {
          prompt,
          aspect: imageAspectForEdit(args.aspect),
          tier: args.tier,
          ingredientIds: args.ingredientIds,
          tenant,
        },
        targetClipIds: [clipId],
        cardId,
        tier: args.tier,
      });
      jobs.push(job.job);
    }
    return { success: true, ...applied, clipIds, jobs };
  },
});

export const animateStoryboardTool = defineTool({
  key: "animate_storyboard",
  name: "Animate storyboard",
  description: "Turn still storyboard clips into video generation jobs (image-to-video).",
  schema: animateStoryboardSchema,
  execute: async (args, tenant) => {
    const backend = requireEditToolBackend();
    const project = await backend.getProject(tenant);
    const tier = tierOrDefault(args.tier);
    const aspect = args.aspect ?? ("16:9" as const);
    const ops = args.clipIds
      .filter((clipId) => project.clips.some((clip) => clip.id === clipId))
      .map((clipId) => ({ type: "set_clip_status" as const, payload: { clipId, status: "pending" as const } }));
    const applied = ops.length > 0 ? await backend.applyAgentOps(tenant, ops) : null;
    const cardId = applied ? (applied.card as { id?: string }).id : undefined;
    const jobs = [];
    for (const clipId of args.clipIds) {
      const clip = project.clips.find((item) => item.id === clipId);
      const imageAssetId = clip?.source?.assetId;
      if (!clip || !imageAssetId) {
        continue;
      }
      const asset = project.assets[imageAssetId];
      if (asset?.kind !== "image") {
        continue;
      }
      const job = await backend.startJob(tenant, {
        kind: "generate_video",
        request: {
          prompt: clip.lineage?.prompt ?? "Animate this still",
          aspect,
          tier,
          imageAssetId,
          imageUrl: undefined,
          seconds: 4,
          tenant,
        },
        targetClipIds: [clipId],
        cardId,
        tier,
      });
      jobs.push(job.job);
    }
    if (jobs.length === 0) {
      return editToolRefusal("still_unsupported", "No ready still clips with image sources to animate");
    }
    return { success: true, ...(applied ?? {}), jobs };
  },
});

export const matchLookTool = defineTool({
  key: "match_look",
  name: "Match look",
  description: "Queue a color-match pass from a reference clip onto a target clip.",
  schema: z
    .object({
      clipId: z.string().min(1),
      referenceClipId: z.string().min(1),
    })
    .strict(),
  execute: async ({ clipId, referenceClipId }, tenant) => {
    const backend = requireEditToolBackend();
    const project = await backend.getProject(tenant);
    const clip = project.clips.find((item) => item.id === clipId);
    const reference = project.clips.find((item) => item.id === referenceClipId);
    if (!clip?.source?.assetId || !reference?.source?.assetId) {
      return editToolRefusal("still_unsupported", "Both clips need media sources to match look");
    }
    const applied = await backend.applyAgentOps(tenant, [
      { type: "set_clip_status", payload: { clipId, status: "pending" } },
    ]);
    const cardId = (applied.card as { id?: string }).id;
    const job = await backend.startJob(tenant, {
      kind: "ffmpeg_op",
      request: {
        recipe: "matchLook",
        clipId,
        referenceClipId,
        note: "Color match queued; mild EQ will be applied when sources allow.",
      },
      targetClipIds: [clipId],
      cardId,
    });
    return { success: true, ...applied, ...job, note: "Color match queued" };
  },
});

export const proposeAltCutTool = defineTool({
  key: "propose_alt_cut",
  name: "Propose alt cut",
  description: "Place alternate cuts on v_compare only; v1 is never mutated.",
  schema: z
    .object({
      clipIds: z.array(z.string().min(1)).min(1).max(24),
    })
    .strict(),
  execute: async ({ clipIds }, tenant) => {
    const backend = requireEditToolBackend();
    const project = await backend.getProject(tenant);
    const ops: Array<{ type: "add_track" | "add_clip"; payload: unknown }> = [];
    if (!project.tracks.some((track) => track.id === "v_compare")) {
      ops.push({
        type: "add_track",
        payload: { track: { id: "v_compare", kind: "video", name: "Compare" } },
      });
    }
    let cursor = 0;
    for (const clipId of clipIds) {
      const source = project.clips.find((clip) => clip.id === clipId);
      if (!source) {
        continue;
      }
      const alt: Clip = {
        id: newId(),
        trackId: "v_compare",
        timelineStartFrame: cursor,
        durationFrames: source.durationFrames,
        status: source.status,
        source: source.source ? { ...source.source } : undefined,
        volume: source.volume,
        title: source.title,
        caption: source.caption,
        lineage: {
          parentClipId: source.id,
          prompt: source.lineage?.prompt,
        },
      };
      cursor += source.durationFrames;
      ops.push({ type: "add_clip", payload: { clip: alt } });
    }
    if (ops.length === 0) {
      return editToolRefusal("still_unsupported", "No clips found for alternate cut");
    }
    return backend.applyAgentOps(tenant, ops);
  },
});

export const runRecipeTool = defineTool({
  key: "run_recipe",
  name: "Run recipe",
  description: "Propose a multi-step recipe plan; nothing runs until the user presses Go.",
  schema: z
    .object({
      recipeId: z.string().min(1),
      vars: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  execute: async ({ recipeId, vars }, tenant) => {
    const recipe = RECIPES.find((item) => item.id === recipeId);
    if (!recipe) {
      return editToolRefusal("still_unsupported", `Unknown recipe: ${recipeId}`);
    }
    const steps = recipe.steps.map((step) => ({
      tool: step.tool,
      args: substituteRecipeVars(step.args, vars ?? {}),
    }));
    const result = await requireEditToolBackend().proposePlan(tenant, { steps, totalUsd: 0 });
    return { success: true, recipeId, ...result };
  },
});

function substituteRecipeVars(args: Record<string, unknown>, vars: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.startsWith("{{") && value.endsWith("}}")) {
      const name = value.slice(2, -2);
      out[key] = vars[name] ?? value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export const exportTool = defineTool({
  key: "export",
  name: "Export",
  description: "Blocked until the review gate passes.",
  schema: z
    .object({
      preset: z.enum(["h264-1080p", "h264-720p"]),
    })
    .strict(),
  execute: async ({ preset }, tenant) => {
    const backend = requireEditToolBackend();
    const project = await backend.getProject(tenant);
    if (!(await backend.reviewGateOpen(project.id))) {
      return editToolRefusal("review_required", "Export is blocked until the review gate passes");
    }
    const result = await backend.startJob(tenant, {
      kind: "render",
      request: { preset },
    });
    return { success: true, ...result };
  },
});

function parseSrtCues(text: string): Array<{ text: string }> {
  const blocks = text.split(/\n\s*\n/);
  const cues: Array<{ text: string }> = [];
  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      continue;
    }
    const withoutIndex = /^[0-9]+$/.test(lines[0] ?? "") ? lines.slice(1) : lines;
    const withoutTime = withoutIndex[0]?.includes("-->") ? withoutIndex.slice(1) : withoutIndex;
    const body = withoutTime.join(" ").trim();
    if (body) {
      cues.push({ text: body });
    }
  }
  return cues;
}

export const EDIT_TOOLS = [
  getProjectTool,
  listClipsTool,
  probeAssetTool,
  listIngredientsTool,
  detectSilenceTool,
  detectScenesTool,
  transcribeTool,
  splitClipTool,
  trimClipTool,
  moveClipTool,
  deleteClipsTool,
  removeSilenceTool,
  splitAtScenesTool,
  addTitleTool,
  addCaptionTool,
  reframeTool,
  setClipVolumeTool,
  clearTimelineTool,
  generateImageTool,
  generateVideoTool,
  regenerateClipTool,
  variationsTool,
  extendClipTool,
  generateStoryboardTool,
  animateStoryboardTool,
  matchLookTool,
  proposeAltCutTool,
  runRecipeTool,
  proposePlanTool,
  cancelJobTool,
  exportTool,
];
