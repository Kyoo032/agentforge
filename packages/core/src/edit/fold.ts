import { ApiError } from "../errors";
import { projectSchema, type EditProject } from "./document";
import { applyOp, assertAgentOpHasCard, type EditOp } from "./ops";

export function validateDoc(doc: EditProject): EditProject {
  const parsed = projectSchema.parse(doc);
  const trackIds = new Set(parsed.tracks.map((track) => track.id));
  const assetIds = new Set(Object.keys(parsed.assets));
  for (const clip of parsed.clips) {
    if (!trackIds.has(clip.trackId)) {
      throw new ApiError("invalid_op", `dangling clip.trackId: ${clip.trackId}`, 400);
    }
    if (clip.source && !assetIds.has(clip.source.assetId)) {
      throw new ApiError("invalid_op", `dangling clip.source.assetId: ${clip.source.assetId}`, 400);
    }
    if (clip.fallbackAssetId && !assetIds.has(clip.fallbackAssetId)) {
      throw new ApiError("invalid_op", `dangling clip.fallbackAssetId: ${clip.fallbackAssetId}`, 400);
    }
  }
  for (const ingredient of parsed.ingredients) {
    if (ingredient.assetId && !assetIds.has(ingredient.assetId)) {
      throw new ApiError("invalid_op", `dangling ingredient.assetId: ${ingredient.assetId}`, 400);
    }
  }
  return parsed;
}

export function foldOps(base: EditProject, ops: EditOp[]): EditProject {
  const ordered = [...ops].sort((a, b) => a.seq - b.seq);
  let doc = structuredClone(base);
  for (const op of ordered) {
    assertAgentOpHasCard(op);
    doc = applyOp(doc, { type: op.type, payload: op.payload });
    doc.seq = op.seq;
    if (op.actor.startsWith("agent:")) {
      doc.review.lastAgentSeq = op.seq;
    }
  }
  if (ordered.length > 0) {
    doc.updatedAt = ordered[ordered.length - 1]?.createdAt ?? doc.updatedAt;
  }
  return validateDoc(doc);
}
