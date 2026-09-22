/**
 * A finished recording must survive everything that can go wrong between Stop and the server.
 *
 * This replaces `meeting-recorder-wiring.test.ts`, which read `meeting-studio.tsx` as a string and
 * asserted, among other things, that `clearClip()` came **before** the upload — it pinned the bug.
 * A source grep cannot tell a clip that was uploaded from a clip that was thrown away, which is the
 * only distinction that matters here, so these cases drive the real controller and the real poster
 * with a stubbed `apiFetch` instead.
 *
 * Four promises, one per case group:
 *
 *   success  → the bytes are released only after a 2xx.
 *   failure  → the bytes are kept, with something to read and a Retry that sends the same clip.
 *   busy     → a clip offered mid-upload waits its turn; it is never dropped.
 *   capped   → "stopped at 25 MB" outlives the clip it describes.
 *
 * Plus the wiring the old file was right to care about: one route, one `file` field, and `res.ok`
 * read before the body — so a recording and a chosen file are the same POST to the same host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale, resetLocaleForTests } from "./i18n";
import type { RecordedClip } from "./meeting-recorder";
import {
  MeetingUploadController,
  postMeetingRecording,
  type MeetingApiFetch,
  type UploadOutcome,
} from "./meeting-upload";

vi.mock("@/lib/api-client", () => ({
  apiFetch: async () => {
    throw new Error("the real api-client must never be reached from these cases");
  },
}));

function clip(overrides: Partial<RecordedClip> = {}): RecordedClip {
  return {
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }),
    mimeType: "audio/webm;codecs=opus",
    bytes: 4,
    durationMs: 4000,
    filename: "recording-2026-09-21T04-05-06.webm",
    capped: false,
    ...overrides,
  };
}

/** A response with only what the poster reads, so a stub cannot accidentally satisfy more. */
function answer(status: number, body: unknown, badJson = false): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (badJson) {
        throw new SyntaxError("Unexpected token <");
      }
      return body;
    },
  } as Response;
}

beforeEach(() => {
  applyLocale("en");
});

afterEach(() => {
  resetLocaleForTests();
});

describe("postMeetingRecording", () => {
  it("posts multipart to the meeting's recording route, under the field the host reads", async () => {
    const seen: Array<{ input: string; init?: RequestInit }> = [];
    const fetcher: MeetingApiFetch = async (input, init) => {
      seen.push({ input, init });
      return answer(200, { id: "mtg_1" });
    };

    const outcome = await postMeetingRecording("mtg_1", new File([new Uint8Array(4)], "recording.webm"), fetcher);

    expect(outcome).toEqual({ ok: true, meeting: { id: "mtg_1" } });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.input).toBe("/api/v1/meetings/mtg_1/recording");
    expect(seen[0]?.init?.method).toBe("POST");
    const form = seen[0]?.init?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((form.get("file") as File).name).toBe("recording.webm");
  });

  it("reads the host's message out of a refusal instead of throwing", async () => {
    const fetcher: MeetingApiFetch = async () => answer(413, { error: { message: "That file is too large." } });
    expect(await postMeetingRecording("mtg_1", new File([], "r.webm"), fetcher)).toEqual({
      ok: false,
      message: "That file is too large.",
    });
  });

  /**
   * The ordering bug, on its own. `res.json()` used to be awaited before `res.ok` was looked at, so
   * a proxy's html 502 or an empty 401 threw a `SyntaxError` out of an upload that had no `catch`
   * — an unhandled rejection where a message should have been, with the clip already cleared.
   */
  it("survives an error body that is not JSON at all", async () => {
    const fetcher: MeetingApiFetch = async () => answer(502, null, true);
    const outcome = await postMeetingRecording("mtg_1", new File([], "r.webm"), fetcher);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toBe("Could not upload that recording.");
  });

  it("treats a dead network as a failure to report, never as a throw", async () => {
    const fetcher: MeetingApiFetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const outcome = await postMeetingRecording("mtg_1", new File([], "r.webm"), fetcher);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message).toBe("Failed to fetch");
  });
});

