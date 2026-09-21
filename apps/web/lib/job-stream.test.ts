import { describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@agentforge/core/jobs";
import { errorFromJson, JobStreamError, parseJobEvents, settleJobEvents } from "./job-stream";
import { PLAN_BLOCK_CODES, PLAN_BLOCK_EVENT, readPlanBlockEvent } from "./plan-block";

function sse(event: JobEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Run `body` with a `window` that records every plan refusal announced through it. */
function withWindow(run: (announced: Array<string | null>) => void): void {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  try {
    const announced: Array<string | null> = [];
    target.addEventListener(PLAN_BLOCK_EVENT, (event) => announced.push(readPlanBlockEvent(event)));
    run(announced);
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("job stream client", () => {
  it("keeps only job events and returns the partial tail", () => {
    const buffer = `${sse({ type: "job.phase", phase: "searching", label: "Searching" })}event: assistant.delta\ndata: {"type":"assistant.delta","text":"x"}\n\nevent: job.step\ndata: {"type":"job.st`;
    const { events, rest } = parseJobEvents(buffer);
    expect(events).toEqual([{ type: "job.phase", phase: "searching", label: "Searching" }]);
    expect(rest.startsWith("event: job.step")).toBe(true);
  });

  it("settles on job.done and forwards every event", () => {
    const seen: string[] = [];
    const result = settleJobEvents<{ title: string }>(
      [
        { type: "job.phase", phase: "drafting", label: "Drafting" },
        { type: "job.done", result: { title: "T" } },
      ],
      (event) => seen.push(event.type),
    );
    expect(result).toEqual({ title: "T" });
    expect(seen).toEqual(["job.phase", "job.done"]);
    expect(settleJobEvents([{ type: "job.delta", text: "x" }])).toBeUndefined();
  });

  it("throws a typed error on job.error", () => {
    expect(() =>
      settleJobEvents([{ type: "job.error", code: "tool_failed", message: "Add a Tavily key", status: 503 }]),
    ).toThrow(JobStreamError);
    try {
      settleJobEvents([{ type: "job.error", code: "runtime_stub", message: "Paste a key", status: 503 }]);
    } catch (error) {
      expect(error).toMatchObject({ code: "runtime_stub", status: 503, message: "Paste a key" });
    }
  });
});

/**
 * A job that is refused for the plan.
 *
 * The host answers a blocked tenant with the **flat** `{ error: "<code>", message }` shape
 * (`packages/host/src/entitlement-store.ts`), which this reader only ever looked for one level
 * down — so a past-due tenant's Documents run failed as `request_failed` / "Request failed", with
 * no code for a studio to branch on and nothing for the person to read. It is also the only place
 * a plan refusal reaches this renderer: every job mode goes through `runJobStream`.
 */
describe("errorFromJson", () => {
  it("reads the enveloped shape every other route answers", () => {
    const error = errorFromJson({ error: { code: "tool_failed", message: "Add a Tavily key" } }, 503);
    expect(error).toMatchObject({ code: "tool_failed", message: "Add a Tavily key", status: 503 });
  });

  it("falls back where the envelope carries nothing usable", () => {
    for (const body of [null, undefined, {}, "nope", [], { error: {} }, { error: { code: 7 } }]) {
      expect(errorFromJson(body, 500), String(body)).toMatchObject({
        code: "request_failed",
        message: "Request failed",
      });
    }
  });

  it("gives a plan refusal its own code and the host's sentence", () => {
    const error = errorFromJson({ error: "plan_past_due", message: "Your payment is overdue." }, 403);
    expect(error).toMatchObject({
      code: "plan_past_due",
      message: "Your payment is overdue.",
      status: 403,
    });
  });

  it("reads every plan code the host can send, including the 503 that is not a paywall", () => {
    for (const code of PLAN_BLOCK_CODES) {
      const status = code === "plan_unavailable" ? 503 : 403;
      expect(errorFromJson({ error: code, message: "…" }, status), code).toMatchObject({ code, status });
    }
  });

  it("announces the refusal so the whole app can answer it, not just this studio", () => {
    withWindow((announced) => {
      errorFromJson({ error: "plan_allowance_exhausted", message: "Out of allowance." }, 403);
      expect(announced).toEqual(["plan_allowance_exhausted"]);
    });
  });

  it("leaves a gateway_blocked body exactly as it was", () => {
    withWindow((announced) => {
      // The other flat code. It has its own parser and its own screen, nothing reads it off a job
      // stream, and a paywall in front of "your key was rejected" would be the wrong screen.
      const error = errorFromJson({ error: "gateway_blocked", status: "invalid_key", message: "Key rejected" }, 403);
      expect(error).toMatchObject({ code: "request_failed", message: "Request failed", status: 403 });
      expect(announced).toEqual([]);
    });
  });

  it("does not take a plan code seriously when it arrives inside the envelope", () => {
    withWindow((announced) => {
      // Only the blocked errors are flat. A nested `plan_past_due` means some other route grew one,
      // and a paywall in front of that route's real answer would be worse than showing it.
      const error = errorFromJson({ error: { code: "plan_past_due", message: "…" } }, 403);
      expect(error).toMatchObject({ code: "plan_past_due", message: "…" });
      expect(announced).toEqual([]);
    });
  });

  it("says nothing about a session 401, which is a different screen entirely", () => {
    withWindow((announced) => {
      const error = errorFromJson({ error: { code: "session_required", message: "Please sign in." } }, 401);
      expect(error).toMatchObject({ code: "session_required", status: 401 });
      expect(announced).toEqual([]);
    });
  });
});
