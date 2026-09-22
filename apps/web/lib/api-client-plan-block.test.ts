/**
 * A blocked tenant sees the same app whichever button they press.
 *
 * `reportPlanBlocked` had one caller — `job-stream.ts:49` — so the paywall could only be raised by
 * starting a JOB. A past-due tenant who sent a chat message, saved Settings or generated a track
 * got an ordinary red error banner with a message about a plan they had no way to reach from
 * there, while the same refusal from a job replaced the whole screen with the explanation and the
 * price list. One tenant, one block, two different products.
 *
 * The seam is now `notePlanResponse`, beside `noteApiResponse` in the one place every HTTP answer
 * passes through. These cases drive the real `apiFetch` with a stubbed `fetch`, because the three
 * things that have to be true are all about that shared path:
 *
 *   1. the boundary is raised for a plan refusal from ANY route;
 *   2. the caller's own body is still readable afterwards — a report, not a theft;
 *   3. nothing is raised for `gateway_blocked` or `session_required`, which have their own screens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api-client";
import { PLAN_BLOCK_EVENT, readPlanBlockEvent } from "./plan-block";

type Answer = { status: number; body: unknown };

let answer: Answer = { status: 200, body: {} };
let seen: Array<string | null> = [];
let requested: string[] = [];

/** A real `Response`, so `clone()` and the single-use body are the browser's, not a stub's. */
function response({ status, body }: Answer): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  seen = [];
  requested = [];
  answer = { status: 200, body: {} };
  const listener = new EventTarget();
  listener.addEventListener(PLAN_BLOCK_EVENT, (event) => seen.push(readPlanBlockEvent(event)));
  vi.stubGlobal("window", listener);
  vi.stubGlobal("fetch", async (input: string) => {
    requested.push(input);
    return response(answer);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The event is raised from a `.then` on a clone, so let the microtask queue drain. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("a plan refusal from any route", () => {
  const calls: ReadonlyArray<readonly [string, string, RequestInit]> = [
    ["a chat send", "/api/v1/threads/thr_1/messages", { method: "POST", body: JSON.stringify({ text: "hi" }) }],
    ["a settings save", "/api/v1/settings", { method: "POST", body: JSON.stringify({ locale: "en" }) }],
    ["a music generate", "/api/v1/music", { method: "POST", body: JSON.stringify({ prompt: "a song" }) }],
  ];

  it.each(calls)("raises the boundary for %s", async (_name, path, init) => {
    answer = { status: 403, body: { error: "plan_past_due", message: "Payment overdue" } };
    await apiFetch(path, init);
    await settled();
    expect(seen).toEqual(["plan_past_due"]);
    expect(requested).toEqual([path]);
  });

  it("leaves the caller's own body untouched, so the studio can still read the message", async () => {
    answer = { status: 403, body: { error: "plan_cancelled", message: "No active plan" } };
    const res = await apiFetch("/api/v1/music", { method: "POST", body: "{}" });
    // The whole point of the clone: this would throw "body already read" without it.
    expect(await res.json()).toEqual({ error: "plan_cancelled", message: "No active plan" });
    await settled();
    expect(seen).toEqual(["plan_cancelled"]);
  });

  it("reads the enveloped shape too, which is what most routes answer with", async () => {
    answer = { status: 503, body: { error: { code: "plan_unavailable", message: "not now" } } };
    await apiFetch("/api/v1/settings", { method: "POST", body: "{}" });
    await settled();
    expect(seen).toEqual(["plan_unavailable"]);
  });
});

describe("what must NOT raise a paywall", () => {
  it("says nothing for a gateway block, which has its own screen and its own key", async () => {
    // `gateway_blocked` sends the renderer to the paste-your-key onboarding. Announcing a plan
    // block for it — or a gateway block for a plan code — is the confusion this module exists to
    // prevent, in either direction.
    answer = { status: 403, body: { error: "gateway_blocked", status: "needs_key", message: "no key" } };
    await apiFetch("/api/v1/music", { method: "POST", body: "{}" });
    await settled();
    expect(seen).toEqual([]);
  });

  it("says nothing for session_required, which belongs to the session signal", async () => {
    answer = { status: 401, body: { error: "session_required", message: "sign in" } };
    await apiFetch("/api/v1/settings");
    await settled();
    expect(seen).toEqual([]);
  });

  it("says nothing for a 403 that is about something else entirely", async () => {
    answer = { status: 403, body: { error: { code: "install_disabled", message: "the operator manages this" } } };
    await apiFetch("/api/v1/components/install/stream", { method: "POST", body: "{}" });
    await settled();
    expect(seen).toEqual([]);
  });

  it("does no work at all on the statuses a refusal never uses", async () => {
    for (const status of [200, 201, 400, 404, 429, 500]) {
      answer = { status, body: { error: "plan_past_due" } };
      const res = await apiFetch("/api/v1/ping");
      // Untouched and unread: nothing looked at this body, whatever it happened to contain.
      expect(res.bodyUsed).toBe(false);
    }
    await settled();
    expect(seen).toEqual([]);
  });
});
