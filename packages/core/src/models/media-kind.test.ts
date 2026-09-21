import { describe, expect, it } from "vitest";
import {
  mediaKind,
  routeModelsByKind,
  pickPreferredImageModel,
  pickPreferredVideoModel,
  pickPreferredMusicModel,
  pickPreferredEmbeddingModel,
  isEmbeddingModelId,
  isMusicModelId,
  DEFAULT_GATEWAY_IMAGE_MODEL,
  DEFAULT_GATEWAY_VIDEO_MODEL,
  DEFAULT_GATEWAY_MUSIC_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  RELAY_ONLY_MUSIC_MODEL_IDS,
} from "./media-kind";

describe("mediaKind", () => {
  /**
   * Regression: `mimo-v2.5-asr` is the gateway's only speech recogniser and is labelled Audio in
   * gateway-roles.ts, but the AUDIO pattern matched neither its name nor "asr", so it fell through
   * to the chat bucket — offered in the chat model picker, and invisible to every ASR probe.
   */
  it("routes a speech recogniser to audio, not chat", () => {
    expect(mediaKind("mimo-v2.5-asr")).toBe("audio");
    expect(mediaKind("whisper-1")).toBe("audio");
  });

  it("does not treat a chat id that merely contains the letters asr as audio", () => {
    expect(mediaKind("qwen3-disaster-preview")).toBe("chat");
  });

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
    expect(mediaKind("seedance-2.0-mini")).toBe("video");
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
    expect(isEmbeddingModelId("text-embedding-3-small")).toBe(true);
    expect(isEmbeddingModelId("gpt-5.6-luna")).toBe(false);
  });
});

describe("pickPreferredImageModel", () => {
  it("prefers gpt-image-2, then Seedream 5.0 Pro", () => {
    expect(
      pickPreferredImageModel(["mj_imagine", "z-image-turbo", "gpt-image-2", "seedream-5.0-pro", "gpt-image-2-count"]),
    ).toBe("gpt-image-2");
    expect(pickPreferredImageModel(["mj_imagine", "seedream-5.0-pro", "z-image-turbo"])).toBe("seedream-5.0-pro");
  });

  it("falls back to the kernel default", () => {
    expect(pickPreferredImageModel([])).toBe(DEFAULT_GATEWAY_IMAGE_MODEL);
    expect(pickPreferredImageModel(["mj_imagine"])).toBe(DEFAULT_GATEWAY_IMAGE_MODEL);
  });
});

describe("pickPreferredVideoModel", () => {
  it("prefers Veo fast, then cheap Grok Imagine, over Seedance quality ids", () => {
    expect(
      pickPreferredVideoModel(["mj_video", "seedance-2.5", "seedance-2.0-fast", "grok-imagine-video", "veo_3_1-fast"]),
    ).toBe("veo_3_1-fast");
    expect(pickPreferredVideoModel(["mj_video", "seedance-2.5", "seedance-2.0-fast", "grok-imagine-video"])).toBe(
      "grok-imagine-video",
    );
    expect(pickPreferredVideoModel(["omni-fast-v2v", "seedance-2.5"])).toBe("omni-fast-v2v");
    expect(pickPreferredVideoModel(["seedance-2.0-mini", "seedance-2.0-fast"])).toBe("seedance-2.0-mini");
    expect(pickPreferredVideoModel(["doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128"])).toBe(
      "doubao-seedance-2-0-260128",
    );
  });

  it("falls back to the kernel default", () => {
    expect(pickPreferredVideoModel([])).toBe(DEFAULT_GATEWAY_VIDEO_MODEL);
  });
});

const TOKO_IMAGE_IDS = [
  "doubao-seedream-4-0-250828",
  "doubao-seedream-4-5-251128",
  "doubao-seedream-5-0-260128",
  "doubao-seedream-5-0-pro-260628",
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-3.1-flash-lite-image",
  "gpt-image-2",
  "gpt-image-2-count",
  "grok-imagine-image-quality",
  "mj_blend",
  "mj_imagine",
  "mj_upscale",
  "nano-banana-2",
  "nano-banana-pro",
  "qwen-image-2.0",
  "qwen-image-2.0-pro",
  "qwen-image-edit",
  "seedream-4.0",
  "seedream-4.5",
  "seedream-5.0-pro",
  "wan2.7-image",
  "wan2.7-image-pro",
  "z-image-turbo",
];

