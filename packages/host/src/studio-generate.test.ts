import { describe, expect, it } from "vitest";
import { ApiError, studioVideoFailureStatus } from "@agentforge/core";
import {
  defaultStudioMusicModel,
  listStudioImageModels,
  listStudioMusicModels,
  listStudioVideoModels,
  parseImageGenerateBody,
  parseLyricsWriteBody,
  parseMusicGenerateBody,
  parseVideoGenerateBody,
  studioSpeechUnavailable,
} from "./studio-generate";
import { mediaIdFromUrl } from "./media-id";

describe("parseImageGenerateBody", () => {
  it("requires a prompt", () => {
    expect(() => parseImageGenerateBody({})).toThrow(ApiError);
    expect(() => parseImageGenerateBody({ prompt: "  " })).toThrow(ApiError);
  });

  it("defaults aspect to square", () => {
    expect(parseImageGenerateBody({ prompt: "a lantern" })).toEqual({
      prompt: "a lantern",
      aspect: "square",
      model: undefined,
      imageUrl: undefined,
    });
  });

  it("accepts landscape and model", () => {
    expect(
      parseImageGenerateBody({
        prompt: "a lantern",
        aspect: "landscape",
        model: "gpt-image-2",
      }),
    ).toMatchObject({
      prompt: "a lantern",
      aspect: "landscape",
      model: "gpt-image-2",
    });
  });

  it("rejects unknown aspects", () => {
    expect(() => parseImageGenerateBody({ prompt: "x", aspect: "16:9" })).toThrow(ApiError);
  });
});

