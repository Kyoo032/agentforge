/**
 * Meeting mode — the transcription wire.
 *
 * This repo cannot reach api.tokotokenai.com from CI, so the shape of the request is the thing
 * worth pinning: the gateway advertises no audio/transcription endpoint type, and `mimo-v2.5-asr`
 * is documented as taking base64 `input_audio` over chat completions
 * (docs/internal/gateway-model-selection.md §2.1 and row 147). A silent change back to multipart
 * would fail only against the live gateway, which is the worst place to find out.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-meeting-asr-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_RUNTIME = "stub";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;

const KEY = process.env.OPENAI_API_KEY;
const PIN = process.env.AGENTFORGE_MEETING_ASR_MODEL;

let transcribeChunks: typeof import("./transcribe").transcribeChunks;
let resolveMeetingAsr: typeof import("./transcribe").resolveMeetingAsr;
let chunkA = "";
let chunkB = "";

type Call = { url: string; init: RequestInit };

function recorder(reply: (call: Call, index: number) => Response): { calls: Call[]; fetchImpl: typeof fetch } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit };
    calls.push(call);
    return reply(call, calls.length - 1);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function chatReply(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function bodyJson(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

/** An OpenAI-style SSE answer, the shape the streaming families send back. */
function eventStreamReply(deltas: string[]): Response {
  const body = [
    ...deltas.map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`),
    "data: [DONE]",
    "",
  ].join("\n\n");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** What the desk has seen from the gateway, so the chain has something to walk. */
function seedCatalog(ids: string[]): void {
  writeFileSync(
    join(dataDir, "models-cache.json"),
    JSON.stringify({ openai: ids.map((id) => ({ id, label: id, inputModalities: ["text"] })) }),
    "utf8",
  );
}

beforeAll(async () => {
  chunkA = join(dataDir, "chunk-000.mp3");
  chunkB = join(dataDir, "chunk-001.mp3");
  writeFileSync(chunkA, Buffer.from([0xff, 0xfb, 0x90, 0x00]));
  writeFileSync(chunkB, Buffer.from([0xff, 0xfb, 0x91, 0x01]));
  ({ transcribeChunks, resolveMeetingAsr } = await import("./transcribe"));
}, 60_000);

afterEach(() => {
  if (KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = KEY;
  }
  if (PIN === undefined) {
    delete process.env.AGENTFORGE_MEETING_ASR_MODEL;
  } else {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = PIN;
  }
});

afterAll(async () => {
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("resolveMeetingAsr", () => {
  it("reports no_model on a desk whose catalog lists no recogniser", () => {
    delete process.env.AGENTFORGE_MEETING_ASR_MODEL;
    process.env.OPENAI_API_KEY = "sk-test";
    expect(resolveMeetingAsr()).toMatchObject({ available: false, reason: "no_model" });
  });

  it("reports no_key once a model is pinned but nothing pays for it", () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "mimo-v2.5-asr";
    delete process.env.OPENAI_API_KEY;
    expect(resolveMeetingAsr()).toMatchObject({ available: false, reason: "no_key", model: "mimo-v2.5-asr" });
  });

  it("picks the chat wire for the gateway's own ASR id", () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "mimo-v2.5-asr";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(resolveMeetingAsr()).toMatchObject({ available: true, wire: "chat_audio", reason: "ok" });
  });

  it("picks the multipart wire for a whisper-style id", () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "whisper-1";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(resolveMeetingAsr()).toMatchObject({ available: true, wire: "audio_transcriptions" });
  });
});

describe("transcribeChunks over the chat wire", () => {
  it("posts base64 input_audio to /chat/completions on the pinned gateway", async () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "mimo-v2.5-asr";
    process.env.OPENAI_API_KEY = "sk-test";
    const { calls, fetchImpl } = recorder(() => chatReply("Rina: let's start."));
    await transcribeChunks([chunkA], { fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.tokotokenai.com/v1/chat/completions");
    const body = bodyJson(calls[0] as Call);
    expect(body.model).toBe("mimo-v2.5-asr");
    const content = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]?.content ?? [];
    const audio = content.find((part) => part.type === "input_audio") as
      | { input_audio: { data: string; format: string } }
      | undefined;
    expect(audio?.input_audio.format).toBe("mp3");
    expect(audio?.input_audio.data).toBe(Buffer.from([0xff, 0xfb, 0x90, 0x00]).toString("base64"));
    expect(content.some((part) => part.type === "text")).toBe(true);
  });

  it("sends the key as a bearer token and nothing else", async () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "mimo-v2.5-asr";
    process.env.OPENAI_API_KEY = "sk-secret";
    const { calls, fetchImpl } = recorder(() => chatReply("hello"));
    await transcribeChunks([chunkA], { fetchImpl });
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-secret");
    expect(String(calls[0]?.init.body)).not.toContain("sk-secret");
  });

  it("transcribes every chunk in order and keeps each one's offset", async () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "mimo-v2.5-asr";
    process.env.OPENAI_API_KEY = "sk-test";
    const { calls, fetchImpl } = recorder((_call, index) => chatReply(index === 0 ? "First half." : "Second half."));
    const transcript = await transcribeChunks([chunkA, chunkB], { fetchImpl, offsets: [0, 600] });

    expect(calls).toHaveLength(2);
    expect(transcript.segments.map((segment) => segment.text)).toEqual(["First half.", "Second half."]);
    expect(transcript.segments.map((segment) => segment.startSeconds)).toEqual([0, 600]);
    expect(transcript.text).toBe("First half.\n\nSecond half.");
    expect(transcript.source).toBe("gateway");
    expect(transcript.model).toBe("mimo-v2.5-asr");
  });

  it("reads an omni model's content-part array as well as a plain string", async () => {
    // Was pinned to `qwen3.5-omni-flash` before the 2026-09-21 live drive; that family streams now
    // (the data-URI suite below), so a non-streaming id carries this case.
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "gemini-3.5-flash";
    process.env.OPENAI_API_KEY = "sk-test";
    const { fetchImpl } = recorder(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "Spoken words." }] } }] }), {
          status: 200,
        }),
    );
    const transcript = await transcribeChunks([chunkA], { fetchImpl });
    expect(transcript.text).toBe("Spoken words.");
  });

  it("reports a positive step per chunk so the studio can show progress", async () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "mimo-v2.5-asr";
    process.env.OPENAI_API_KEY = "sk-test";
    const seen: Array<[number, number]> = [];
    const { fetchImpl } = recorder(() => chatReply("text"));
    await transcribeChunks([chunkA, chunkB], {
      fetchImpl,
      onChunk: (current, total) => seen.push([current, total]),
    });
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("raises rather than returning a half transcript when the gateway refuses", async () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "mimo-v2.5-asr";
    process.env.OPENAI_API_KEY = "sk-test";
    const { fetchImpl } = recorder(() => new Response("model not found", { status: 404 }));
    await expect(transcribeChunks([chunkA], { fetchImpl })).rejects.toMatchObject({
      code: "transcription_failed",
      status: 400,
    });
  });

  it("maps a gateway 5xx to a 502 so the studio does not blame the owner's input", async () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "mimo-v2.5-asr";
    process.env.OPENAI_API_KEY = "sk-test";
    const { fetchImpl } = recorder(() => new Response("upstream exploded", { status: 503 }));
    await expect(transcribeChunks([chunkA], { fetchImpl })).rejects.toMatchObject({ status: 502 });
  });
});

describe("transcribeChunks over the multipart wire", () => {
  it("posts the file to /audio/transcriptions for a whisper-style id", async () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "whisper-1";
    process.env.OPENAI_API_KEY = "sk-test";
    const { calls, fetchImpl } = recorder(
      () => new Response(JSON.stringify({ text: "From multipart." }), { status: 200 }),
    );
    const transcript = await transcribeChunks([chunkA], { fetchImpl, language: "id" });

    expect(calls[0]?.url).toBe("https://api.tokotokenai.com/v1/audio/transcriptions");
    const form = calls[0]?.init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("id");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(transcript.text).toBe("From multipart.");
  });
});

describe("transcribeChunks with nothing to transcribe with", () => {
  it("refuses with asr_unavailable instead of returning an empty transcript", async () => {
    delete process.env.AGENTFORGE_MEETING_ASR_MODEL;
    seedCatalog([]);
    process.env.OPENAI_API_KEY = "sk-test";
    const { fetchImpl } = recorder(() => chatReply("never reached"));
    await expect(transcribeChunks([chunkA], { fetchImpl })).rejects.toBeInstanceOf(ApiError);
    await expect(transcribeChunks([chunkA], { fetchImpl })).rejects.toMatchObject({
      code: "asr_unavailable",
      status: 503,
    });
  });
});

/**
 * Everything below was learned by driving the live gateway on 2026-09-21. Each expectation stands
 * for a 400 that cost a real call to find, so the shape is pinned per model family rather than as
 * one constant.
 */
describe("the audio payload each model family accepts", () => {
  function audioPart(call: Call): { data: string; format: string } {
    const body = bodyJson(call);
    const content = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]?.content ?? [];
    const part = content.find((item) => item.type === "input_audio") as
      | { input_audio: { data: string; format: string } }
      | undefined;
    return part?.input_audio ?? { data: "", format: "" };
  }

  it("sends the OpenAI audio family bare base64 and no stream flag", async () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "gpt-audio-mini";
    process.env.OPENAI_API_KEY = "sk-test";
    const { calls, fetchImpl } = recorder(() => chatReply("Daniel Brooks: good morning."));
    await transcribeChunks([chunkA], { fetchImpl });

    const audio = audioPart(calls[0] as Call);
    expect(audio.data).toBe(Buffer.from([0xff, 0xfb, 0x90, 0x00]).toString("base64"));
    expect(audio.data.startsWith("data:")).toBe(false);
    expect(bodyJson(calls[0] as Call).stream).toBeUndefined();
  });

  it("sends the qwen/omni family a data URI and asks it to stream", async () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "qwen3-omni-flash-2025-12-01";
    process.env.OPENAI_API_KEY = "sk-test";
    const { calls, fetchImpl } = recorder(() => eventStreamReply(["Good ", "morning", "."]));
    const transcript = await transcribeChunks([chunkA], { fetchImpl });

    const audio = audioPart(calls[0] as Call);
    expect(audio.data).toBe(`data:audio/mp3;base64,${Buffer.from([0xff, 0xfb, 0x90, 0x00]).toString("base64")}`);
    expect(bodyJson(calls[0] as Call).stream).toBe(true);
    expect(transcript.text).toBe("Good morning.");
  });

  it("ignores a keepalive and the [DONE] sentinel while accumulating a stream", async () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "qwen3-omni-flash-2025-12-01";
    process.env.OPENAI_API_KEY = "sk-test";
    const body = [
      ": keepalive",
      `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Only words." } }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const { fetchImpl } = recorder(() => new Response(body, { status: 200 }));
    const transcript = await transcribeChunks([chunkA], { fetchImpl });
    expect(transcript.text).toBe("Only words.");
  });
});

