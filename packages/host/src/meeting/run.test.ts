/**
 * Meeting mode — the run, with ffmpeg, the recogniser and the model stubbed at their module seams.
 *
 * What this proves is what a run keeps when a later step fails: the minutes when the translation
 * fails, the bill for the chunks the gateway answered when a later chunk does not, and no chunk
 * cache left on disk whichever step it was.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type TenantContext } from "@agentforge/core";
import type { MeetingMinutes, MeetingTranscript } from "@agentforge/core/meeting";
import type { ExtractedAudio } from "./audio";

// Isolation: this file's own desk, set BEFORE the run (and through it the database) is imported.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-meeting-run-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;

const seams = vi.hoisted(() => ({
  extract: vi.fn(),
  transcribe: vi.fn(),
  ask: vi.fn(),
  usage: vi.fn(),
}));

vi.mock("./audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./audio")>()),
  extractMeetingAudio: seams.extract,
}));
vi.mock("./transcribe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./transcribe")>()),
  resolveMeetingAsr: () => ({
    available: true,
    model: "asr-test",
    wire: "chat_audio",
    candidates: ["asr-test"],
    reason: "ok",
  }),
  transcribeChunks: seams.transcribe,
}));
vi.mock("../job-regen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../job-regen")>()),
  collectJobAssistantRun: seams.ask,
}));
vi.mock("../usage-record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../usage-record")>()),
  recordTranscriptionUsage: seams.usage,
}));
vi.mock("../knowledge-ingest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../knowledge-ingest")>()),
  upsertWorkSource: async () => ({ status: "skipped", reason: "test" }),
}));

type RunModule = typeof import("./run");
type StoreModule = typeof import("./store");
let run: RunModule;
let store: StoreModule;

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org-meeting-run",
  workspaceId: "ws-meeting-run",
  userId: "local",
  role: "owner",
};

/** Three ten-minute chunks: 25 minutes of audio. */
const DURATION_SECONDS = 1500;

const TRANSCRIPT: MeetingTranscript = {
  text: "Dewi: we ship the checkout fix on Friday.",
  segments: [],
  language: "en",
  source: "pasted",
  model: "",
};

function minutes(title: string): MeetingMinutes {
  return {
    title,
    heldOn: "",
    summary: "The team agreed to ship the checkout fix on Friday.",
    attendees: [],
    decisions: [],
    actionItems: [],
    risks: [],
    openQuestions: [],
  };
}

/** Stands in for ffmpeg: writes three chunks where the run asked, and remembers where that was. */
function extractInto(outDirs: string[], after?: () => void) {
  return async (_source: string, outDir: string): Promise<ExtractedAudio> => {
    outDirs.push(outDir);
    mkdirSync(outDir, { recursive: true });
    const files = [0, 1, 2].map((index) => {
      const file = join(outDir, `chunk-00${index}.mp3`);
      writeFileSync(file, "x");
      return file;
    });
    after?.();
    return { files, durationSeconds: DURATION_SECONDS, offsets: [0, 600, 1200] };
  };
}

type ChunkOptions = { onChunk?: (current: number, total: number) => void };

/** Stands in for the recogniser: announces chunks 1..`failAt` and refuses chunk `failAt`. */
function refuseChunk(failAt: number) {
  return async (files: string[], options: ChunkOptions): Promise<MeetingTranscript> => {
    for (let current = 1; current <= failAt; current += 1) {
      options.onChunk?.(current, files.length);
    }
    throw new ApiError("transcription_failed", `chunk ${failAt} was refused`, 502);
  };
}

function newMeeting(): string {
  const created = store.meetingStore().create(tenant, { title: "Checkout weekly", locale: "en" });
  return created.id;
}

function recordedMeeting(): string {
  const id = newMeeting();
  store.meetingStore().addRecording(tenant, id, {
    filename: "call.mp3",
    mime: "audio/mpeg",
    bytes: new Uint8Array([1, 2, 3]),
  });
  return id;
}

beforeAll(async () => {
  store = await import("./store");
  run = await import("./run");
}, 60_000);

beforeEach(() => {
  vi.stubEnv("AGENTFORGE_RUNTIME", "ai");
});

afterEach(() => {
  vi.unstubAllEnvs();
  seams.extract.mockReset();
  seams.transcribe.mockReset();
  seams.ask.mockReset();
  seams.usage.mockReset();
});