describe("parseVideoGenerateBody", () => {
  it("defaults aspect to 16:9", () => {
    expect(parseVideoGenerateBody({ prompt: "waves" })).toEqual({
      prompt: "waves",
      aspect: "16:9",
      model: undefined,
      imageUrl: undefined,
      seconds: undefined,
      resolution: undefined,
    });
  });

  it("accepts still imageUrl and 9:16", () => {
    expect(
      parseVideoGenerateBody({
        prompt: "animate this",
        aspect: "9:16",
        imageUrl: "https://cdn.example/still.png",
        model: "grok-imagine-video",
      }),
    ).toMatchObject({
      prompt: "animate this",
      aspect: "9:16",
      imageUrl: "https://cdn.example/still.png",
      model: "grok-imagine-video",
    });
  });

  it("rejects a still for t2v-only models (G-20)", () => {
    try {
      parseVideoGenerateBody({
        prompt: "animate",
        imageUrl: "https://cdn.example/still.png",
        model: "omni-fast-v2v",
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("video_still_unsupported");
      expect((error as ApiError).status).toBe(400);
    }
  });

  it("rejects square aspect used by images", () => {
    expect(() => parseVideoGenerateBody({ prompt: "x", aspect: "square" })).toThrow(ApiError);
  });

  it("accepts seconds and resolution knobs", () => {
    expect(
      parseVideoGenerateBody({
        prompt: "waves",
        seconds: 8,
        resolution: "1080p",
      }),
    ).toMatchObject({
      prompt: "waves",
      seconds: 8,
      resolution: "1080p",
    });
    expect(() => parseVideoGenerateBody({ prompt: "x", seconds: 1 })).toThrow(ApiError);
    expect(() => parseVideoGenerateBody({ prompt: "x", resolution: "4k" })).toThrow(ApiError);
  });
});

describe("studio model filters", () => {
  const catalog = [
    { id: "gpt-image-2", label: "GPT Image 2", provider: "openai" as const, inputModalities: ["text" as const] },
    { id: "mj_imagine", label: "MJ", provider: "openai" as const, inputModalities: ["text" as const] },
    {
      id: "grok-imagine-video",
      label: "Grok Video",
      provider: "openai" as const,
      inputModalities: ["text" as const],
    },
    {
      id: "gpt-4o",
      label: "GPT-4o",
      provider: "openai" as const,
      inputModalities: ["text" as const, "image" as const],
    },
  ];

  it("keeps all image models including mj_", () => {
    expect(listStudioImageModels(catalog).map((m) => m.id)).toEqual(["gpt-image-2", "mj_imagine"]);
  });

  it("keeps video models and skips chat", () => {
    expect(listStudioVideoModels(catalog).map((m) => m.id)).toEqual(["grok-imagine-video"]);
  });
});

describe("mediaIdFromUrl", () => {
  it("extracts uuid from local media urls", () => {
    expect(mediaIdFromUrl("/api/v1/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/file")).toBe(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(mediaIdFromUrl("https://cdn.example/out.png")).toBeNull();
  });
});

describe("studioVideoFailureStatus", () => {
  it("keeps 503 for missing video channels", () => {
    expect(studioVideoFailureStatus("No available channel. This video model has no live gateway channel (HTTP 503).")).toBe(
      503,
    );
  });

  it("uses 400 when no gateway key is saved", () => {
    expect(studioVideoFailureStatus("Add a Toko Token gateway key in Settings to generate videos.")).toBe(400);
  });

  it("does not treat prepaid async-price 403 as a rejected key", () => {
    expect(
      studioVideoFailureStatus(
        "代理预付账户的异步任务仅支持发送前可确定上限的固定按次价格 Seedance video on this gateway is billed by tokens after the job finishes, not a fixed per-call price.",
      ),
    ).toBe(400);
  });
});

describe("parseMusicGenerateBody", () => {
  it("defaults to describe mode with no instrumental", () => {
    expect(parseMusicGenerateBody({ prompt: "calm lo-fi" })).toMatchObject({
      mode: "describe",
      prompt: "calm lo-fi",
      instrumental: false,
    });
  });

  it("requires a description in describe mode", () => {
    expect(() => parseMusicGenerateBody({})).toThrow(ApiError);
    expect(() => parseMusicGenerateBody({ prompt: "   " })).toThrow(ApiError);
  });

  it("requires lyrics in custom mode, even with a style and a title", () => {
    expect(() => parseMusicGenerateBody({ mode: "custom", style: "lo-fi", title: "Rain" })).toThrow(ApiError);
  });

  it("accepts a full custom brief", () => {
    expect(
      parseMusicGenerateBody({
        mode: "custom",
        lyrics: "[Verse]\nrain",
        style: "lo-fi, mellow",
        title: "Rainy Window",
        instrumental: true,
        model: "suno_music",
      }),
    ).toMatchObject({
      mode: "custom",
      lyrics: "[Verse]\nrain",
      style: "lo-fi, mellow",
      title: "Rainy Window",
      instrumental: true,
      model: "suno_music",
    });
  });

  it("rejects an unknown mode rather than guessing one", () => {
    expect(() => parseMusicGenerateBody({ mode: "remix", prompt: "x" })).toThrow(ApiError);
  });

  it("refuses a description longer than the relay accepts", () => {
    expect(() => parseMusicGenerateBody({ prompt: "a".repeat(2_000) })).toThrow(ApiError);
  });
});

describe("parseLyricsWriteBody", () => {
  it("requires a prompt", () => {
    expect(() => parseLyricsWriteBody({})).toThrow(ApiError);
    expect(parseLyricsWriteBody({ prompt: "a song about rain" })).toMatchObject({ prompt: "a song about rain" });
  });
});

describe("music model lists", () => {
  const models = [
    { id: "suno_music", label: "suno_music", provider: "openai" as const, inputModalities: ["text" as const] },
    { id: "suno_lyrics", label: "suno_lyrics", provider: "openai" as const, inputModalities: ["text" as const] },
    { id: "whisper-1", label: "whisper-1", provider: "openai" as const, inputModalities: ["text" as const] },
    {
      id: "qwen3-tts-instruct-flash-realtime",
      label: "tts",
      provider: "openai" as const,
      inputModalities: ["text" as const],
    },
  ];

  it("offers only the song generator, never the lyric writer or the transcriber", () => {
    expect(listStudioMusicModels(models).map((model) => model.id)).toEqual(["suno_music"]);
    expect(defaultStudioMusicModel(listStudioMusicModels(models))).toBe("suno_music");
  });

  it("explains that the only speech id on this gateway is realtime", () => {
    expect(studioSpeechUnavailable(models)).toBe("realtime_only");
  });
});