describe("the fallback chain", () => {
  it("moves to the next model when the first one's supply pool is dead", async () => {
    delete process.env.AGENTFORGE_MEETING_ASR_MODEL;
    seedCatalog(["gemini-3.5-flash", "gpt-audio-mini"]);
    process.env.OPENAI_API_KEY = "sk-test";
    const { calls, fetchImpl } = recorder((_call, index) =>
      index === 0
        ? new Response(JSON.stringify({ error: { code: "get_channel_failed", message: "Supply pool unavailable" } }), {
            status: 503,
          })
        : chatReply("Second model heard it."),
    );
    const transcript = await transcribeChunks([chunkA], { fetchImpl });

    expect(calls).toHaveLength(2);
    expect(bodyJson(calls[0] as Call).model).toBe("gemini-3.5-flash");
    expect(bodyJson(calls[1] as Call).model).toBe("gpt-audio-mini");
    expect(transcript.text).toBe("Second model heard it.");
    expect(transcript.model).toBe("gpt-audio-mini");
  });

  it("treats a 200 with no words as a refusal and asks the next model", async () => {
    delete process.env.AGENTFORGE_MEETING_ASR_MODEL;
    seedCatalog(["gemini-3.5-flash", "gpt-audio-mini"]);
    process.env.OPENAI_API_KEY = "sk-test";
    const { calls, fetchImpl } = recorder((_call, index) => chatReply(index === 0 ? "" : "Heard on the retry."));
    const transcript = await transcribeChunks([chunkA], { fetchImpl });
    expect(calls).toHaveLength(2);
    expect(transcript.text).toBe("Heard on the retry.");
  });

  it("asks the model that worked first for every chunk after it", async () => {
    delete process.env.AGENTFORGE_MEETING_ASR_MODEL;
    seedCatalog(["gemini-3.5-flash", "gpt-audio-mini"]);
    process.env.OPENAI_API_KEY = "sk-test";
    const { calls, fetchImpl } = recorder((call) =>
      bodyJson(call).model === "gemini-3.5-flash"
        ? new Response("nope", { status: 503 })
        : chatReply(`chunk ${calls.length}`),
    );
    await transcribeChunks([chunkA, chunkB], { fetchImpl });
    // First chunk: gemini refuses, gpt-audio-mini answers. Second chunk: gpt-audio-mini only.
    expect(calls.map((call) => bodyJson(call).model)).toEqual([
      "gemini-3.5-flash",
      "gpt-audio-mini",
      "gpt-audio-mini",
    ]);
  });

  it("names every model it asked, and what each said, when none of them can read it", async () => {
    delete process.env.AGENTFORGE_MEETING_ASR_MODEL;
    seedCatalog(["gemini-3.5-flash", "gpt-audio-mini"]);
    process.env.OPENAI_API_KEY = "sk-test";
    const { fetchImpl } = recorder(
      () =>
        new Response(JSON.stringify({ error: { message: "Supply pool unavailable" } }), {
          status: 503,
        }),
    );
    const failure = await transcribeChunks([chunkA], { fetchImpl }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("transcription_failed");
    expect((failure as Error).message).toContain("gemini-3.5-flash");
    expect((failure as Error).message).toContain("gpt-audio-mini");
    expect((failure as Error).message).toContain("Supply pool unavailable");
  });

  it("honours a pinned model without quietly substituting another", async () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "mimo-v2.5-asr";
    seedCatalog(["gemini-3.5-flash", "gpt-audio-mini"]);
    process.env.OPENAI_API_KEY = "sk-test";
    const { calls, fetchImpl } = recorder(() => new Response("model not found", { status: 404 }));
    await expect(transcribeChunks([chunkA], { fetchImpl })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
    expect(bodyJson(calls[0] as Call).model).toBe("mimo-v2.5-asr");
  });
});

describe("the per-request budget", () => {
  it("bounds the call even when the caller supplies its own abort signal", async () => {
    process.env.AGENTFORGE_MEETING_ASR_MODEL = "gpt-audio-mini";
    process.env.OPENAI_API_KEY = "sk-test";
    const controller = new AbortController();
    const { calls, fetchImpl } = recorder(() => chatReply("text"));
    await transcribeChunks([chunkA], { fetchImpl, signal: controller.signal });
    // PR #66 finding 7: the caller's signal used to REPLACE the timeout, so a hung gateway call
    // waited for the browser to disconnect. It is now composed with one.
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init.signal).not.toBe(controller.signal);
  });

  it("gives up rather than walking the chain when the caller has cancelled", async () => {
    delete process.env.AGENTFORGE_MEETING_ASR_MODEL;
    seedCatalog(["gemini-3.5-flash", "gpt-audio-mini"]);
    process.env.OPENAI_API_KEY = "sk-test";
    const controller = new AbortController();
    const { calls, fetchImpl } = recorder(() => {
      controller.abort();
      throw new Error("aborted");
    });
    await expect(transcribeChunks([chunkA], { fetchImpl, signal: controller.signal })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
