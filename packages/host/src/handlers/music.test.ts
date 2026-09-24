import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ROUTER_IMPORT_BUDGET_MS } from "../__fixtures__/test-budgets";
import { outputLanguageRule } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";

// Isolation: point the data dir (database + media rows) at a temp folder BEFORE the router is imported.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-music-handlers-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;

type Dispatch = (request: HostRequest) => Promise<HostResult>;
let dispatch: Dispatch;

type MusicListBody = {
  items: Array<{
    id: string;
    url: string;
    mime: string;
    title?: string;
    style?: string;
    durationSeconds?: number;
    prompt?: string;
  }>;
  models: Array<{ id: string; price: unknown }>;
  defaultModel: string;
  ready: boolean;
  speechUnavailable: string | null;
};

type MusicPostBody = {
  tracks: Array<{ id: string | null; url: string; title?: string; durationSeconds?: number }>;
  mode: string;
  model: string;
  instrumental: boolean;
  error?: { code?: string; message?: string };
};

function request(method: string, path: string, body?: unknown): HostRequest {
  return { method, path, query: {}, params: {}, headers: {}, ...(body === undefined ? {} : { body }) };
}

async function json(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const result = await dispatch(request(method, path, body));
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return { status: result.status, body: result.body };
}

/** One second of silence is more bytes than this needs; three bytes prove the save path. */
const TRACK_DATA_URL = "data:audio/mpeg;base64,AQID";

const realFetch = globalThis.fetch;

/**
 * Stand in for the gateway's Suno relay: one submit, then one fetch that reports a finished job
 * with two takes. Both takes are data URLs, so `saveGeneratedAudio` mirrors them without a network
 * call and the whole host path — media row, meta sidecar, Knowledge card — runs for real.
 */
function stubRelay(): { calls: string[]; submitted: Array<Record<string, unknown>> } {
  const calls: string[] = [];
  const submitted: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url.includes("/suno/submit/") && typeof init?.body === "string") {
      submitted.push(JSON.parse(init.body) as Record<string, unknown>);
    }
    const body = url.includes("/suno/submit/")
      ? { code: "success", data: "task-1" }
      : {
          code: "success",
          data: {
            status: "SUCCESS",
            data: [
              { title: "Rainy Window", audio_url: TRACK_DATA_URL, metadata: { duration: 131, tags: "lo-fi" } },
              { title: "Rainy Window (take 2)", audio_url: TRACK_DATA_URL, metadata: { duration: 129 } },
            ],
          },
        };
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as typeof fetch;
  return { calls, submitted };
}

