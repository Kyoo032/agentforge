import { describe, expect, it } from "vitest";
import { emptyProject, type Asset, type Clip, type EditProject } from "@agentforge/core/edit";
import { imageClipAt, previewMediaAt } from "./edit-preview-media";

function clip(partial: Partial<Clip> & Pick<Clip, "id">): Clip {
  return {
    trackId: "v1",
    timelineStartFrame: 0,
    durationFrames: 90,
    status: "ready",
    ...partial,
  };
}

function asset(partial: Partial<Asset> & Pick<Asset, "id" | "kind">): Asset {
  return { mediaId: `media-${partial.id}`, storagePath: `edit/p1/${partial.id}`, ...partial };
}

function project(assets: Asset[], clips: Clip[]): EditProject {
  const doc = emptyProject({ id: "p1", workspaceId: "w1", name: "Loop", aspect: "16:9" });
  return {
    ...doc,
    assets: Object.fromEntries(assets.map((item) => [item.id, item])),
    clips,
  };
}

describe("previewMediaAt", () => {
  it("returns null when nothing sits under the playhead", () => {
    const doc = project([asset({ id: "a1", kind: "video" })], [clip({ id: "c1", source: { assetId: "a1", inFrame: 0 } })]);
    expect(previewMediaAt(doc, 90)).toBeNull();
  });

  it("resolves a video clip to a video media entry with the source offset applied", () => {
    const doc = project(
      [asset({ id: "a1", kind: "video" })],
      [clip({ id: "c1", timelineStartFrame: 30, source: { assetId: "a1", inFrame: 15 } })],
    );
    expect(previewMediaAt(doc, 45)).toEqual({
      clipId: "c1",
      kind: "video",
      mediaId: "media-a1",
      localFrame: 30,
    });
  });

  it("resolves an image asset (generated still) to an image media entry", () => {
    const doc = project([asset({ id: "img", kind: "image" })], [clip({ id: "c1", source: { assetId: "img", inFrame: 0 } })]);
    expect(previewMediaAt(doc, 10)).toEqual({ clipId: "c1", kind: "image", mediaId: "media-img", localFrame: 10 });
  });

  it("falls back to the still image while a generated video is still pending", () => {
    const doc = project(
      [asset({ id: "still", kind: "image" })],
      [clip({ id: "c1", status: "pending", fallbackAssetId: "still" })],
    );
    expect(previewMediaAt(doc, 0)).toEqual({ clipId: "c1", kind: "image", mediaId: "media-still", localFrame: 0 });
  });

  it("returns null when the asset has no media id yet", () => {
    const doc = project([asset({ id: "a1", kind: "video", mediaId: undefined })], [clip({ id: "c1", source: { assetId: "a1", inFrame: 0 } })]);
    expect(previewMediaAt(doc, 0)).toBeNull();
  });

  it("imageClipAt returns the image clip under the playhead and nothing for video or fallback stills", () => {
    const doc = project(
      [asset({ id: "img", kind: "image" }), asset({ id: "vid", kind: "video" }), asset({ id: "still", kind: "image" })],
      [
        clip({ id: "c1", source: { assetId: "img", inFrame: 0 } }),
        clip({ id: "c2", timelineStartFrame: 90, source: { assetId: "vid", inFrame: 0 } }),
        clip({ id: "c3", timelineStartFrame: 180, status: "pending", fallbackAssetId: "still" }),
      ],
    );
    expect(imageClipAt(doc, 10)).toEqual({ clipId: "c1", assetId: "img", mediaId: "media-img" });
    expect(imageClipAt(doc, 100)).toBeNull();
    expect(imageClipAt(doc, 200)).toBeNull();
    expect(imageClipAt(doc, 400)).toBeNull();
  });

  it("ignores audio and caption clips when picking the visual", () => {
    const doc = project(
      [asset({ id: "song", kind: "audio" })],
      [
        clip({ id: "audio", trackId: "a1", source: { assetId: "song", inFrame: 0 } }),
        clip({ id: "cap", trackId: "c1", caption: { text: "hi" } }),
      ],
    );
    expect(previewMediaAt(doc, 0)).toBeNull();
  });
});
