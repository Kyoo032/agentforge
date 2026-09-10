import { describe, expect, it } from "vitest";
import { desktopMediaSrc } from "./media-src";

describe("desktopMediaSrc", () => {
  it("leaves every url alone in the browser", () => {
    expect(desktopMediaSrc("/api/v1/media/abc/file", false)).toBe("/api/v1/media/abc/file");
    expect(desktopMediaSrc("/api/v1/videos/examples/daisy-macro.mp4/file", false)).toBe(
      "/api/v1/videos/examples/daisy-macro.mp4/file",
    );
    expect(desktopMediaSrc("https://cdn.example/a.mp4", false)).toBe("https://cdn.example/a.mp4");
  });

  it("maps gallery media to agentforge://media in the desktop shell", () => {
    expect(desktopMediaSrc("/api/v1/media/abc-123/file", true)).toBe("agentforge://media/abc-123");
  });

  it("maps bundled example clips to agentforge://video-example in the desktop shell", () => {
    expect(desktopMediaSrc("/api/v1/videos/examples/daisy-macro.mp4/file", true)).toBe(
      "agentforge://video-example/daisy-macro.mp4",
    );
  });

  it("passes remote and unknown urls through unchanged in the desktop shell", () => {
    expect(desktopMediaSrc("https://cdn.example/a.mp4", true)).toBe("https://cdn.example/a.mp4");
    expect(desktopMediaSrc("/api/v1/videos", true)).toBe("/api/v1/videos");
  });
});
