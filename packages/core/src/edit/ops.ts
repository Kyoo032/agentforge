import { z } from "zod";
import { ApiError } from "../errors";
import {
  assetSchema,
  clipSchema,
  ingredientSchema,
  projectSchema,
  titleStyleSchema,
  trackSchema,
  type Clip,
  type EditProject,
  type Track,
  type TrackKind,
} from "./document";

export const OP_TYPES = [
  "add_track",
  "remove_track",
  "add_clip",
  "delete_clip",
  "split_clip",
  "merge_clips",
  "trim_clip",
  "move_clip",
  "set_source",
  "set_clip_status",
  "set_volume",
  "set_title",
  "set_caption",
  "add_asset",
  "remove_asset",
  "add_ingredient",
  "remove_ingredient",
  "set_project",
  "review_ack",
  "clear_timeline",
  "restore_timeline",
] as const;

export type OpType = (typeof OP_TYPES)[number];

export const addTrackPayloadSchema = z
  .object({
    track: trackSchema,
    clips: z.array(clipSchema).optional(),
  })
  .strict();

export const removeTrackPayloadSchema = z
  .object({
    trackId: z.string().min(1),
    confirm: z.boolean().optional(),
  })
  .strict();

export const addClipPayloadSchema = z
  .object({
    clip: clipSchema,
  })
  .strict();

export const deleteClipPayloadSchema = z
  .object({
    clipId: z.string().min(1),
  })
  .strict();

export const splitClipPayloadSchema = z
  .object({
    clipId: z.string().min(1),
    atFrame: z.number().int(),
    newClipId: z.string().min(1),
  })
  .strict();

export const mergeClipsPayloadSchema = z
  .object({
    leftId: z.string().min(1),
    rightId: z.string().min(1),
  })
  .strict();

export const trimClipPayloadSchema = z
  .object({
    clipId: z.string().min(1),
    inFrame: z.number().int().nonnegative().optional(),
    durationFrames: z.number().int().optional(),
  })
  .strict();

export const moveClipPayloadSchema = z
  .object({
    clipId: z.string().min(1),
    trackId: z.string().min(1),
    timelineStartFrame: z.number().int().nonnegative(),
  })
  .strict();

export const setSourcePayloadSchema = z
  .object({
    clipId: z.string().min(1),
    assetId: z.string().min(1).optional(),
    inFrame: z.number().int().nonnegative().optional(),
    clear: z.boolean().optional(),
  })
  .strict();

export const setClipStatusPayloadSchema = z
  .object({
    clipId: z.string().min(1),
    status: z.enum(["ready", "pending", "failed"]),
    jobId: z.string().min(1).optional(),
  })
  .strict();

export const setVolumePayloadSchema = z
  .object({
    clipId: z.string().min(1),
    volume: z.number().min(0).max(2),
  })
  .strict();

export const setTitlePayloadSchema = z
  .object({
    clipId: z.string().min(1),
    text: z.string().max(120).optional(),
    style: titleStyleSchema.optional(),
    unset: z.boolean().optional(),
  })
  .strict();

export const setCaptionPayloadSchema = z
  .object({
    clipId: z.string().min(1),
    text: z.string().max(500).optional(),
    unset: z.boolean().optional(),
  })
  .strict();

export const addAssetPayloadSchema = z
  .object({
    asset: assetSchema,
  })
  .strict();

export const removeAssetPayloadSchema = z
  .object({
    assetId: z.string().min(1),
  })
  .strict();

export const addIngredientPayloadSchema = z
  .object({
    ingredient: ingredientSchema,
  })
  .strict();

export const removeIngredientPayloadSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const setProjectPayloadSchema = z
  .object({
    name: z.string().min(1).optional(),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    confirm: z.boolean().optional(),
  })
  .strict();

export const reviewAckPayloadSchema = z
  .object({
    seq: z.number().int().nonnegative(),
  })
  .strict();

export const clearTimelinePayloadSchema = z
  .object({
    confirm: z.boolean(),
  })
  .strict();

export const restoreTimelinePayloadSchema = z
  .object({
    snapshot: z
      .object({
        tracks: z.array(trackSchema),
        clips: z.array(clipSchema),
      })
      .strict(),
  })
  .strict();