const TOKO_VIDEO_IDS = [
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
  "doubao-seedance-2-0-mini-260615",
  "dreamina-seedance-2-0-260128",
  "dreamina-seedance-2-0-fast-260128",
  "grok-imagine-video",
  "grok-imagine-video-1.5-preview",
  "happyhorse-1.0-video-edit",
  "happyhorse-1.1-i2v",
  "happyhorse-1.1-r2v",
  "happyhorse-1.1-t2v",
  "mj_video",
  "omni-fast-v2v",
  "seedance-1.0-pro",
  "seedance-1.5-pro",
  "seedance-2.0",
  "seedance-2.0-fast",
  "seedance-2.0-mini",
  "seedance-2.5",
  "veo_3_1",
  "veo_3_1-fast",
];

describe("routeModelsByKind", () => {
  it("puts every Toko Token generate id in image or video, including mj_*", () => {
    const models = [
      { id: "gpt-5.6-sol" },
      { id: "whisper-1" },
      { id: "text-embedding-3-small" },
      ...TOKO_IMAGE_IDS.map((id) => ({ id })),
      ...TOKO_VIDEO_IDS.map((id) => ({ id })),
    ];
    const routed = routeModelsByKind(models);
    expect(routed.chat.map((model) => model.id)).toEqual(["gpt-5.6-sol"]);
    expect(routed.audio.map((model) => model.id)).toEqual(["whisper-1"]);
    expect(routed.other.map((model) => model.id)).toEqual(["text-embedding-3-small"]);
    expect(routed.image.map((model) => model.id)).toEqual(TOKO_IMAGE_IDS);
    expect(routed.video.map((model) => model.id)).toEqual(TOKO_VIDEO_IDS);
    expect(routed.image.some((model) => model.id === "mj_imagine")).toBe(true);
    expect(routed.video.some((model) => model.id === "mj_video")).toBe(true);
  });
});

/**
 * Regression, 2026-09-21: the owner's desk showed an empty, disabled Music picker on a gateway that
 * serves music perfectly well. `GET /v1/models` on a new-api / one-api gateway lists the
 * OpenAI-shaped models only; `suno_music` is driven through a relay mounted on the origin
 * (`POST /suno/submit/music`) and is never in that list, so a picker filtered from the live catalog
 * alone can never contain it.
 */
describe("RELAY_ONLY_MUSIC_MODEL_IDS", () => {
  it("names the gateway's relay music model", () => {
    expect(RELAY_ONLY_MUSIC_MODEL_IDS).toContain(DEFAULT_GATEWAY_MUSIC_MODEL);
    expect(RELAY_ONLY_MUSIC_MODEL_IDS).toContain("suno_music");
  });

  it("holds only ids the music picker would accept, with no duplicates", () => {
    for (const id of RELAY_ONLY_MUSIC_MODEL_IDS) {
      // An id the Music filter would drop again is worse than no entry: it would merge in and vanish.
      expect(isMusicModelId(id)).toBe(true);
      expect(id.trim()).toBe(id);
    }
    const lowered = RELAY_ONLY_MUSIC_MODEL_IDS.map((id) => id.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });

  it("every relay id survives the picker's own preference pass", () => {
    for (const id of RELAY_ONLY_MUSIC_MODEL_IDS) {
      expect(pickPreferredMusicModel([id])).toBe(id);
    }
  });
});

describe("pickPreferredEmbeddingModel", () => {
  it("prefers text-embedding-3-small when live", () => {
    expect(pickPreferredEmbeddingModel(["text-embedding-3-large", "text-embedding-3-small"])).toBe(
      "text-embedding-3-small",
    );
  });

  it("falls back to the kernel default", () => {
    expect(pickPreferredEmbeddingModel([])).toBe(DEFAULT_EMBEDDING_MODEL);
  });
});
