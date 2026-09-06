import { z } from "zod";
import { ASPECT_SIZE, titleStyleSchema, type Clip } from "../../edit/document";
import { defineTool } from "../define-tool";
import { requireEditToolBackend } from "./backend";
import { editToolRefusal } from "./refusals";

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
    return backend.startJob(tenant, {
      kind: "asr",
      request: args,
      targetClipIds: [],
    }).then((result) => ({ success: true, ...result, projectId: project.id }));
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
    let currentId = clipId;
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
  description: "Style must be within the ASS subset.",
  schema: z
    .object({
      text: z.string().min(1).max(120),
      style: titleStyleSchema,
      startFrame: z.number().int().nonnegative(),
      durationFrames: z.number().int().min(1),
      trackId: z.string().min(1).optional(),
    })
    .strict(),
  execute: async ({ text, style, startFrame, durationFrames, trackId }, tenant) => {
    const clip: Clip = {
      id: newId(),
      trackId: trackId ?? "v1",
      timelineStartFrame: startFrame,
      durationFrames,
      status: "ready",
      title: { text, style },
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
  proposePlanTool,
  cancelJobTool,
  exportTool,
];
