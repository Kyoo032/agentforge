import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { collectJobEvents, jobErrorFromUnknown, streamJob, throwIfJobAborted } from "./job-stream";

describe("streamJob", () => {
  it("streams progress in order and ends with job.done carrying the result", async () => {
    const result = streamJob(async (emit) => {
      emit({ type: "job.phase", phase: "searching", label: "Searching" });
      await new Promise((resolve) => setTimeout(resolve, 5));
      emit({ type: "job.step", phase: "searching", label: "q1", current: 1, total: 1 });
      return { title: "done" };
    });
    const events = await collectJobEvents(result);
    expect(events.map((event) => event.type)).toEqual(["job.phase", "job.step", "job.done"]);
    expect(events.at(-1)).toEqual({ type: "job.done", result: { title: "done" } });
  });

  it("maps ApiError to job.error with its code and status", async () => {
    const result = streamJob(async () => {
      throw new ApiError("tool_failed", "Add a Tavily key sk-secret-123456789", 503);
    });
    const events = await collectJobEvents(result);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "job.error", code: "tool_failed", status: 503 });
    expect((events[0] as { message: string }).message).not.toContain("sk-secret-123456789");
  });

  it("maps unknown errors to internal_error and ignores emits after completion", async () => {
    const late: { emit: (() => void) | null } = { emit: null };
    const result = streamJob(async (emit) => {
      late.emit = () => emit({ type: "job.delta", text: "late" });
      throw new Error("boom");
    });
    const events = await collectJobEvents(result);
    late.emit?.();
    expect(events).toEqual([{ type: "job.error", code: "internal_error", message: "boom", status: 500 }]);
    expect(jobErrorFromUnknown("x")).toMatchObject({ code: "internal_error", message: "Job failed" });
  });

  it("hands the abort signal to the job and stops it between phases", async () => {
    const controller = new AbortController();
    const result = streamJob(
      async (emit, signal) => {
        emit({ type: "job.phase", phase: "searching", label: "Searching" });
        controller.abort();
        throwIfJobAborted(signal);
        return "should not get here";
      },
      { abortSignal: controller.signal },
    );
    const events = await collectJobEvents(result);
    expect(events[0]).toMatchObject({ type: "job.phase" });
    expect(events.some((event) => event.type === "job.done")).toBe(false);
    expect(() => throwIfJobAborted(undefined)).not.toThrow();
  });

  it("does not let the job forge a done event", async () => {
    const result = streamJob(async (emit) => {
      emit({ type: "job.done", result: "forged" });
      return "real";
    });
    const events = await collectJobEvents(result);
    expect(events).toEqual([{ type: "job.done", result: "real" }]);
  });
});
