import { describe, expect, it } from "vitest";
import {
  clampVideoSeconds,
  normalizeVideoResolution,
  usesSeedanceVideoWire,
  videoCapabilities,
} from "./video-capabilities";

describe("videoCapabilities", () => {
  it("enables Seedance-only knobs on Seedance-class models", () => {
    expect(usesSeedanceVideoWire("seedance-2.0-fast")).toBe(true);
    expect(videoCapabilities("seedance-2.0-fast")).toEqual({
      ratio: true,
      resolution: true,
      seconds: true,
      still: true,
      imageToVideo: true,
    });
    expect(videoCapabilities("doubao-seedance-2-0-260128")).toEqual({
      ratio: true,
      resolution: true,
      seconds: true,
      still: true,
      imageToVideo: true,
    });
    expect(videoCapabilities("kling-v1")).toEqual({
      ratio: true,
      resolution: true,
      seconds: true,
      still: true,
      imageToVideo: true,
    });
  });

  it("keeps grok-imagine / default OpenAI-like to seconds + still", () => {
    expect(usesSeedanceVideoWire("grok-imagine-video")).toBe(false);
    expect(videoCapabilities("grok-imagine-video")).toEqual({
      ratio: false,
      resolution: false,
      seconds: true,
      still: true,
      imageToVideo: true,
    });
    expect(videoCapabilities("unknown-video-model")).toEqual({
      ratio: false,
      resolution: false,
      seconds: true,
      still: true,
      imageToVideo: false,
    });
  });

  it("sets imageToVideo fail-closed (G-20)", () => {
    expect(videoCapabilities("dreamina-seedance-2-0-260128").imageToVideo).toBe(true);
    expect(videoCapabilities("veo_3_1").imageToVideo).toBe(true);
    expect(videoCapabilities("sora-2").imageToVideo).toBe(true);
    expect(videoCapabilities("grok-imagine-video-1.5-preview").imageToVideo).toBe(true);
    expect(videoCapabilities("omni-fast-v2v").imageToVideo).toBe(false);
    expect(videoCapabilities("mj_video").imageToVideo).toBe(false);
    expect(videoCapabilities("totally-unknown").imageToVideo).toBe(false);
  });

  it("clamps seconds to 2–12 and resolution to 480p|720p|1080p", () => {
    expect(clampVideoSeconds()).toBe(5);
    expect(clampVideoSeconds(1)).toBe(2);
    expect(clampVideoSeconds(20)).toBe(12);
    expect(clampVideoSeconds(8.4)).toBe(8);
    expect(normalizeVideoResolution()).toBe("720p");
    expect(normalizeVideoResolution("1080p")).toBe("1080p");
    expect(normalizeVideoResolution("4k")).toBe("720p");
  });
});