export const OP_PAYLOAD_SCHEMAS = {
  add_track: addTrackPayloadSchema,
  remove_track: removeTrackPayloadSchema,
  add_clip: addClipPayloadSchema,
  delete_clip: deleteClipPayloadSchema,
  split_clip: splitClipPayloadSchema,
  merge_clips: mergeClipsPayloadSchema,
  trim_clip: trimClipPayloadSchema,
  move_clip: moveClipPayloadSchema,
  set_source: setSourcePayloadSchema,
  set_clip_status: setClipStatusPayloadSchema,
  set_volume: setVolumePayloadSchema,
  set_title: setTitlePayloadSchema,
  set_caption: setCaptionPayloadSchema,
  add_asset: addAssetPayloadSchema,
  remove_asset: removeAssetPayloadSchema,
  add_ingredient: addIngredientPayloadSchema,
  remove_ingredient: removeIngredientPayloadSchema,
  set_project: setProjectPayloadSchema,
  review_ack: reviewAckPayloadSchema,
  clear_timeline: clearTimelinePayloadSchema,
  restore_timeline: restoreTimelinePayloadSchema,
} as const;

export const opTypeSchema = z.enum(OP_TYPES);

export const editOpSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    parent: z.string().min(1).nullable(),
    clock: z.number().int().nonnegative(),
    actor: z.union([z.literal("owner"), z.string().regex(/^agent:.+/)]),
    type: opTypeSchema,
    payload: z.unknown(),
    inverse: z.unknown().nullable(),
    cardId: z.string().min(1).optional(),
    undoOf: z.string().min(1).optional(),
    createdAt: z.string().min(1),
  })
  .strict();

export type EditOp = z.infer<typeof editOpSchema>;

export type ApplyableOp = {
  type: OpType;
  payload: unknown;
};

export function assertAgentOpHasCard(op: Pick<EditOp, "actor" | "cardId">): void {
  if (op.actor.startsWith("agent:") && !op.cardId) {
    throw new ApiError("card_required", "Agent ops must include cardId", 400);
  }
}

export function parseOpPayload<T extends OpType>(type: T, payload: unknown): z.infer<(typeof OP_PAYLOAD_SCHEMAS)[T]> {
  const parsed = OP_PAYLOAD_SCHEMAS[type].safeParse(payload);
  if (!parsed.success) {
    throw new ApiError("invalid_op", parsed.error.message, 400);
  }
  return parsed.data as z.infer<(typeof OP_PAYLOAD_SCHEMAS)[T]>;
}

function invalidOp(message: string): never {
  throw new ApiError("invalid_op", message, 400);
}

function confirmRequired(message: string): never {
  throw new ApiError("confirm_required", message, 400);
}

function cloneProject(doc: EditProject): EditProject {
  return structuredClone(doc);
}

export function findTrack(doc: EditProject, trackId: string): Track | undefined {
  return doc.tracks.find((track) => track.id === trackId);
}

export function findClip(doc: EditProject, clipId: string): Clip | undefined {
  return doc.clips.find((clip) => clip.id === clipId);
}

export function inferClipKind(clip: Clip, doc: EditProject): TrackKind {
  if (clip.caption !== undefined) {
    return "caption";
  }
  const assetId = clip.source?.assetId;
  if (assetId) {
    const asset = doc.assets[assetId];
    if (asset?.kind === "audio") {
      return "audio";
    }
  }
  return "video";
}

function requireTrack(doc: EditProject, trackId: string): Track {
  const track = findTrack(doc, trackId);
  if (!track) {
    invalidOp(`track not found: ${trackId}`);
  }
  return track;
}

function requireClip(doc: EditProject, clipId: string): Clip {
  const clip = findClip(doc, clipId);
  if (!clip) {
    invalidOp(`clip not found: ${clipId}`);
  }
  return clip;
}

function assertKindMatches(clip: Clip, doc: EditProject, track: Track): void {
  const kind = inferClipKind(clip, doc);
  if (kind !== track.kind) {
    invalidOp(`clip kind ${kind} cannot move to track kind ${track.kind}`);
  }
}

