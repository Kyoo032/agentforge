import { describe, expect, it } from "vitest";
import {
  mediaKind,
  pickPreferredImageModel,
  pickPreferredVideoModel,
  DEFAULT_GATEWAY_IMAGE_MODEL,
  DEFAULT_GATEWAY_VIDEO_MODEL,
} from "./media-kind";

describe("mediaKind", () => {
  it("keeps chat models as chat", () => {
    expect(mediaKind("gpt-5.6-sol")).toBe("chat");
    expect(mediaKind("claude-sonnet-5")).toBe("chat");
    expect(mediaKind("gemini-3.5-flash")).toBe("chat");
    expect(mediaKind("doubao-seed-2-0-pro-260215")).toBe("chat");
    expect(mediaKind("omni-fast")).toBe("chat");
  });

  it("classifies Toko Token image catalog ids", () => {
    expect(mediaKind("gpt-image-2")).toBe("image");
    expect(mediaKind("grok-imagine-image-quality")).toBe("image");
    expect(mediaKind("z-image-turbo")).toBe("image");
    expect(mediaKind("qwen-image-2.0")).toBe("image");
    expect(mediaKind("nano-banana-2")).toBe("image");
    expect(mediaKind("gemini-2.5-flash-image")).toBe("image");
    expect(mediaKind("wan2.7-image")).toBe("image");
    expect(mediaKind("doubao-seedream-4-0-250828")).toBe("image");
    expect(mediaKind("mj_imagine")).toBe("image");
    expect(mediaKind("qwen-image-edit")).toBe("image");
  });

  it("classifies Toko Token video catalog ids", () => {
    expect(mediaKind("grok-imagine-video")).toBe("video");
    expect(mediaKind("seedance-2.0-fast")).toBe("video");
    expect(mediaKind("doubao-seedance-2-0-260128")).toBe("video");
    expect(mediaKind("veo_3_1-fast")).toBe("video");
    expect(mediaKind("happyhorse-1.1-t2v")).toBe("video");
    expect(mediaKind("mj_video")).toBe("video");
    expect(mediaKind("omni-fast-v2v")).toBe("video");
  });

  it("classifies audio and embeddings as non-chat", () => {
    expect(mediaKind("suno_music")).toBe("audio");
    expect(mediaKind("whisper-1")).toBe("audio");
    expect(mediaKind("text-embedding-3-small")).toBe("other");
  });
});

describe("pickPreferredImageModel", () => {
  it("prefers gpt-image-2 over Midjourney action ids", () => {
    expect(
      pickPreferredImageModel(["mj_imagine", "z-image-turbo", "gpt-image-2", "gpt-image-2-count"]),
    ).toBe("gpt-image-2");
  });

  it("falls back to the kernel default", () => {
    expect(pickPreferredImageModel([])).toBe(DEFAULT_GATEWAY_IMAGE_MODEL);
    expect(pickPreferredImageModel(["mj_imagine"])).toBe(DEFAULT_GATEWAY_IMAGE_MODEL);
  });
});

describe("pickPreferredVideoModel", () => {
  it("prefers Grok Imagine video then Seedance Fast", () => {
    expect(pickPreferredVideoModel(["mj_video", "seedance-2.0-fast", "grok-imagine-video"])).toBe(
      "grok-imagine-video",
    );
    expect(pickPreferredVideoModel(["happyhorse-1.1-t2v", "seedance-2.0-fast"])).toBe("seedance-2.0-fast");
  });

  it("falls back to the kernel default", () => {
    expect(pickPreferredVideoModel([])).toBe(DEFAULT_GATEWAY_VIDEO_MODEL);
  });
});
