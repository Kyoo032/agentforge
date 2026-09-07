import { describe, expect, it } from "vitest";
import { encodeSse } from "../sse";
import { EMPTY_JOB_PROGRESS, isJobEvent, reduceJobProgress, type JobEvent } from "./job-events";

function fold(events: JobEvent[]) {
  return events.reduce(reduceJobProgress, EMPTY_JOB_PROGRESS);
}

describe("job events", () => {
  it("recognizes job events and rejects runtime events", () => {
    expect(isJobEvent({ type: "job.phase", phase: "searching", label: "Searching" })).toBe(true);
    expect(isJobEvent({ type: "assistant.delta", text: "x" })).toBe(false);
    expect(isJobEvent(null)).toBe(false);
  });

  it("encodes on the shared SSE channel", () => {
    const wire = encodeSse({ type: "job.step", phase: "searching", label: "lithium", current: 1, total: 3 });
    expect(wire.startsWith("event: job.step\ndata: {")).toBe(true);
    expect(wire.endsWith("\n\n")).toBe(true);
  });

  it("closes the previous phase when a new one starts", () => {
    const state = fold([
      { type: "job.phase", phase: "planning", label: "Planning" },
      { type: "job.phase", phase: "searching", label: "Searching" },
    ]);
    expect(state.phases.map((phase) => phase.status)).toEqual(["done", "active"]);
  });

  it("attaches steps to their phase and creates a phase when missing", () => {
    const state = fold([
      { type: "job.phase", phase: "searching", label: "Searching" },
      { type: "job.step", phase: "searching", label: "q1", current: 1, total: 2 },
      { type: "job.step", phase: "reading", label: "page" },
    ]);
    expect(state.phases[0]?.steps).toHaveLength(1);
    expect(state.phases[1]).toMatchObject({ phase: "reading", steps: [{ label: "page" }] });
  });

  it("upserts sources by id and accumulates text", () => {
    const state = fold([
      { type: "job.source", id: "S1", title: "A", url: "https://a.test", status: "found" },
      { type: "job.source", id: "S1", title: "A", url: "https://a.test", status: "read" },
      { type: "job.delta", text: "ab" },
      { type: "job.delta", text: "c" },
    ]);
    expect(state.sources).toEqual([
      { type: "job.source", id: "S1", title: "A", url: "https://a.test", status: "read" },
    ]);
    expect(state.text).toBe("abc");
  });

  it("marks done and error without mutating the previous state", () => {
    const active = fold([{ type: "job.phase", phase: "drafting", label: "Drafting" }]);
    const done = reduceJobProgress(active, { type: "job.done", result: { ok: true } });
    expect(done.done).toBe(true);
    expect(done.phases[0]?.status).toBe("done");
    expect(active.phases[0]?.status).toBe("active");
    const failed = reduceJobProgress(active, {
      type: "job.error",
      code: "tool_failed",
      message: "no key",
      status: 503,
    });
    expect(failed.error?.code).toBe("tool_failed");
    expect(failed.done).toBe(true);
  });
});