afterAll(async () => {
  // The kernel SQLite lives in dataDir; close it so Windows releases the file before cleanup.
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("transcribeMeeting", () => {
  it("bills the chunks the gateway answered when a later chunk is refused", async () => {
    const id = recordedMeeting();
    seams.extract.mockImplementation(extractInto([]));
    seams.transcribe.mockImplementation(refuseChunk(3));

    await expect(run.transcribeMeeting(tenant, id)).rejects.toMatchObject({ code: "transcription_failed" });

    // Chunks one and two answered: twenty minutes of audio the tenant has already paid for.
    expect(seams.usage).toHaveBeenCalledTimes(1);
    expect(seams.usage).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: tenant.workspaceId }), {
      model: "asr-test",
      seconds: 1200,
    });
  });

  it("bills nothing when the very first chunk is refused", async () => {
    const id = recordedMeeting();
    seams.extract.mockImplementation(extractInto([]));
    seams.transcribe.mockImplementation(refuseChunk(1));

    await expect(run.transcribeMeeting(tenant, id)).rejects.toMatchObject({ code: "transcription_failed" });
    expect(seams.usage).not.toHaveBeenCalled();
  });

  it("bills the whole recording once when every chunk answered", async () => {
    const id = recordedMeeting();
    seams.extract.mockImplementation(extractInto([]));
    seams.transcribe.mockImplementation(async (files: string[], options: ChunkOptions) => {
      for (let current = 1; current <= files.length; current += 1) {
        options.onChunk?.(current, files.length);
      }
      return { ...TRANSCRIPT, source: "gateway", model: "asr-test" };
    });

    const record = await run.transcribeMeeting(tenant, id);

    expect(record.status).toBe("transcribed");
    expect(seams.usage).toHaveBeenCalledTimes(1);
    expect(seams.usage).toHaveBeenCalledWith(expect.anything(), { model: "asr-test", seconds: DURATION_SECONDS });
  });

  it("clears the chunk cache when ffmpeg fails part-way through", async () => {
    const id = recordedMeeting();
    const outDirs: string[] = [];
    seams.extract.mockImplementation(async (_source: string, outDir: string) => {
      outDirs.push(outDir);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "chunk-000.mp3"), "x");
      throw new ApiError("ffmpeg_failed", "ffmpeg recipe failed", 502);
    });

    await expect(run.transcribeMeeting(tenant, id)).rejects.toMatchObject({ code: "ffmpeg_failed" });
    expect(outDirs).toHaveLength(1);
    expect(existsSync(outDirs[0] as string)).toBe(false);
    expect(seams.transcribe).not.toHaveBeenCalled();
  });

  it("clears the chunk cache when the client leaves as the audio is ready", async () => {
    const id = recordedMeeting();
    const outDirs: string[] = [];
    const controller = new AbortController();
    seams.extract.mockImplementation(extractInto(outDirs, () => controller.abort()));

    await expect(run.transcribeMeeting(tenant, id, { abortSignal: controller.signal })).rejects.toMatchObject({
      code: "aborted",
    });
    expect(existsSync(outDirs[0] as string)).toBe(false);
    expect(seams.transcribe).not.toHaveBeenCalled();
  });

  it("clears the chunk cache when the recogniser fails", async () => {
    const id = recordedMeeting();
    const outDirs: string[] = [];
    seams.extract.mockImplementation(extractInto(outDirs));
    seams.transcribe.mockImplementation(refuseChunk(2));

    await expect(run.transcribeMeeting(tenant, id)).rejects.toMatchObject({ code: "transcription_failed" });
    expect(existsSync(outDirs[0] as string)).toBe(false);
  });
});

describe("generateMinutes", () => {
  function transcribedMeeting(): string {
    const id = newMeeting();
    store.meetingStore().update(tenant, id, { status: "transcribed", transcript: TRANSCRIPT });
    return id;
  }

  function answer(translation: "ok" | "fail") {
    return async (options: { versionId: string }) => {
      if (options.versionId === "meeting-translate") {
        if (translation === "fail") {
          throw new ApiError("generation_failed", "The gateway did not answer", 502);
        }
        return { text: JSON.stringify(minutes("Rapat mingguan checkout")), model: "minutes-model" };
      }
      return { text: JSON.stringify(minutes("Checkout weekly")), model: "minutes-model" };
    };
  }

  it("keeps the minutes on the meeting when the translation fails", async () => {
    const id = transcribedMeeting();
    // An earlier run left minutes and their translation behind; both describe older minutes.
    const earlier = {
      locale: "en" as const,
      minutes: minutes("Last week"),
      artifactId: "",
      model: "m",
      unverifiedNames: [],
    };
    store.meetingStore().update(tenant, id, {
      minutes: earlier,
      translation: { ...earlier, locale: "id", minutes: minutes("Minggu lalu") },
    });
    seams.ask.mockImplementation(answer("fail"));

    await expect(run.generateMinutes(tenant, id)).rejects.toMatchObject({
      code: "generation_failed",
    });

    const record = store.meetingStore().get(tenant, id);
    expect(record?.status).toBe("minuted");
    expect(record?.minutes?.minutes.title).toBe("Checkout weekly");
    expect(record?.minutes?.locale).toBe("en");
    // The old translation described older minutes; it must not sit beside the new ones.
    expect(record?.translation).toBeNull();
  });

  it("saves the minutes and then their translation when both land", async () => {
    const id = transcribedMeeting();
    seams.ask.mockImplementation(answer("ok"));

    const returned = await run.generateMinutes(tenant, id);

    const record = store.meetingStore().get(tenant, id);
    expect(record?.status).toBe("minuted");
    expect(record?.minutes?.minutes.title).toBe("Checkout weekly");
    expect(record?.translation?.locale).toBe("id");
    expect(record?.translation?.minutes.title).toBe("Rapat mingguan checkout");
    expect(returned.translation?.minutes.title).toBe("Rapat mingguan checkout");
  });

  it("saves the minutes without a translation when none is asked for", async () => {
    const id = transcribedMeeting();
    seams.ask.mockImplementation(answer("fail"));

    const returned = await run.generateMinutes(tenant, id, { translate: false });

    expect(returned.minutes?.minutes.title).toBe("Checkout weekly");
    expect(returned.translation).toBeNull();
    expect(seams.ask).toHaveBeenCalledTimes(1);
  });
});
