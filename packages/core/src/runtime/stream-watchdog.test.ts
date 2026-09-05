import { describe, expect, it, vi } from "vitest";
import {
  STREAM_IDLE_MS,
  STREAM_REASONING_IDLE_MS,
  STREAM_REASONING_TTFB_MS,
  STREAM_TTFB_MS,
  abortErrorMessage,
  armStreamWatchdog,
  checkStreamWatchdog,
  formatStreamWatchdogError,
  isWatchdogReasoningModel,
  streamWatchdogLimits,
} from "./stream-watchdog";

describe("streamWatchdogLimits", () => {
  it("uses Hermes chat TTFB/idle for everyday models", () => {
    expect(streamWatchdogLimits("gpt-4o-mini")).toEqual({
      ttfbMs: STREAM_TTFB_MS,
      idleMs: STREAM_IDLE_MS,
    });
  });

  it("raises both floors for Claude Opus 5 and MiniMax M3", () => {
    expect(isWatchdogReasoningModel("claude-opus-5")).toBe(true);
    expect(streamWatchdogLimits("anthropic/claude-opus-5")).toEqual({
      ttfbMs: STREAM_REASONING_TTFB_MS,
      idleMs: STREAM_REASONING_IDLE_MS,
    });
    expect(streamWatchdogLimits("minimax-m3").ttfbMs).toBe(STREAM_REASONING_TTFB_MS);
  });
});

describe("checkStreamWatchdog", () => {
  const limits = { ttfbMs: 1_000, idleMs: 500 };

  it("fires ttfb when nothing has arrived", () => {
    expect(checkStreamWatchdog({ startedAt: 0, lastEventAt: null }, 999, limits)).toBeNull();
    expect(checkStreamWatchdog({ startedAt: 0, lastEventAt: null }, 1_000, limits)).toBe("ttfb");
  });

  it("fires idle after first event goes silent", () => {
    expect(checkStreamWatchdog({ startedAt: 0, lastEventAt: 1_000 }, 1_499, limits)).toBeNull();
    expect(checkStreamWatchdog({ startedAt: 0, lastEventAt: 1_000 }, 1_500, limits)).toBe("idle");
  });
});

describe("formatStreamWatchdogError", () => {
  it("names the model and includes timeout so contact-retry can see it", () => {
    expect(formatStreamWatchdogError("claude-opus-5", "ttfb", 240_000)).toContain(
      "No first token from claude-opus-5 after 240s (timeout)",
    );
    expect(formatStreamWatchdogError("gpt-5.6-luna", "idle", 60_000)).toContain(
      "No stream events from gpt-5.6-luna for 60s",
    );
  });
});

describe("armStreamWatchdog", () => {
  it("aborts on TTFB if touch never runs", () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const dog = armStreamWatchdog("gpt-4o-mini", abort);
    vi.advanceTimersByTime(STREAM_TTFB_MS);
    expect(abort.signal.aborted).toBe(true);
    expect(abortErrorMessage(abort.signal.reason)).toMatch(/No first token from gpt-4o-mini/);
    dog.close();
    vi.useRealTimers();
  });

  it("aborts on idle after a touch, not on the original TTFB clock", () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const dog = armStreamWatchdog("gpt-4o-mini", abort);
    vi.advanceTimersByTime(STREAM_TTFB_MS - 1_000);
    dog.touch();
    vi.advanceTimersByTime(STREAM_IDLE_MS - 1);
    expect(abort.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(abort.signal.aborted).toBe(true);
    expect(abortErrorMessage(abort.signal.reason)).toMatch(/No stream events from gpt-4o-mini/);
    dog.close();
    vi.useRealTimers();
  });
});
