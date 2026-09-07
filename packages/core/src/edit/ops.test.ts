import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { DEFAULT_TITLE_STYLE, emptyProject, type Asset, type Clip, type EditProject } from "./document";
import {
  applyOp,
  assertAgentOpHasCard,
  computeInverse,
  moveClipPayloadSchema,
  parseOpPayload,
  type EditOp,
} from "./ops";

function baseDoc(): EditProject {
  return emptyProject({ id: "p1", workspaceId: "ws1", name: "Demo", aspect: "16:9", fps: 30 });
}

function videoAsset(id = "asset-v"): Asset {
  return {
    id,
    kind: "video",
    storagePath: "media/clip.mp4",
    durationFrames: 300,
  };
}

function audioAsset(id = "asset-a"): Asset {
  return {
    id,
    kind: "audio",
    storagePath: "media/talk.wav",
    durationFrames: 300,
  };
}

function videoClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip-1",
    trackId: "v1",
    timelineStartFrame: 0,
    durationFrames: 90,
    status: "ready",
    source: { assetId: "asset-v", inFrame: 0 },
    ...overrides,
  };
}

function withAsset(doc: EditProject, asset: Asset): EditProject {
  return applyOp(doc, { type: "add_asset", payload: { asset } });
}

describe("applyOp catalog", () => {
  it("applies every op type", () => {
    let doc = withAsset(baseDoc(), videoAsset());
    doc = withAsset(doc, audioAsset());
    doc = applyOp(doc, { type: "add_track", payload: { track: { id: "v2", kind: "video", name: "V2" } } });
    expect(doc.tracks.some((track) => track.id === "v2")).toBe(true);

    doc = applyOp(doc, { type: "add_clip", payload: { clip: videoClip() } });
    expect(doc.clips).toHaveLength(1);

    doc = applyOp(doc, { type: "split_clip", payload: { clipId: "clip-1", atFrame: 30, newClipId: "clip-2" } });
    expect(doc.clips).toHaveLength(2);

    doc = applyOp(doc, { type: "merge_clips", payload: { leftId: "clip-1", rightId: "clip-2" } });
    expect(doc.clips).toHaveLength(1);
    expect(doc.clips[0]?.durationFrames).toBe(90);

    doc = applyOp(doc, { type: "trim_clip", payload: { clipId: "clip-1", inFrame: 10, durationFrames: 60 } });
    expect(doc.clips[0]?.source?.inFrame).toBe(10);
    expect(doc.clips[0]?.durationFrames).toBe(60);

    doc = applyOp(doc, { type: "move_clip", payload: { clipId: "clip-1", trackId: "v2", timelineStartFrame: 12 } });
    expect(doc.clips[0]).toMatchObject({ trackId: "v2", timelineStartFrame: 12 });

    doc = applyOp(doc, { type: "set_source", payload: { clipId: "clip-1", assetId: "asset-v", inFrame: 5 } });
    expect(doc.clips[0]?.source).toEqual({ assetId: "asset-v", inFrame: 5 });

    doc = applyOp(doc, { type: "set_clip_status", payload: { clipId: "clip-1", status: "pending", jobId: "job-1" } });
    expect(doc.clips[0]).toMatchObject({ status: "pending", jobId: "job-1" });

    doc = applyOp(doc, { type: "set_volume", payload: { clipId: "clip-1", volume: 0.5 } });
    expect(doc.clips[0]?.volume).toBe(0.5);

    doc = applyOp(doc, {
      type: "set_title",
      payload: { clipId: "clip-1", text: "Hello", style: DEFAULT_TITLE_STYLE },
    });
    expect(doc.clips[0]?.title?.text).toBe("Hello");

    doc = applyOp(doc, {
      type: "add_clip",
      payload: {
        clip: {
          id: "cap-1",
          trackId: "c1",
          timelineStartFrame: 0,
          durationFrames: 30,
          status: "ready",
          caption: { text: "cue" },
        },
      },
    });
    doc = applyOp(doc, { type: "set_caption", payload: { clipId: "cap-1", text: "updated" } });
    expect(doc.clips.find((clip) => clip.id === "cap-1")?.caption?.text).toBe("updated");

    doc = applyOp(doc, { type: "add_ingredient", payload: { ingredient: { id: "ing-1", name: "@photo-1" } } });
    expect(doc.ingredients).toHaveLength(1);
    doc = applyOp(doc, { type: "remove_ingredient", payload: { id: "ing-1" } });
    expect(doc.ingredients).toHaveLength(0);

    doc = applyOp(doc, { type: "set_project", payload: { name: "Renamed" } });
    expect(doc.name).toBe("Renamed");
    doc = applyOp(doc, { type: "set_project", payload: { width: 1080, height: 1920, confirm: true } });
    expect(doc.width).toBe(1080);

    doc = applyOp(doc, { type: "review_ack", payload: { seq: 4 } });
    expect(doc.review.ackSeq).toBe(4);

    const beforeClear = doc;
    const inverse = computeInverse(beforeClear, { type: "clear_timeline", payload: { confirm: true } });
    doc = applyOp(doc, { type: "clear_timeline", payload: { confirm: true } });
    expect(doc.clips).toHaveLength(0);
    if (!inverse) {
      throw new Error("expected restore inverse");
    }
    doc = applyOp(doc, inverse);
    expect(doc.clips.length).toBe(beforeClear.clips.length);

    doc = applyOp(doc, { type: "delete_clip", payload: { clipId: "clip-1" } });
    expect(doc.clips.some((clip) => clip.id === "clip-1")).toBe(false);

    doc = applyOp(doc, { type: "remove_track", payload: { trackId: "v2", confirm: true } });
    expect(doc.tracks.some((track) => track.id === "v2")).toBe(false);

    const extra = applyOp(baseDoc(), { type: "add_asset", payload: { asset: videoAsset("orphan") } });
    const removed = applyOp(extra, { type: "remove_asset", payload: { assetId: "orphan" } });
    expect(removed.assets.orphan).toBeUndefined();
  });
});