function assetIsReferenced(doc: EditProject, assetId: string): boolean {
  for (const clip of doc.clips) {
    if (clip.source?.assetId === assetId || clip.fallbackAssetId === assetId) {
      return true;
    }
  }
  for (const ingredient of doc.ingredients) {
    if (ingredient.assetId === assetId) {
      return true;
    }
  }
  return false;
}

function clipEnd(clip: Clip): number {
  return clip.timelineStartFrame + clip.durationFrames;
}

export function applyOp(doc: EditProject, op: ApplyableOp): EditProject {
  const next = cloneProject(doc);
  switch (op.type) {
    case "add_track": {
      const payload = parseOpPayload("add_track", op.payload);
      if (next.tracks.some((track) => track.id === payload.track.id)) {
        invalidOp(`track id already exists: ${payload.track.id}`);
      }
      next.tracks.push(payload.track);
      if (payload.clips) {
        for (const clip of payload.clips) {
          if (next.clips.some((existing) => existing.id === clip.id)) {
            invalidOp(`clip id already exists: ${clip.id}`);
          }
          next.clips.push(clip);
        }
      }
      return next;
    }
    case "remove_track": {
      const payload = parseOpPayload("remove_track", op.payload);
      const track = requireTrack(next, payload.trackId);
      const onTrack = next.clips.filter((clip) => clip.trackId === payload.trackId);
      if (onTrack.length > 0 && payload.confirm !== true) {
        confirmRequired("Removing a track that has clips requires confirm");
      }
      next.tracks = next.tracks.filter((item) => item.id !== track.id);
      next.clips = next.clips.filter((clip) => clip.trackId !== track.id);
      return next;
    }
    case "add_clip": {
      const payload = parseOpPayload("add_clip", op.payload);
      if (next.clips.some((clip) => clip.id === payload.clip.id)) {
        invalidOp(`clip id already exists: ${payload.clip.id}`);
      }
      const track = requireTrack(next, payload.clip.trackId);
      assertKindMatches(payload.clip, next, track);
      if (payload.clip.source && !next.assets[payload.clip.source.assetId]) {
        invalidOp(`asset not found: ${payload.clip.source.assetId}`);
      }
      if (payload.clip.fallbackAssetId && !next.assets[payload.clip.fallbackAssetId]) {
        invalidOp(`fallback asset not found: ${payload.clip.fallbackAssetId}`);
      }
      next.clips.push(payload.clip);
      return next;
    }
    case "delete_clip": {
      const payload = parseOpPayload("delete_clip", op.payload);
      requireClip(next, payload.clipId);
      next.clips = next.clips.filter((clip) => clip.id !== payload.clipId);
      return next;
    }
    case "split_clip": {
      const payload = parseOpPayload("split_clip", op.payload);
      const clip = requireClip(next, payload.clipId);
      const start = clip.timelineStartFrame;
      const end = clipEnd(clip);
      if (!(payload.atFrame > start && payload.atFrame < end)) {
        invalidOp("split atFrame must be strictly inside the clip");
      }
      if (next.clips.some((item) => item.id === payload.newClipId)) {
        invalidOp(`clip id already exists: ${payload.newClipId}`);
      }
      const leftDuration = payload.atFrame - start;
      const rightDuration = end - payload.atFrame;
      clip.durationFrames = leftDuration;
      const right: Clip = {
        ...structuredClone(clip),
        id: payload.newClipId,
        timelineStartFrame: payload.atFrame,
        durationFrames: rightDuration,
      };
      if (clip.source) {
        right.source = {
          assetId: clip.source.assetId,
          inFrame: clip.source.inFrame + leftDuration,
        };
      }
      delete right.jobId;
      next.clips.push(right);
      return next;
    }
    case "merge_clips": {
      const payload = parseOpPayload("merge_clips", op.payload);
      const left = requireClip(next, payload.leftId);
      const right = requireClip(next, payload.rightId);
      if (left.trackId !== right.trackId) {
        invalidOp("merge requires the same track");
      }
      if (clipEnd(left) !== right.timelineStartFrame) {
        invalidOp("merge requires contiguous clips");
      }
      if (!left.source || !right.source || left.source.assetId !== right.source.assetId) {
        invalidOp("merge requires the same source");
      }
      if (left.source.inFrame + left.durationFrames !== right.source.inFrame) {
        invalidOp("merge requires contiguous source in-points");
      }
      left.durationFrames += right.durationFrames;
      next.clips = next.clips.filter((clip) => clip.id !== right.id);
      return next;
    }
    case "trim_clip": {
      const payload = parseOpPayload("trim_clip", op.payload);
      const clip = requireClip(next, payload.clipId);
      const nextIn = payload.inFrame ?? clip.source?.inFrame ?? 0;
      const nextDuration = payload.durationFrames ?? clip.durationFrames;
      if (nextDuration < 1) {
        invalidOp("trim duration must be at least 1 frame");
      }
      const asset = clip.source ? next.assets[clip.source.assetId] : undefined;
      if (asset?.durationFrames !== undefined) {
        if (nextIn < 0 || nextIn + nextDuration > asset.durationFrames) {
          invalidOp("trim must stay inside the asset duration");
        }
      }
      if (clip.source) {
        clip.source.inFrame = nextIn;
      } else if (payload.inFrame !== undefined) {
        invalidOp("cannot set inFrame on a clip without a source");
      }
      clip.durationFrames = nextDuration;
      return next;
    }
    case "move_clip": {
      const payload = parseOpPayload("move_clip", op.payload);
      const clip = requireClip(next, payload.clipId);
      const track = requireTrack(next, payload.trackId);
      assertKindMatches(clip, next, track);
      clip.trackId = payload.trackId;
      clip.timelineStartFrame = payload.timelineStartFrame;
      return next;
    }
    case "set_source": {
      const payload = parseOpPayload("set_source", op.payload);
      const clip = requireClip(next, payload.clipId);
      if (payload.clear) {
        delete clip.source;
        return next;
      }
      if (!payload.assetId || payload.inFrame === undefined) {
        invalidOp("set_source requires assetId and inFrame");
      }
      if (!next.assets[payload.assetId]) {
        invalidOp(`asset not found: ${payload.assetId}`);
      }
      clip.source = { assetId: payload.assetId, inFrame: payload.inFrame };
      return next;
    }
    case "set_clip_status": {
      const payload = parseOpPayload("set_clip_status", op.payload);
      const clip = requireClip(next, payload.clipId);
      clip.status = payload.status;
      if (payload.jobId !== undefined) {
        clip.jobId = payload.jobId;
      }
      return next;
    }
    case "set_volume": {
      const payload = parseOpPayload("set_volume", op.payload);
      const clip = requireClip(next, payload.clipId);
      clip.volume = payload.volume;
      return next;
    }
    case "set_title": {
      const payload = parseOpPayload("set_title", op.payload);
      const clip = requireClip(next, payload.clipId);
      if (payload.unset) {
        delete clip.title;
        return next;
      }
      if (payload.text === undefined || payload.style === undefined) {
        invalidOp("set_title requires text and style");
      }
      clip.title = { text: payload.text, style: payload.style };
      return next;
    }
    case "set_caption": {
      const payload = parseOpPayload("set_caption", op.payload);
      const clip = requireClip(next, payload.clipId);
      if (payload.unset) {
        delete clip.caption;
        return next;
      }
      if (payload.text === undefined) {
        invalidOp("set_caption requires text");
      }
      clip.caption = { text: payload.text };
      return next;
    }
    case "add_asset": {
      const payload = parseOpPayload("add_asset", op.payload);
      if (next.assets[payload.asset.id]) {
        invalidOp(`asset id already exists: ${payload.asset.id}`);
      }
      next.assets[payload.asset.id] = payload.asset;
      return next;
    }
    case "remove_asset": {
      const payload = parseOpPayload("remove_asset", op.payload);
      if (!next.assets[payload.assetId]) {
        invalidOp(`asset not found: ${payload.assetId}`);
      }
      if (assetIsReferenced(next, payload.assetId)) {
        invalidOp("cannot remove a referenced asset");
      }
      delete next.assets[payload.assetId];
      return next;
    }
    case "add_ingredient": {
      const payload = parseOpPayload("add_ingredient", op.payload);
      if (next.ingredients.some((item) => item.id === payload.ingredient.id)) {
        invalidOp(`ingredient id already exists: ${payload.ingredient.id}`);
      }
      if (next.ingredients.some((item) => item.name === payload.ingredient.name)) {
        invalidOp(`ingredient @name already exists: ${payload.ingredient.name}`);
      }
      if (payload.ingredient.assetId && !next.assets[payload.ingredient.assetId]) {
        invalidOp(`asset not found: ${payload.ingredient.assetId}`);
      }
      next.ingredients.push(payload.ingredient);
      return next;
    }
    case "remove_ingredient": {
      const payload = parseOpPayload("remove_ingredient", op.payload);
      if (!next.ingredients.some((item) => item.id === payload.id)) {
        invalidOp(`ingredient not found: ${payload.id}`);
      }
      next.ingredients = next.ingredients.filter((item) => item.id !== payload.id);
      return next;
    }
    case "set_project": {
      const payload = parseOpPayload("set_project", op.payload);
      const sizeOrFpsChanged =
        (payload.fps !== undefined && payload.fps !== next.fps) ||
        (payload.width !== undefined && payload.width !== next.width) ||
        (payload.height !== undefined && payload.height !== next.height);
      if (sizeOrFpsChanged && payload.confirm !== true) {
        confirmRequired("Changing fps or canvas size requires confirm");
      }
      if (payload.name !== undefined) {
        next.name = payload.name;
      }
      if (payload.fps !== undefined) {
        next.fps = payload.fps;
      }
      if (payload.width !== undefined) {
        next.width = payload.width;
      }
      if (payload.height !== undefined) {
        next.height = payload.height;
      }
      return next;
    }
    case "review_ack": {
      const payload = parseOpPayload("review_ack", op.payload);
      next.review.ackSeq = payload.seq;
      return next;
    }
    case "clear_timeline": {
      const payload = parseOpPayload("clear_timeline", op.payload);
      if (payload.confirm !== true) {
        confirmRequired("clear_timeline requires confirm: true");
      }
      next.clips = [];
      return next;
    }
    case "restore_timeline": {
      const payload = parseOpPayload("restore_timeline", op.payload);
      next.tracks = payload.snapshot.tracks;
      next.clips = payload.snapshot.clips;
      return next;
    }
    default: {
      invalidOp(`unknown op type: ${String((op as ApplyableOp).type)}`);
    }
  }
}

