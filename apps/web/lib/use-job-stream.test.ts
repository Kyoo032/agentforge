/**
 * One streamed job at a time, and only the current run writes the studio's state.
 *
 * `run()` aborts the run before it. That run then settles — rejected, aborted — *after* the new one
 * has already reset the progress list and set busy, and it used to reset the list again and set busy
 * to false on its way out: the new run's phases vanished and its Cancel button disappeared while it
 * was still streaming. These cases drive the runner the hook is built on, with a stubbed stream, so
 * the order in which the two runs settle is chosen by the test rather than by the network.
 */
import type { JobEvent } from "@agentforge/core/jobs";
import { describe, expect, it } from "vitest";
import { JobStreamError } from "./job-stream";
import { createJobRunner, type JobRunSink } from "./use-job-stream";

type StreamInput = {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  onEvent?: (event: JobEvent) => void;
};

/** A stream the test settles by hand. An abort rejects it the way `fetch` does. */
type Pending = {
  input: StreamInput;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

function stubStream() {
  const calls: Pending[] = [];
  const stream = (input: StreamInput): Promise<never> =>
    new Promise((resolve, reject) => {
      calls.push({ input, resolve: resolve as (value: unknown) => void, reject });
      input.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  return { calls, stream };
}

type Write =
  | { kind: "reset" }
  | { kind: "event"; phase: string }
  | { kind: "busy"; value: boolean }
  | { kind: "error"; value: string | null };

function recordingSink(): { sink: JobRunSink; writes: Write[] } {
  const writes: Write[] = [];
  const sink: JobRunSink = {
    dispatch: (action) => {
      writes.push(
        action.type === "reset"
          ? { kind: "reset" }
          : { kind: "event", phase: action.event.type === "job.phase" ? action.event.phase : action.event.type },
      );
    },
    setBusy: (value) => writes.push({ kind: "busy", value }),
    setError: (value) => writes.push({ kind: "error", value: value?.code ?? null }),
  };
  return { sink, writes };
}

const PHASE: JobEvent = { type: "job.phase", phase: "drafting", label: "Drafting" };

/** Let every settled promise run its continuations. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe("createJobRunner — one run", () => {
  it("resets, streams, returns the result and frees the studio", async () => {
    const { calls, stream } = stubStream();
    const { sink, writes } = recordingSink();
    const runner = createJobRunner<{ title: string }>(sink, stream);

    const result = runner.run("/api/v1/jobs/a", { prompt: "x" });
    calls[0]?.input.onEvent?.(PHASE);
    calls[0]?.resolve({ title: "Done" });

    await expect(result).resolves.toEqual({ title: "Done" });
    expect(writes).toEqual([
      { kind: "reset" },
      { kind: "error", value: null },
      { kind: "busy", value: true },
      { kind: "event", phase: "drafting" },
      { kind: "busy", value: false },
    ]);
  });

  it("reports a failure as the typed error and frees the studio", async () => {
    const { calls, stream } = stubStream();
    const { sink, writes } = recordingSink();
    const runner = createJobRunner(sink, stream);

    const result = runner.run("/api/v1/jobs/a", {});
    calls[0]?.reject(new JobStreamError("tool_failed", "Add a Tavily key", 503));

    await expect(result).resolves.toBeNull();
    expect(writes.slice(-2)).toEqual([
      { kind: "error", value: "tool_failed" },
      { kind: "busy", value: false },
    ]);
  });

  it("wraps a failure that is not a JobStreamError", async () => {
    const { calls, stream } = stubStream();
    const { sink, writes } = recordingSink();
    const runner = createJobRunner(sink, stream);

    const result = runner.run("/api/v1/jobs/a", {});
    calls[0]?.reject(new TypeError("Failed to fetch"));

    await expect(result).resolves.toBeNull();
    expect(writes).toContainEqual({ kind: "error", value: "request_failed" });
  });

  it("resets quietly when the owner cancels, and still frees the studio", async () => {
    const { stream } = stubStream();
    const { sink, writes } = recordingSink();
    const runner = createJobRunner(sink, stream);

    const result = runner.run("/api/v1/jobs/a", {});
    runner.cancel();

    await expect(result).resolves.toBeNull();
    expect(writes.slice(-2)).toEqual([{ kind: "reset" }, { kind: "busy", value: false }]);
    expect(writes.filter((write) => write.kind === "error" && write.value !== null)).toEqual([]);
  });
});

describe("createJobRunner — a run superseded by the next one", () => {
  it("cannot wipe the new run's progress or free the studio while the new run streams", async () => {
    const { calls, stream } = stubStream();
    const { sink, writes } = recordingSink();
    const runner = createJobRunner(sink, stream);

    const first = runner.run("/api/v1/jobs/a", {});
    const second = runner.run("/api/v1/jobs/b", {});
    // The new run is already streaming when the old one's abort lands.
    calls[1]?.input.onEvent?.(PHASE);
    const before = writes.length;
    await expect(first).resolves.toBeNull();
    await settle();

    expect(writes.slice(before)).toEqual([]);

    calls[1]?.resolve({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(writes.at(-1)).toEqual({ kind: "busy", value: false });
  });

  it("aborts the old run's request", () => {
    const { calls, stream } = stubStream();
    const runner = createJobRunner(recordingSink().sink, stream);

    void runner.run("/api/v1/jobs/a", {});
    void runner.run("/api/v1/jobs/b", {});

    expect(calls[0]?.input.signal?.aborted).toBe(true);
    expect(calls[1]?.input.signal?.aborted).toBe(false);
  });

  it("does not show the old run's error, even when it fails for a reason other than the abort", async () => {
    const { calls, stream } = stubStream();
    const { sink, writes } = recordingSink();
    // A stream that ignores the abort and fails on its own, after the next run has started.
    const deaf = (input: StreamInput) =>
      calls.length === 0
        ? new Promise<never>((_, reject) => {
            calls.push({ input, resolve: () => {}, reject });
          })
        : stream(input);
    const runner = createJobRunner(sink, deaf);

    const first = runner.run("/api/v1/jobs/a", {});
    void runner.run("/api/v1/jobs/b", {});
    const before = writes.length;
    calls[0]?.reject(new JobStreamError("runtime_stub", "Paste a key", 503));

    await expect(first).resolves.toBeNull();
    expect(writes.slice(before)).toEqual([]);
  });

  it("drops an event the old run delivers after it was superseded", async () => {
    const { calls, stream } = stubStream();
    const { sink, writes } = recordingSink();
    const runner = createJobRunner(sink, stream);

    void runner.run("/api/v1/jobs/a", {});
    void runner.run("/api/v1/jobs/b", {});
    const before = writes.length;
    calls[0]?.input.onEvent?.(PHASE);

    expect(writes.slice(before)).toEqual([]);
  });

  it("lets a cancel after a superseded run still stop the current one", async () => {
    const { stream } = stubStream();
    const { sink, writes } = recordingSink();
    const runner = createJobRunner(sink, stream);

    void runner.run("/api/v1/jobs/a", {});
    const second = runner.run("/api/v1/jobs/b", {});
    runner.cancel();

    await expect(second).resolves.toBeNull();
    await settle();
    expect(writes.at(-1)).toEqual({ kind: "busy", value: false });
  });
});
