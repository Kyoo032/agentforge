import { describe, expect, it } from "vitest";
import { importedClipDurationFrames, STILL_IMAGE_SECONDS } from "./import-duration";

describe("importedClipDurationFrames", () => {
  it("uses the probed duration for video", () => {
    expect(importedClipDurationFrames({ kind: "video", probedSeconds: 2, probedFps: 25, projectFps: 30 })).toBe(50);
  });

  it("uses the probed duration for audio", () => {
    expect(importedClipDurationFrames({ kind: "audio", probedSeconds: 1.5, probedFps: undefined, projectFps: 30 })).toBe(45);
  });

  it("gives a still image a default hold instead of a single frame", () => {
    expect(importedClipDurationFrames({ kind: "image", probedSeconds: 0.04, probedFps: 25, projectFps: 30 })).toBe(
      30 * STILL_IMAGE_SECONDS,
    );
  });

  it("never returns less than one frame", () => {
    expect(importedClipDurationFrames({ kind: "video", probedSeconds: 0, probedFps: 0, projectFps: 30 })).toBe(1);
  });
});
