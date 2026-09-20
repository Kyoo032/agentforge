import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../errors";
import {
  buildSunoMusicPayload,
  extractSunoLyrics,
  extractSunoTracks,
  generateGatewayLyrics,
  generateGatewayMusic,
  generateGatewaySpeech,
  isRelayMissing,
  isSunoFailure,
  isSunoSuccess,
  readSunoFailure,
  sunoTaskId,
} from "./gateway-audio";

const BASE = "https://api.example.test/v1";
const KEY = "test-key";

/** One finished Suno fetch body, in the shape the NewAPI relay documents. */
function finishedJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: "success",
    data: {
      task_id: "task-1",
      action: "MUSIC",
      status: "SUCCESS",
      data: [
        {
          id: "clip-a",
          title: "Rainy Window",
          audio_url: "https://cdn.example/clip-a.mp3",
          image_url: "https://cdn.example/clip-a.png",
          metadata: { duration: 132.4, tags: "lo-fi", prompt: "[Verse]\nrain" },
        },
        {
          id: "clip-b",
          title: "Rainy Window (take 2)",
          audio_url: "https://cdn.example/clip-b.mp3",
          metadata: { duration: "128" },
        },
      ],
      ...overrides,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe("buildSunoMusicPayload", () => {
  it("sends only the description in describe mode", () => {
    expect(buildSunoMusicPayload({ mode: "describe", prompt: "calm lo-fi" })).toEqual({
      gpt_description_prompt: "calm lo-fi",
      make_instrumental: false,
    });
  });

  it("sends lyrics, tags and title in custom mode", () => {
    expect(
      buildSunoMusicPayload({
        mode: "custom",
        lyrics: "[Verse]\nrain",
        style: "lo-fi, mellow",
        title: "Rainy Window",
        instrumental: true,
      }),
    ).toEqual({
      prompt: "[Verse]\nrain",
      tags: "lo-fi, mellow",
      title: "Rainy Window",
      make_instrumental: true,
    });
  });

  it("never mixes the two shapes, so a strict decoder has nothing extra to reject", () => {
    const custom = buildSunoMusicPayload({ mode: "custom", lyrics: "x", prompt: "ignored" });
    expect(custom).not.toHaveProperty("gpt_description_prompt");
    const describe = buildSunoMusicPayload({ mode: "describe", prompt: "x", lyrics: "ignored" });
    expect(describe).not.toHaveProperty("prompt");
  });

  it("caps a runaway paste instead of posting it", () => {
    const payload = buildSunoMusicPayload({ mode: "custom", lyrics: "a".repeat(10_000) });
    expect(String(payload.prompt)).toHaveLength(3_000);
  });
});

describe("parse helpers", () => {
  it("reads a task id whether the relay returns a string or an object", () => {
    expect(sunoTaskId({ code: "success", data: "task-1" })).toBe("task-1");
    expect(sunoTaskId({ data: { task_id: "task-2" } })).toBe("task-2");
    expect(sunoTaskId({ id: "task-3" })).toBe("task-3");
    expect(sunoTaskId({ data: {} })).toBeUndefined();
  });

  it("reads every finished take, not just the first", () => {
    const tracks = extractSunoTracks(finishedJob());
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      url: "https://cdn.example/clip-a.mp3",
      title: "Rainy Window",
      durationSeconds: 132.4,
      imageUrl: "https://cdn.example/clip-a.png",
    });
    // A numeric duration served as a string still counts.
    expect(tracks[1]?.durationSeconds).toBe(128);
  });

  it("ignores a clip whose url is a failure reason rather than media", () => {
    const body = { data: { status: "SUCCESS", data: [{ audio_url: "上游拒绝" }, { audio_url: "" }] } };
    expect(extractSunoTracks(body)).toEqual([]);
  });

  it("reads written lyrics", () => {
    expect(extractSunoLyrics({ data: { status: "SUCCESS", data: { text: "[Verse]\nrain", title: "Rain" } } })).toEqual({
      text: "[Verse]\nrain",
      title: "Rain",
    });
    expect(extractSunoLyrics({ data: { status: "SUCCESS", data: {} } })).toBeNull();
  });

  it("reads a job's own fail reason ahead of the success envelope", () => {
    // NewAPI keeps `code: "success"` on a failed job; the reason lives on the job.
    expect(readSunoFailure({ code: "success", data: { status: "FAILURE", fail_reason: "no channel" } }, "x")).toBe(
      "no channel",
    );
    expect(readSunoFailure({ code: "success", data: {} }, "fallback")).toBe("fallback");
  });

  it("knows which statuses end a poll", () => {
    expect(isSunoSuccess("SUCCESS")).toBe(true);
    expect(isSunoSuccess("IN_PROGRESS")).toBe(false);
    expect(isSunoFailure("FAILURE")).toBe(true);
    expect(isSunoFailure("QUEUED")).toBe(false);
  });

  it("recognises a missing relay mount", () => {
    expect(isRelayMissing(404, {})).toBe(true);
    expect(isRelayMissing(404, { error: { message: "Invalid URL" } })).toBe(true);
    expect(isRelayMissing(401, {})).toBe(false);
  });
});

