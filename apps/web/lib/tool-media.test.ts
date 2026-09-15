import { describe, expect, it } from "vitest";
import { collectToolMediaParts } from "./tool-media";

describe("collectToolMediaParts", () => {
  it("drops a remote https image: the host mirrors it and the turn carries the media path", () => {
    expect(
      collectToolMediaParts({
        success: true,
        backend: "gateway",
        image: "https://cdn.example/lantern.png",
        model: "img-1",
        prompt: "lantern",
      }),
    ).toEqual([]);
  });

  it("returns one image_url part for a success data:image png", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    expect(collectToolMediaParts({ success: true, image: dataUrl })).toEqual([
      { type: "image_url", image_url: { url: dataUrl } },
    ]);
  });

  it("returns one image_url part for a local media path", () => {
    expect(
      collectToolMediaParts({
        success: true,
        image: "/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file",
      }),
    ).toEqual([
      {
        type: "image_url",
        image_url: { url: "/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file" },
      },
    ]);
  });

  it("returns none when success is false", () => {
    expect(
      collectToolMediaParts({
        success: false,
        image: "/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file",
      }),
    ).toEqual([]);
  });

  it("returns a video_url part only for a host-served video", () => {
    expect(
      collectToolMediaParts({
        success: true,
        backend: "gateway",
        video: "/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file",
      }),
    ).toEqual([
      {
        type: "video_url",
        video_url: { url: "/api/v1/media/f66a438a-781a-478b-8e67-c19be7771c20/file" },
      },
    ]);
    expect(collectToolMediaParts({ success: true, video: "https://cdn.example/clip.mp4" })).toEqual([]);
    expect(collectToolMediaParts({ success: true, video: "data:video/mp4;base64,aaa" })).toEqual([]);
  });

  it("ignores random objects", () => {
    expect(collectToolMediaParts(null)).toEqual([]);
    expect(collectToolMediaParts("/api/v1/media/abc/file")).toEqual([]);
    expect(collectToolMediaParts({ ok: true, url: "/api/v1/media/abc/file" })).toEqual([]);
    expect(collectToolMediaParts({ success: true, thumbnail: "/api/v1/media/abc/file" })).toEqual([]);
    expect(collectToolMediaParts({ success: true, image: 42 })).toEqual([]);
    expect(collectToolMediaParts({ success: true, image: "ftp://cdn.example/x.png" })).toEqual([]);
  });
});
