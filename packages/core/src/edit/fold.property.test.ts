import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { emptyProject, type Asset, type Clip, type EditProject } from "./document";
import { applyOp, type ApplyableOp, type EditOp } from "./ops";
import { foldOps, validateDoc } from "./fold";

function seedDoc(): EditProject {
  const base = emptyProject({ id: "p1", workspaceId: "ws1", name: "Prop", aspect: "16:9", fps: 30 });
  const asset: Asset = { id: "asset-v", kind: "video", storagePath: "media/a.mp4", durationFrames: 600 };
  return applyOp(base, { type: "add_asset", payload: { asset } });
}

function envelope(seq: number, op: ApplyableOp): EditOp {
  return {
    id: `op-${seq}`,
    projectId: "p1",
    seq,
    parent: seq === 1 ? null : `op-${seq - 1}`,
    clock: seq,
    actor: "owner",
    type: op.type,
    payload: op.payload,
    inverse: null,
    createdAt: "2026-09-06T00:00:00.000Z",
  };
}

function pickValidOp(doc: EditProject, seed: number): ApplyableOp | null {
  const videoClips = doc.clips.filter((clip) => clip.trackId === "v1" || clip.trackId === "v2");
  const choices: ApplyableOp[] = [];
  if (!doc.tracks.some((track) => track.id === "v2")) {
    choices.push({ type: "add_track", payload: { track: { id: "v2", kind: "video", name: "V2" } } });
  }
  if (videoClips.length < 6) {
    const clip: Clip = {
      id: `clip-${seed}`,
      trackId: "v1",
      timelineStartFrame: (seed % 20) * 10,
      durationFrames: 40 + (seed % 20),
      status: "ready",
      source: { assetId: "asset-v", inFrame: seed % 10 },
    };
    if (!doc.clips.some((item) => item.id === clip.id)) {
      choices.push({ type: "add_clip", payload: { clip } });
    }
  }
  for (const clip of videoClips) {
    if (clip.durationFrames > 4) {
      const atFrame = clip.timelineStartFrame + Math.max(1, Math.floor(clip.durationFrames / 2));
      choices.push({
        type: "split_clip",
        payload: { clipId: clip.id, atFrame, newClipId: `${clip.id}-r-${seed}` },
      });
    }
    if (clip.durationFrames > 1) {
      choices.push({
        type: "trim_clip",
        payload: { clipId: clip.id, durationFrames: Math.max(1, clip.durationFrames - 1) },
      });
    }
    choices.push({
      type: "move_clip",
      payload: { clipId: clip.id, trackId: clip.trackId, timelineStartFrame: clip.timelineStartFrame },
    });
    choices.push({ type: "set_volume", payload: { clipId: clip.id, volume: (seed % 21) / 10 } });
  }
  choices.push({ type: "set_project", payload: { name: `Prop ${seed}` } });
  if (choices.length === 0) {
    return null;
  }
  return choices[seed % choices.length] ?? null;
}

describe("foldOps G-04", () => {
  it("keeps folded docs parseable with no dangling ids", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 10_000 }), { minLength: 1, maxLength: 25 }), (seeds) => {
        const base = seedDoc();
        let current = base;
        const ops: EditOp[] = [];
        let seq = 0;
        for (const seed of seeds) {
          const nextOp = pickValidOp(current, seed);
          if (!nextOp) {
            continue;
          }
          try {
            const preview = applyOp(current, nextOp);
            seq += 1;
            ops.push(envelope(seq, nextOp));
            current = preview;
          } catch {
            // skip ops that collide on generated ids
          }
        }
        const folded = foldOps(base, ops);
        const parsed = validateDoc(folded);
        const trackIds = new Set(parsed.tracks.map((track) => track.id));
        const assetIds = new Set(Object.keys(parsed.assets));
        for (const clip of parsed.clips) {
          expect(trackIds.has(clip.trackId)).toBe(true);
          if (clip.source) {
            expect(assetIds.has(clip.source.assetId)).toBe(true);
          }
          if (clip.fallbackAssetId) {
            expect(assetIds.has(clip.fallbackAssetId)).toBe(true);
          }
        }
      }),
      { numRuns: 40 },
    );
  });
});