describe("generateGatewayMusic", () => {
  it("submits beside /v1, polls, and returns both takes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: "success", data: "task-1" }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: "IN_PROGRESS", data: [] } }))
      .mockResolvedValueOnce(jsonResponse(finishedJob()));
    const result = await generateGatewayMusic({
      baseUrl: BASE,
      apiKey: KEY,
      model: "suno_music",
      mode: "describe",
      prompt: "calm lo-fi",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      wait: async () => {},
    });

    // The relay is mounted on the origin, not under /v1.
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.example.test/suno/submit/music");
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://api.example.test/suno/fetch/task-1");
    expect(result.model).toBe("suno_music");
    expect(result.tracks.map((track) => track.url)).toEqual([
      "https://cdn.example/clip-a.mp3",
      "https://cdn.example/clip-b.mp3",
    ]);
  });

  it("does not trust a streaming url while the job is still running", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: "success", data: "task-1" }))
      // A url is already present, but the relay has not called the job finished.
      .mockResolvedValueOnce(jsonResponse(finishedJob({ status: "IN_PROGRESS" })))
      .mockResolvedValueOnce(jsonResponse(finishedJob()));
    const result = await generateGatewayMusic({
      baseUrl: BASE,
      apiKey: KEY,
      model: "suno_music",
      mode: "describe",
      prompt: "calm lo-fi",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      wait: async () => {},
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.tracks).toHaveLength(2);
  });

  it("explains a missing relay mount instead of reporting a generic 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(
      generateGatewayMusic({
        baseUrl: BASE,
        apiKey: KEY,
        model: "suno_music",
        mode: "describe",
        prompt: "x",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        wait: async () => {},
      }),
    ).rejects.toThrow(/\/suno\/submit/);
  });

  it("surfaces the job's fail reason", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: "success", data: "task-1" }))
      .mockResolvedValueOnce(jsonResponse({ code: "success", data: { status: "FAILURE", fail_reason: "no channel" } }));
    await expect(
      generateGatewayMusic({
        baseUrl: BASE,
        apiKey: KEY,
        model: "suno_music",
        mode: "describe",
        prompt: "x",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        wait: async () => {},
      }),
    ).rejects.toThrow("no channel");
  });

  it("gives up rather than polling forever", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: "success", data: "task-1" }))
      .mockResolvedValue(jsonResponse({ data: { status: "IN_PROGRESS", data: [] } }));
    await expect(
      generateGatewayMusic({
        baseUrl: BASE,
        apiKey: KEY,
        model: "suno_music",
        mode: "describe",
        prompt: "x",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        wait: async () => {},
        maxPolls: 2,
      }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("generateGatewayLyrics", () => {
  it("submits to the lyrics action and returns the text", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: "success", data: "task-9" }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { status: "SUCCESS", data: { text: "[Verse]\nrain", title: "Rain" } } }),
      );
    const result = await generateGatewayLyrics({
      baseUrl: BASE,
      apiKey: KEY,
      model: "suno_lyrics",
      prompt: "a song about rain",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      wait: async () => {},
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.example.test/suno/submit/lyrics");
    expect(result).toEqual({ text: "[Verse]\nrain", title: "Rain", model: "suno_lyrics" });
  });
});

describe("generateGatewaySpeech", () => {
  it("posts to the OpenAI-compatible route and returns a data URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "audio/mpeg" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Response);
    const result = await generateGatewaySpeech({
      baseUrl: BASE,
      apiKey: KEY,
      model: "qwen-audio-3.0-tts-flash",
      text: "hello",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.example.test/v1/audio/speech");
    expect(result.url).toBe("data:audio/mpeg;base64,AQID");
  });

  it("refuses an empty body rather than storing a zero-byte track", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "audio/mpeg" }),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);
    await expect(
      generateGatewaySpeech({
        baseUrl: BASE,
        apiKey: KEY,
        model: "qwen-audio-3.0-tts-flash",
        text: "hello",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
