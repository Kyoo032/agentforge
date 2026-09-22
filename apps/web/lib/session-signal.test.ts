/**
 * The one hook that tells the app its session ended mid-session.
 *
 * Driven through the real `apiFetch` against a stubbed `fetch`, because the thing worth proving is
 * the wiring: that a 401 anywhere reaches a subscriber, that the caller still gets its own body
 * back unread, and that nothing is touched on a 200 or on a desk where nobody subscribes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiFetch } from "./api-client";
import { announceSessionLost, noteApiResponse, onSessionLost, resetSessionSignalForTests } from "./session-signal";

const realFetch = globalThis.fetch;
let seen: Array<string | null> = [];
let unsubscribe: (() => void) | null = null;

function replyWith(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
}

/** Let the `clone().json()` microtasks behind `noteApiResponse` run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  seen = [];
  resetSessionSignalForTests();
  unsubscribe = onSessionLost((code) => seen.push(code));
});

afterEach(() => {
  unsubscribe?.();
  resetSessionSignalForTests();
  globalThis.fetch = realFetch;
});

describe("a 401 on any call", () => {
  it("reports the host's reason code to the subscriber", async () => {
    replyWith(401, { error: { code: "session_required", message: "Please sign in to continue." } });
    await apiFetch("/api/v1/settings");
    await settle();
    expect(seen).toEqual(["session_required"]);
  });

  it("leaves the caller its own unread body", async () => {
    replyWith(401, { error: { code: "session_revoked", message: "You were signed out." } });
    const response = await apiFetch("/api/v1/workspaces");
    // The caller parses the same envelope for its own error copy; a hook that consumed the stream
    // would turn every 401 into "body already read".
    expect(await response.json()).toEqual({
      error: { code: "session_revoked", message: "You were signed out." },
    });
    await settle();
    expect(seen).toEqual(["session_revoked"]);
  });

  it("says nothing on a successful call", async () => {
    replyWith(200, { workspaces: [] });
    await apiFetch("/api/v1/workspaces");
    await settle();
    expect(seen).toEqual([]);
  });

  it("reads nothing at all when nobody is listening", async () => {
    unsubscribe?.();
    resetSessionSignalForTests();
    replyWith(401, { error: { code: "session_required" } });
    const response = await apiFetch("/api/v1/settings");
    await settle();
    // Untouched: `bodyUsed` false is what proves no clone was read behind the caller's back.
    expect(response.bodyUsed).toBe(false);
    expect(seen).toEqual([]);
  });

  it("reports null for a 401 whose body carries no code", async () => {
    replyWith(401, { nope: true });
    await apiFetch("/api/v1/settings");
    await settle();
    expect(seen).toEqual([null]);
  });
});

describe("onSessionLost", () => {
  it("returns the unsubscribe, and a dropped subscriber hears nothing more", () => {
    const heard: Array<string | null> = [];
    const stop = onSessionLost((code) => heard.push(code));
    announceSessionLost("refresh_expired");
    stop();
    announceSessionLost("session_revoked");
    expect(heard).toEqual(["refresh_expired"]);
  });

  it("does not read a response that is not a 401", () => {
    const response = new Response("{}", { status: 500 });
    noteApiResponse(response);
    expect(response.bodyUsed).toBe(false);
  });
});