describe("music handlers via the router", () => {
  beforeAll(async () => {
    ({ dispatch } = await import("../router"));
  }, ROUTER_IMPORT_BUDGET_MS);

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
  });

  afterAll(async () => {
    const { sql } = await import("@agentforge/db");
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("lists music models with a flat per-track price field and an empty library", async () => {
    const response = await json("GET", "/api/v1/music");
    expect(response.status).toBe(200);
    const body = response.body as MusicListBody;
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.defaultModel).toBe("string");
    expect(body.defaultModel.length).toBeGreaterThan(0);
    for (const row of body.models) {
      expect(row).toHaveProperty("price");
    }
  });

  /**
   * Regression, 2026-09-21. The owner's desk answered `{"models":[],"defaultModel":"suno_music"}`:
   * the gateway's `GET /v1/models` lists OpenAI-shaped models only, and `suno_music` is a relay task
   * model mounted on the origin, so filtering the live catalog could never produce it. The picker
   * rendered empty and disabled while the default pointed at a model the list did not contain.
   */
  it("offers the relay music model even though the live catalog never lists it", async () => {
    const body = (await json("GET", "/api/v1/music")).body as MusicListBody;
    const ids = body.models.map((row) => row.id);
    expect(ids).toContain("suno_music");
    // The picker must be able to show what generate will actually use.
    expect(ids).toContain(body.defaultModel);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports why voice-over is off instead of offering a control that cannot work", async () => {
    const body = (await json("GET", "/api/v1/music")).body as MusicListBody;
    // A stub desk has no catalog at all, so the honest answer is "no audio models", never null.
    expect(body.speechUnavailable).not.toBeNull();
    expect(["no_audio_models", "realtime_only"]).toContain(body.speechUnavailable);
  });

  it("refuses a keyless desk with a Settings hint rather than calling out", async () => {
    const response = await json("POST", "/api/v1/music", { prompt: "calm lo-fi" });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/gateway key/i);
  });

  it("refuses custom mode with no lyrics before it can bill for an empty brief", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const response = await json("POST", "/api/v1/music", { mode: "custom", style: "lo-fi" });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/lyrics/i);
  });

  it("refuses describe mode with no description", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const response = await json("POST", "/api/v1/music", { mode: "describe" });
    expect(response.status).toBe(400);
  });

  it("saves every take of one job and lists them with their own metadata", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const relay = stubRelay();
    const response = await json("POST", "/api/v1/music", {
      prompt: "a calm lo-fi loop",
      style: "lo-fi, mellow",
      instrumental: true,
    });
    expect(response.status).toBe(201);
    const posted = response.body as MusicPostBody;

    // One job, two takes, one charge: dropping a take would throw away something already paid for.
    expect(posted.tracks).toHaveLength(2);
    for (const track of posted.tracks) {
      expect(track.url).toMatch(/^\/api\/v1\/media\/[0-9a-f-]{36}\/file$/i);
      expect(track.id).toBeTruthy();
    }
    expect(relay.calls[0]).toMatch(/\/suno\/submit\/music$/);
    expect(relay.calls[1]).toMatch(/\/suno\/fetch\/task-1$/);

    const listed = (await json("GET", "/api/v1/music")).body as MusicListBody;
    expect(listed.items).toHaveLength(2);
    const newest = listed.items[0];
    expect(newest.mime).toBe("audio/mpeg");
    expect(newest.style).toBe("lo-fi, mellow");
    expect(newest.title).toMatch(/Rainy Window/);
    expect(newest.durationSeconds).toBeGreaterThan(0);
    expect(newest.prompt).toBe("a calm lo-fi loop");
  });

  /**
   * Regression. "My lyrics" used to get the output-language instruction appended to the lyrics, and
   * the relay sends custom-mode `prompt` to Suno as the words to sing: the instruction would have
   * been sung as the last verse.
   */
  it("sends the owner's own lyrics to the relay exactly as written", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const relay = stubRelay();
    const lyrics = "Rain on the window\nI keep the porch light on for you";
    const response = await json("POST", "/api/v1/music", {
      mode: "custom",
      lyrics,
      style: "lo-fi",
      title: "Rainy Window",
    });
    expect(response.status).toBe(201);
    expect(relay.submitted).toHaveLength(1);
    expect(relay.submitted[0]).toMatchObject({ prompt: lyrics, tags: "lo-fi", title: "Rainy Window" });
    expect(relay.submitted[0]).not.toHaveProperty("gpt_description_prompt");
  });

  it("keeps the output-language rule on a described song, where the model writes the words", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const relay = stubRelay();
    const response = await json("POST", "/api/v1/music", { mode: "describe", prompt: "a calm lo-fi loop about rain" });
    expect(response.status).toBe(201);
    const brief = relay.submitted[0]?.gpt_description_prompt;
    expect(typeof brief).toBe("string");
    expect(brief as string).toMatch(/^a calm lo-fi loop about rain/);
    expect(brief as string).toContain(outputLanguageRule("music", "en"));
  });

  it("serves a saved track back as audio bytes", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    stubRelay();
    const posted = (await json("POST", "/api/v1/music", { prompt: "another loop" })).body as MusicPostBody;
    globalThis.fetch = realFetch;
    const mediaId = posted.tracks[0]?.id;
    expect(mediaId).toBeTruthy();
    const file = await dispatch(request("GET", `/api/v1/media/${mediaId}/file`));
    expect(file.type).toBe("bytes");
    if (file.type === "bytes") {
      expect(file.contentType).toBe("audio/mpeg");
      expect(file.bytes.byteLength).toBe(3);
    }
  });

  it("does not let an audio upload in through the chat media route", async () => {
    // Edit owns the wide import path; /api/v1/media stays image and video only (G-27).
    const result = await dispatch({
      method: "POST",
      path: "/api/v1/media",
      query: {},
      params: {},
      headers: {},
      files: [{ field: "file", filename: "a.mp3", mime: "audio/mpeg", bytes: new Uint8Array([1, 2, 3]) }],
    });
    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(400);
    }
  });
});