describe("op guards", () => {
  it("rejects split outside the clip range", () => {
    let doc = withAsset(baseDoc(), videoAsset());
    doc = applyOp(doc, { type: "add_clip", payload: { clip: videoClip() } });
    expect(() => applyOp(doc, { type: "split_clip", payload: { clipId: "clip-1", atFrame: 0, newClipId: "x" } })).toThrow(
      ApiError,
    );
    expect(() => applyOp(doc, { type: "split_clip", payload: { clipId: "clip-1", atFrame: 90, newClipId: "x" } })).toThrow(
      /strictly inside/,
    );
  });

  it("rejects trim of 0 frames", () => {
    let doc = withAsset(baseDoc(), videoAsset());
    doc = applyOp(doc, { type: "add_clip", payload: { clip: videoClip() } });
    try {
      applyOp(doc, { type: "trim_clip", payload: { clipId: "clip-1", durationFrames: 0 } });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("invalid_op");
    }
  });

  it("rejects move across the wrong track kind", () => {
    let doc = withAsset(baseDoc(), videoAsset());
    doc = applyOp(doc, { type: "add_clip", payload: { clip: videoClip() } });
    expect(() =>
      applyOp(doc, { type: "move_clip", payload: { clipId: "clip-1", trackId: "a1", timelineStartFrame: 0 } }),
    ).toThrow(/clip kind/);
  });

  it("throws confirm_required when clear_timeline lacks confirm", () => {
    try {
      applyOp(baseDoc(), { type: "clear_timeline", payload: { confirm: false } });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("confirm_required");
      expect((error as ApiError).status).toBe(400);
    }
  });

  it("throws card_required for agent ops without cardId (G-01)", () => {
    const op: Pick<EditOp, "actor" | "cardId"> = { actor: "agent:run-1" };
    try {
      assertAgentOpHasCard(op);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("card_required");
      expect((error as ApiError).status).toBe(400);
    }
    expect(() => assertAgentOpHasCard({ actor: "agent:run-1", cardId: "card-1" })).not.toThrow();
    expect(() => assertAgentOpHasCard({ actor: "owner" })).not.toThrow();
  });

  it("rejects index-based placement (G-02)", () => {
    expect(moveClipPayloadSchema.safeParse({ clipId: "c", trackId: "v1", timelineStartFrame: 0, index: 2 }).success).toBe(
      false,
    );
    expect(parseOpPayload("move_clip", { clipId: "c", trackId: "v1", timelineStartFrame: 10 }).timelineStartFrame).toBe(10);
  });
});
