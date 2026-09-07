import { describe, expect, it } from "vitest";
import type { JobEvent } from "@agentforge/core/jobs";
import { JobStreamError, parseJobEvents, settleJobEvents } from "./job-stream";

function sse(event: JobEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
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
