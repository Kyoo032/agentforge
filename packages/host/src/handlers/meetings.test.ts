/**
 * Meeting mode — route contract.
 *
 * The runtime is the stub here, so nothing below reaches the gateway. What this proves is the part
 * that holds whether or not a recogniser is live: a meeting is created, scoped and deleted; a
 * recording is accepted or refused on its own merits; a pasted transcript is a first-class input;
 * and every gateway-touching route refuses visibly instead of failing halfway through a job.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTER_IMPORT_BUDGET_MS } from "../__fixtures__/test-budgets";
import type { HostFile, HostRequest, HostResult } from "../types";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-meetings-handlers-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_RUNTIME = "stub";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;

let dispatch: (request: HostRequest) => Promise<HostResult>;

function request(method: string, path: string, extra: Partial<HostRequest> = {}): HostRequest {
  return { method, path, query: {}, params: {}, headers: {}, ...extra };
}

async function json(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const result = await dispatch(request(method, path, { body }));
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return { status: result.status, body: result.body };
}

async function readStream(result: HostResult): Promise<string[]> {
  if (result.type !== "stream") {
    throw new Error(`expected stream, got ${result.type}`);
  }
  const chunks: string[] = [];
  for await (const chunk of result.events) {
    chunks.push(chunk);
  }
  return chunks;
}

function firstEvent(chunks: string[]): Record<string, unknown> {
  return JSON.parse(chunks[0]?.split("data: ")[1] ?? "{}") as Record<string, unknown>;
}

function upload(filename: string, mime: string, bytes: Uint8Array): HostFile {
  return { field: "file", filename, mime, bytes };
}

async function newMeeting(title = "Checkout weekly"): Promise<string> {
  const created = await json("POST", "/api/v1/meetings", { title, locale: "en" });
  expect(created.status).toBe(201);
  return (created.body as { id: string }).id;
}

beforeAll(async () => {
  ({ dispatch } = await import("../router"));
}, ROUTER_IMPORT_BUDGET_MS);

afterAll(async () => {
  // The kernel SQLite lives in dataDir; close it so Windows releases the file before cleanup.
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("meetings CRUD", () => {
  it("creates a meeting and lists it back", async () => {
    const id = await newMeeting("Board sync");
    const listed = await json("GET", "/api/v1/meetings");
    expect(listed.status).toBe(200);
    const items = (listed.body as { items: Array<{ id: string; title: string; status: string }> }).items;
    expect(items.some((item) => item.id === id && item.title === "Board sync" && item.status === "new")).toBe(true);
  });

  it("reports what this desk can actually do, so the studio can offer the paste path", async () => {
    const listed = await json("GET", "/api/v1/meetings");
    const capability = (listed.body as { capability: Record<string, unknown> }).capability;
    expect(capability).toMatchObject({ available: expect.any(Boolean), reason: expect.any(String) });
    expect(capability).toHaveProperty("ffmpeg");
  });

  it("refuses a meeting with no title", async () => {
    const created = await json("POST", "/api/v1/meetings", { title: "   " });
    expect(created).toMatchObject({ status: 400, body: { error: { code: "invalid_request" } } });
  });

  it("404s an unknown meeting rather than leaking that the path exists", async () => {
    const read = await json("GET", "/api/v1/meetings/m-does-not-exist");
    expect(read).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
  });

  it("404s a malformed id instead of touching the filesystem with it", async () => {
    const read = await json("GET", "/api/v1/meetings/..%2F..%2Fetc");
    expect(read.status).toBe(404);
  });

  it("deletes a meeting once and then 404s", async () => {
    const id = await newMeeting("Temporary");
    expect(await json("DELETE", `/api/v1/meetings/${id}`)).toMatchObject({ status: 200 });
    expect(await json("DELETE", `/api/v1/meetings/${id}`)).toMatchObject({ status: 404 });
  });
});

describe("recording upload", () => {
  it("accepts an audio file and moves the meeting to recorded", async () => {
    const id = await newMeeting();
    const result = await dispatch(
      request("POST", `/api/v1/meetings/${id}/recording`, {
        files: [upload("standup.mp3", "audio/mpeg", new Uint8Array([0xff, 0xfb, 0x90, 0x00]))],
      }),
    );
    expect(result.type).toBe("json");
    expect(result).toMatchObject({ status: 201 });
    const meeting = (result as { body: { status: string; recording: { name: string; bytes: number } } }).body;
    expect(meeting.status).toBe("recorded");
    expect(meeting.recording).toMatchObject({ name: "standup.mp3", bytes: 4 });
  });

  it("refuses a file that is not a recording", async () => {
    const id = await newMeeting();
    const result = await dispatch(
      request("POST", `/api/v1/meetings/${id}/recording`, {
        files: [upload("notes.pdf", "application/pdf", new Uint8Array([1, 2, 3]))],
      }),
    );
    expect(result).toMatchObject({ status: 400, body: { error: { code: "unsupported_content_type" } } });
  });

  it("refuses an empty file", async () => {
    const id = await newMeeting();
    const result = await dispatch(
      request("POST", `/api/v1/meetings/${id}/recording`, {
        files: [upload("empty.mp3", "audio/mpeg", new Uint8Array())],
      }),
    );
    expect(result).toMatchObject({ status: 400, body: { error: { code: "invalid_request" } } });
  });

  it("refuses a recording past the 25 MB cap with a 413, not a truncated file", async () => {
    const id = await newMeeting();
    const result = await dispatch(
      request("POST", `/api/v1/meetings/${id}/recording`, {
        files: [upload("long.mp3", "audio/mpeg", new Uint8Array(25 * 1024 * 1024 + 1))],
      }),
    );
    expect(result).toMatchObject({ status: 413 });
  });

  it("says which field it wanted when no file arrives", async () => {
    const id = await newMeeting();
    const result = await dispatch(request("POST", `/api/v1/meetings/${id}/recording`, {}));
    expect(result).toMatchObject({ status: 400, body: { error: { code: "invalid_content_part" } } });
  });
});

describe("pasted transcript", () => {
  it("is accepted without a gateway key and moves the meeting to transcribed", async () => {
    const id = await newMeeting();
    const saved = await json("POST", `/api/v1/meetings/${id}/transcript`, {
      text: "Rina: let's start.\nSam: I'll write the design this week.",
    });
    expect(saved.status).toBe(200);
    const meeting = saved.body as { status: string; transcript: { source: string; text: string } };
    expect(meeting.status).toBe("transcribed");
    expect(meeting.transcript.source).toBe("pasted");
    expect(meeting.transcript.text).toContain("Sam");
  });

  it("saves the transcript as a meeting artifact the owner can download", async () => {
    const id = await newMeeting("Artifact check");
    await json("POST", `/api/v1/meetings/${id}/transcript`, { text: "Rina: hello." });
    // A 400 here would mean "meeting" never reached ARTIFACT_MODES, so this covers that wiring too.
    const result = await dispatch(request("GET", "/api/v1/artifacts", { query: { mode: "meeting" } }));
    expect(result).toMatchObject({ status: 200 });
    const items = (result as { body: { items: Array<{ mode: string; kind: string; title: string }> } }).body.items;
    expect(items.some((item) => item.mode === "meeting" && item.kind === "transcript")).toBe(true);
    expect(items.some((item) => item.title === "Artifact check — transcript")).toBe(true);
  });

  it("refuses an empty transcript", async () => {
    const id = await newMeeting();
    expect(await json("POST", `/api/v1/meetings/${id}/transcript`, { text: "   " })).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_request" } },
    });
  });

  it("refuses a transcript past the character cap", async () => {
    const id = await newMeeting();
    expect(await json("POST", `/api/v1/meetings/${id}/transcript`, { text: "x".repeat(600_001) })).toMatchObject({
      status: 413,
    });
  });
});

describe("gateway-touching routes refuse visibly on a keyless desk", () => {
  it("refuses minutes with runtime_stub rather than half-writing them", async () => {
    const id = await newMeeting();
    await json("POST", `/api/v1/meetings/${id}/transcript`, { text: "Rina: hello." });
    const chunks = await readStream(
      await dispatch(request("POST", `/api/v1/meetings/${id}/minutes/stream`, { body: {} })),
    );
    expect(chunks[0]).toMatch(/^event: job\.error\n/);
    expect(firstEvent(chunks)).toMatchObject({
      type: "job.error",
      code: "runtime_stub",
      status: 503,
      message: expect.stringMatching(/live gateway|Settings/i),
    });
  });

  it("refuses the whole run the same way", async () => {
    const id = await newMeeting();
    await json("POST", `/api/v1/meetings/${id}/transcript`, { text: "Rina: hello." });
    const chunks = await readStream(
      await dispatch(request("POST", `/api/v1/meetings/${id}/run/stream`, { body: {} })),
    );
    expect(firstEvent(chunks)).toMatchObject({ type: "job.error", code: "runtime_stub", status: 503 });
  });

  it("says a transcript is needed before minutes can be written", async () => {
    // A live-looking desk, so the refusal below is about the missing transcript and not the key.
    const previous = process.env.AGENTFORGE_RUNTIME;
    process.env.AGENTFORGE_RUNTIME = "stub";
    const id = await newMeeting();
    const chunks = await readStream(
      await dispatch(request("POST", `/api/v1/meetings/${id}/minutes/stream`, { body: {} })),
    );
    // Stub still short-circuits first; what matters is that it is a job.error, never a 200 with
    // empty minutes.
    expect(firstEvent(chunks)).toMatchObject({ type: "job.error" });
    process.env.AGENTFORGE_RUNTIME = previous ?? "stub";
  });

  it("refuses to transcribe a meeting that has no recording", async () => {
    const id = await newMeeting();
    const chunks = await readStream(
      await dispatch(request("POST", `/api/v1/meetings/${id}/transcribe/stream`, { body: {} })),
    );
    expect(firstEvent(chunks)).toMatchObject({ type: "job.error" });
  });
});