export type InverseOp = ApplyableOp | null;

export function computeInverse(doc: EditProject, op: ApplyableOp): InverseOp {
  switch (op.type) {
    case "add_track": {
      const payload = parseOpPayload("add_track", op.payload);
      return { type: "remove_track", payload: { trackId: payload.track.id, confirm: true } };
    }
    case "remove_track": {
      const payload = parseOpPayload("remove_track", op.payload);
      const track = requireTrack(doc, payload.trackId);
      const clips = doc.clips.filter((clip) => clip.trackId === payload.trackId);
      return { type: "add_track", payload: { track: structuredClone(track), clips: structuredClone(clips) } };
    }
    case "add_clip": {
      const payload = parseOpPayload("add_clip", op.payload);
      return { type: "delete_clip", payload: { clipId: payload.clip.id } };
    }
    case "delete_clip": {
      const payload = parseOpPayload("delete_clip", op.payload);
      const clip = requireClip(doc, payload.clipId);
      return { type: "add_clip", payload: { clip: structuredClone(clip) } };
    }
    case "split_clip": {
      const payload = parseOpPayload("split_clip", op.payload);
      return { type: "merge_clips", payload: { leftId: payload.clipId, rightId: payload.newClipId } };
    }
    case "merge_clips": {
      const payload = parseOpPayload("merge_clips", op.payload);
      const left = requireClip(doc, payload.leftId);
      return {
        type: "split_clip",
        payload: { clipId: payload.leftId, atFrame: clipEnd(left), newClipId: payload.rightId },
      };
    }
    case "trim_clip": {
      const payload = parseOpPayload("trim_clip", op.payload);
      const clip = requireClip(doc, payload.clipId);
      return {
        type: "trim_clip",
        payload: {
          clipId: payload.clipId,
          inFrame: clip.source?.inFrame,
          durationFrames: clip.durationFrames,
        },
      };
    }
    case "move_clip": {
      const payload = parseOpPayload("move_clip", op.payload);
      const clip = requireClip(doc, payload.clipId);
      return {
        type: "move_clip",
        payload: {
          clipId: payload.clipId,
          trackId: clip.trackId,
          timelineStartFrame: clip.timelineStartFrame,
        },
      };
    }
    case "set_source": {
      const payload = parseOpPayload("set_source", op.payload);
      const clip = requireClip(doc, payload.clipId);
      if (!clip.source) {
        return { type: "set_source", payload: { clipId: payload.clipId, clear: true } };
      }
      return {
        type: "set_source",
        payload: { clipId: payload.clipId, assetId: clip.source.assetId, inFrame: clip.source.inFrame },
      };
    }
    case "set_clip_status": {
      const payload = parseOpPayload("set_clip_status", op.payload);
      const clip = requireClip(doc, payload.clipId);
      return {
        type: "set_clip_status",
        payload: { clipId: payload.clipId, status: clip.status, jobId: clip.jobId },
      };
    }
    case "set_volume": {
      const payload = parseOpPayload("set_volume", op.payload);
      const clip = requireClip(doc, payload.clipId);
      return { type: "set_volume", payload: { clipId: payload.clipId, volume: clip.volume ?? 1 } };
    }
    case "set_title": {
      const payload = parseOpPayload("set_title", op.payload);
      const clip = requireClip(doc, payload.clipId);
      if (!clip.title) {
        return { type: "set_title", payload: { clipId: payload.clipId, unset: true } };
      }
      return {
        type: "set_title",
        payload: { clipId: payload.clipId, text: clip.title.text, style: clip.title.style },
      };
    }
    case "set_caption": {
      const payload = parseOpPayload("set_caption", op.payload);
      const clip = requireClip(doc, payload.clipId);
      if (!clip.caption) {
        return { type: "set_caption", payload: { clipId: payload.clipId, unset: true } };
      }
      return { type: "set_caption", payload: { clipId: payload.clipId, text: clip.caption.text } };
    }
    case "add_asset": {
      const payload = parseOpPayload("add_asset", op.payload);
      return { type: "remove_asset", payload: { assetId: payload.asset.id } };
    }
    case "remove_asset": {
      const payload = parseOpPayload("remove_asset", op.payload);
      const asset = doc.assets[payload.assetId];
      if (!asset) {
        invalidOp(`asset not found: ${payload.assetId}`);
      }
      return { type: "add_asset", payload: { asset: structuredClone(asset) } };
    }
    case "add_ingredient": {
      const payload = parseOpPayload("add_ingredient", op.payload);
      return { type: "remove_ingredient", payload: { id: payload.ingredient.id } };
    }
    case "remove_ingredient": {
      const payload = parseOpPayload("remove_ingredient", op.payload);
      const ingredient = doc.ingredients.find((item) => item.id === payload.id);
      if (!ingredient) {
        invalidOp(`ingredient not found: ${payload.id}`);
      }
      return { type: "add_ingredient", payload: { ingredient: structuredClone(ingredient) } };
    }
    case "set_project": {
      parseOpPayload("set_project", op.payload);
      return {
        type: "set_project",
        payload: {
          name: doc.name,
          fps: doc.fps,
          width: doc.width,
          height: doc.height,
          confirm: true,
        },
      };
    }
    case "review_ack":
      return null;
    case "clear_timeline": {
      parseOpPayload("clear_timeline", op.payload);
      return {
        type: "restore_timeline",
        payload: {
          snapshot: {
            tracks: structuredClone(doc.tracks),
            clips: structuredClone(doc.clips),
          },
        },
      };
    }
    case "restore_timeline": {
      return {
        type: "restore_timeline",
        payload: {
          snapshot: {
            tracks: structuredClone(doc.tracks),
            clips: structuredClone(doc.clips),
          },
        },
      };
    }
    default:
      invalidOp(`unknown op type: ${String((op as ApplyableOp).type)}`);
  }
}

export { projectSchema };
