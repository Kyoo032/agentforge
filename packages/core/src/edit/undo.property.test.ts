import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_TITLE_STYLE, emptyProject, type Asset, type Clip, type EditProject } from "./document";
import { applyOp, computeInverse, type ApplyableOp } from "./ops";

function seedDoc(): EditProject {
  const base = emptyProject({ id: "p1", workspaceId: "ws1", name: "Undo", aspect: "16:9", fps: 30 });
  const asset: Asset = { id: "asset-v", kind: "video", storagePath: "media/a.mp4", durationFrames: 600 };
  let doc = applyOp(base, { type: "add_asset", payload: { asset } });
  const clip: Clip = {
    id: "clip-1",
    trackId: "v1",
    timelineStartFrame: 0,
    durationFrames: 90,
    status: "ready",
    source: { assetId: "asset-v", inFrame: 0 },
    volume: 1,
  };
  doc = applyOp(doc, { type: "add_clip", payload: { clip } });
  return doc;
}

function snapshot(doc: EditProject) {
  return {
    name: doc.name,
    fps: doc.fps,
    width: doc.width,
    height: doc.height,
    tracks: doc.tracks,
    clips: [...doc.clips].sort((a, b) => a.id.localeCompare(b.id)),
    assets: doc.assets,
    ingredients: doc.ingredients,
    review: doc.review,
  };
}

function opsFor(doc: EditProject): ApplyableOp[] {
  const clip = doc.clips[0];
  if (!clip) {
    return [];
  }
  return [
    { type: "trim_clip", payload: { clipId: clip.id, durationFrames: 40, inFrame: 2 } },
    { type: "move_clip", payload: { clipId: clip.id, trackId: "v1", timelineStartFrame: 15 } },
    { type: "set_volume", payload: { clipId: clip.id, volume: 0.25 } },
    { type: "set_title", payload: { clipId: clip.id, text: "Hi", style: DEFAULT_TITLE_STYLE } },
    { type: "split_clip", payload: { clipId: clip.id, atFrame: clip.timelineStartFrame + 20, newClipId: "clip-split" } },
    { type: "set_project", payload: { name: "After", width: 1080, height: 1920, confirm: true } },
    { type: "add_ingredient", payload: { ingredient: { id: "ing-1", name: "@photo-1" } } },
    { type: "clear_timeline", payload: { confirm: true } },
    { type: "add_clip", payload: { clip: { ...clip, id: "clip-extra", timelineStartFrame: 200 } } },
    { type: "set_clip_status", payload: { clipId: clip.id, status: "failed" } },
  ];
}

describe("computeInverse G-05", () => {
  it("restores the document when the inverse is applied at undo time", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9 }), (index) => {
        const doc = seedDoc();
        const op = opsFor(doc)[index];
        if (!op) {
          return;
        }
        const inverse = computeInverse(doc, op);
        if (!inverse) {
          return;
        }
        const after = applyOp(doc, op);
        const undone = applyOp(after, inverse);
        expect(snapshot(undone)).toEqual(snapshot(doc));
      }),
      { numRuns: 30 },
    );
  });
});