describe("MeetingUploadController", () => {
  /** A controller with a scripted `send`, and the files it was asked to send. */
  function harness(script: Array<UploadOutcome | Error> = [{ ok: true, meeting: {} }]) {
    const sent: File[] = [];
    let index = 0;
    const controller = new MeetingUploadController({
      send: async (file) => {
        sent.push(file);
        const next = script[Math.min(index, script.length - 1)];
        index += 1;
        if (next instanceof Error) {
          throw next;
        }
        return next;
      },
    });
    return { controller, sent };
  }

  it("releases the bytes only once the host has taken them", async () => {
    const { controller, sent } = harness();
    controller.offer(clip());
    // Mid-flight the clip is still held: this is the window the old code had already cleared.
    expect(controller.getState().pending).not.toBeNull();
    await vi.waitFor(() => expect(controller.getState().status).toBe("idle"));
    expect(controller.getState().pending).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe("recording-2026-09-21T04-05-06.webm");
    expect(sent[0]?.type).toBe("audio/webm;codecs=opus");
  });

  it("keeps the recording when the upload fails, with something to read and a Retry that works", async () => {
    const { controller, sent } = harness([{ ok: false, message: "That file is too large." }, { ok: true, meeting: {} }]);
    controller.offer(clip());
    await vi.waitFor(() => expect(controller.getState().status).toBe("failed"));

    const failed = controller.getState();
    expect(failed.pending).not.toBeNull();
    expect(failed.errorMessage).toBe("That file is too large.");
    // Nothing re-sends on its own: a failed upload waits for the owner.
    expect(sent).toHaveLength(1);

    controller.retry();
    await vi.waitFor(() => expect(controller.getState().status).toBe("idle"));
    expect(controller.getState().pending).toBeNull();
    expect(sent).toHaveLength(2);
  });

  it("keeps the recording when `send` throws, which is the same loss by another route", async () => {
    const { controller } = harness([new Error("boom")]);
    controller.offer(clip());
    await vi.waitFor(() => expect(controller.getState().status).toBe("failed"));
    expect(controller.getState().pending).not.toBeNull();
    expect(controller.getState().errorMessage).toBe("boom");
  });

  it("queues a clip that arrives while the studio is busy, and sends it when it is free", async () => {
    const { controller, sent } = harness();
    controller.setBlocked(true);

    controller.offer(clip());
    expect(controller.getState().status).toBe("queued");
    expect(controller.getState().pending).not.toBeNull();
    expect(sent).toEqual([]);

    controller.setBlocked(false);
    await vi.waitFor(() => expect(controller.getState().status).toBe("idle"));
    expect(sent).toHaveLength(1);
  });

  it("never sends the same clip twice, however often the effect runs", async () => {
    const { controller, sent } = harness();
    controller.offer(clip());
    // React StrictMode mounts effects twice; a queue that is pumped again mid-flight must not
    // upload the same bytes a second time.
    controller.setBlocked(false);
    controller.setBlocked(true);
    controller.setBlocked(false);
    await vi.waitFor(() => expect(controller.getState().status).toBe("idle"));
    expect(sent).toHaveLength(1);
  });

  it("keeps the size-cap notice after the clip it describes is gone", async () => {
    const { controller } = harness();
    controller.offer(clip({ capped: true }));
    expect(controller.getState().capped).toBe(true);

    await vi.waitFor(() => expect(controller.getState().pending).toBeNull());
    // The clip has been uploaded and released; the warning that the recording is SHORT has not.
    expect(controller.getState().capped).toBe(true);

    controller.dismissCapped();
    expect(controller.getState().capped).toBe(false);
  });

  it("clears the cap notice when the next recording starts, and not before", async () => {
    const { controller } = harness();
    controller.offer(clip({ capped: true }));
    await vi.waitFor(() => expect(controller.getState().pending).toBeNull());
    expect(controller.getState().capped).toBe(true);

    controller.recordingStarted();
    expect(controller.getState().capped).toBe(false);
  });

  it("tells its subscriber about every transition", async () => {
    const { controller } = harness();
    const seen: string[] = [];
    controller.subscribe((state) => seen.push(state.status));
    controller.offer(clip());
    await vi.waitFor(() => expect(controller.getState().status).toBe("idle"));
    expect(seen).toEqual(["queued", "uploading", "idle"]);
  });
});
