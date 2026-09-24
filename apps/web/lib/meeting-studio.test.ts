/**
 * The Meeting studio's logic that is not rendering.
 *
 * Two things live here. `requestMeeting` is how the studio creates a meeting and saves a pasted
 * transcript, in the order SR-45 set for the recording upload: `res.ok` before the body, a
 * non-JSON error page read with a catch, and a dead network reported rather than thrown. The
 * rescue slot is where a recording waits when its studio is unmounted under it — a desk switch
 * remounts every work mode — until the next studio takes it.
 *
 * The studio's effects that use both are wiring and are not reachable from a node test; what the
 * owner sees is covered by `meeting-recorder-render.test.tsx` and `meeting-studio-render.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  onSameDesk,
  requestMeeting,
  stashRescuedClip,
  takeRescuedClips,
  type ClipTarget,
} from "@/components/meeting-studio";
import { applyLocale, resetLocaleForTests } from "./i18n";
import type { RecordedClip } from "./meeting-recorder";
import type { MeetingApiFetch } from "./meeting-upload";

vi.mock("@/lib/api-client", () => ({
  apiFetch: async () => {
    throw new Error("the real api-client must never be reached from these cases");
  },
}));

function clip(name = "recording-2026-09-23T10-00-00.webm"): RecordedClip {
  return {
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
    mimeType: "audio/webm;codecs=opus",
    bytes: 3,
    durationMs: 3000,
    filename: name,
    capped: false,
  };
}

const WEEKLY: ClipTarget = { id: "mtg_1", title: "Checkout weekly", workspaceId: "ws_home" };

/** A response with only what the caller reads, so a stub cannot accidentally satisfy more. */
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
  takeRescuedClips();
});

afterEach(() => {
  resetLocaleForTests();
  takeRescuedClips();
});

describe("requestMeeting", () => {
  it("posts JSON and hands back the meeting the host answered", async () => {
    const seen: Array<{ input: string; init?: RequestInit }> = [];
    const fetcher: MeetingApiFetch = async (input, init) => {
      seen.push({ input, init });
      return answer(201, { id: "mtg_1", title: "Checkout weekly", status: "new" });
    };

    const outcome = await requestMeeting("/api/v1/meetings", { title: "Checkout weekly", locale: "en" }, "fallback", fetcher);

    expect(outcome).toEqual({ ok: true, meeting: { id: "mtg_1", title: "Checkout weekly", status: "new" } });
    expect(seen[0]?.input).toBe("/api/v1/meetings");
    expect(seen[0]?.init?.method).toBe("POST");
    expect(new Headers(seen[0]?.init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ title: "Checkout weekly", locale: "en" });
  });

  it("reads the host's message out of a refusal instead of throwing", async () => {
    const fetcher: MeetingApiFetch = async () =>
      answer(400, { error: { code: "invalid_body", message: "Paste at least a sentence." } });

    await expect(requestMeeting("/api/v1/meetings/mtg_1/transcript", { text: "x" }, "fallback", fetcher)).resolves.toEqual({
      ok: false,
      message: "Paste at least a sentence.",
    });
  });

  it("survives an error page that is not JSON at all", async () => {
    const fetcher: MeetingApiFetch = async () => answer(502, null, true);

    await expect(requestMeeting("/api/v1/meetings", {}, "Could not create the meeting.", fetcher)).resolves.toEqual({
      ok: false,
      message: "Could not create the meeting.",
    });
  });

  it("reports a dead network instead of throwing", async () => {
    const fetcher: MeetingApiFetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    await expect(requestMeeting("/api/v1/meetings", {}, "fallback", fetcher)).resolves.toEqual({
      ok: false,
      message: "Failed to fetch",
    });
  });

  it("counts a 2xx whose body is not a meeting as done, with nothing to merge", async () => {
    const unreadable: MeetingApiFetch = async () => answer(201, null, true);
    const shapeless: MeetingApiFetch = async () => answer(201, { ok: true });

    await expect(requestMeeting("/api/v1/meetings", {}, "fallback", unreadable)).resolves.toEqual({ ok: true, meeting: null });
    await expect(requestMeeting("/api/v1/meetings", {}, "fallback", shapeless)).resolves.toEqual({ ok: true, meeting: null });
  });
});

describe("the rescue slot", () => {
  it("holds a recording until a studio takes it, and then forgets it", () => {
    const kept = { clip: clip(), target: WEEKLY };
    stashRescuedClip(kept);

    expect(takeRescuedClips()).toEqual([kept]);
    expect(takeRescuedClips()).toEqual([]);
  });

  it("keeps several, oldest first", () => {
    const first = { clip: clip("a.webm"), target: WEEKLY };
    const second = { clip: clip("b.webm"), target: { ...WEEKLY, id: "mtg_2", title: "Board prep" } };
    stashRescuedClip(first);
    stashRescuedClip(second);

    expect(takeRescuedClips()).toEqual([first, second]);
  });

  it("does not hold the same recording twice when a studio stashes it on every unmount", () => {
    const recording = clip();
    stashRescuedClip({ clip: recording, target: WEEKLY });
    stashRescuedClip({ clip: recording, target: WEEKLY });

    expect(takeRescuedClips()).toHaveLength(1);
  });
});

describe("onSameDesk", () => {
  it("uploads a recording from the desk it was made on", () => {
    expect(onSameDesk(WEEKLY, "ws_home")).toBe(true);
  });

  it("holds a recording made on another desk, which the host would answer with 404", () => {
    expect(onSameDesk(WEEKLY, "ws_legal")).toBe(false);
  });

  it("gives an unknown desk the benefit of the doubt", () => {
    expect(onSameDesk({ ...WEEKLY, workspaceId: null }, "ws_legal")).toBe(true);
    expect(onSameDesk(WEEKLY, null)).toBe(true);
  });
});
