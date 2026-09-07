import { applyOp, type ApplyableOp, type Clip, type EditProject } from "@agentforge/core/edit";

const HUMAN_TOUCH_TYPES = new Set<ApplyableOp["type"]>([
  "trim_clip",
  "move_clip",
  "split_clip",
  "delete_clip",
  "set_volume",
]);

function payloadString(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Clip ids a human op touches (G-06). */
export function clipIdsTouchedByOp(op: ApplyableOp): string[] {
  const ids = new Set<string>();
  const clipId = payloadString(op.payload, "clipId");
  if (clipId) {
    ids.add(clipId);
  }
  const newClipId = payloadString(op.payload, "newClipId");
  if (newClipId) {
    ids.add(newClipId);
  }
  return [...ids];
}

export function isHumanTouchOp(op: ApplyableOp): boolean {
  return HUMAN_TOUCH_TYPES.has(op.type);
}

export function clearClipBadge(clip: Clip): Clip {
  if (!clip.badge) {
    return clip;
  }
  const next = { ...clip };
  delete next.badge;
  return next;
}

/** Human touch on a badged clip clears that clip's badge locally (G-06). */
export function clearBadgesOnHumanTouch(doc: EditProject, clipIds: string[]): EditProject {
  if (clipIds.length === 0) {
    return doc;
  }
  const touched = new Set(clipIds);
  return {
    ...doc,
    clips: doc.clips.map((clip) => (touched.has(clip.id) ? clearClipBadge(clip) : clip)),
  };
}

export function cardIdsClearedByTouch(doc: EditProject, clipIds: string[]): string[] {
  const cards = new Set<string>();
  const touched = new Set(clipIds);
  for (const clip of doc.clips) {
    if (touched.has(clip.id) && clip.badge?.cardId) {
      cards.add(clip.badge.cardId);
    }
  }
  return [...cards];
}

export function applyOwnerOps(doc: EditProject, ops: ApplyableOp[]): EditProject {
  let next = doc;
  const touched: string[] = [];
  for (const op of ops) {
    if (isHumanTouchOp(op)) {
      touched.push(...clipIdsTouchedByOp(op));
    }
    next = applyOp(next, op);
  }
  if (touched.length === 0) {
    return next;
  }
  return clearBadgesOnHumanTouch(next, touched);
}
