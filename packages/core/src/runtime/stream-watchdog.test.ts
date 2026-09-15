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

  it("treats the gateway families that always think as reasoning models", () => {
    for (const id of ["deepseek-v4-flash", "deepseek-v4-pro", "glm-5.3-flash", "kimi-k3", "qwen3.8-max"]) {
      expect(isWatchdogReasoningModel(id)).toBe(true);
      expect(streamWatchdogLimits(id)).toEqual({
        ttfbMs: STREAM_REASONING_TTFB_MS,
        idleMs: STREAM_REASONING_IDLE_MS,
      });
    }
    expect(streamWatchdogLimits("deepseek/deepseek-v4-flash").idleMs).toBe(STREAM_REASONING_IDLE_MS);
    expect(isWatchdogReasoningModel("gpt-5.6-luna")).toBe(false);
    expect(isWatchdogReasoningModel("glm-5.2-fast-preview")).toBe(false);
  });

  it("lets a per-run override raise either limit above the model default", () => {
    expect(streamWatchdogLimits("gpt-4o-mini", { ttfbMs: 180_000, idleMs: 150_000 })).toEqual({
      ttfbMs: 180_000,
      idleMs: 150_000,
    });
    expect(streamWatchdogLimits("gpt-4o-mini", { idleMs: 150_000 })).toEqual({
      ttfbMs: STREAM_TTFB_MS,
      idleMs: 150_000,
    });
  });

  it("never lets an override lower a limit below the model default", () => {
    expect(streamWatchdogLimits("gpt-4o-mini", { ttfbMs: 1_000, idleMs: 1 })).toEqual({
      ttfbMs: STREAM_TTFB_MS,
      idleMs: STREAM_IDLE_MS,
    });
    expect(streamWatchdogLimits("claude-opus-5", { ttfbMs: 180_000, idleMs: 150_000 })).toEqual({
      ttfbMs: STREAM_REASONING_TTFB_MS,
      idleMs: STREAM_REASONING_IDLE_MS,
    });
    expect(streamWatchdogLimits("gpt-4o-mini", { ttfbMs: Number.NaN, idleMs: -5 })).toEqual({
      ttfbMs: STREAM_TTFB_MS,
      idleMs: STREAM_IDLE_MS,
    });
    expect(streamWatchdogLimits("gpt-4o-mini", {})).toEqual({ ttfbMs: STREAM_TTFB_MS, idleMs: STREAM_IDLE_MS });
  });
});

describe("checkStreamWatchdog", () => {
  const limits = { ttfbMs: 1_000, idleMs: 500 };

  it("fires ttfb when nothing has arrived", () => {
    expect(checkStreamWatchdog({ startedAt: 0, lastEventAt: null, streaming: false }, 999, limits)).toBeNull();
    expect(checkStreamWatchdog({ startedAt: 0, lastEventAt: null, streaming: false }, 1_000, limits)).toBe("ttfb");
  });

  it("fires idle after the model has produced output and goes silent", () => {
    expect(checkStreamWatchdog({ startedAt: 0, lastEventAt: 1_000, streaming: true }, 1_499, limits)).toBeNull();
    expect(checkStreamWatchdog({ startedAt: 0, lastEventAt: 1_000, streaming: true }, 1_500, limits)).toBe("idle");
  });

  it("keeps the first-token budget when the opening frame carried no output", () => {
    // A `step-start` at 100 ms used to start the idle clock, so a model that was still thinking
    // was killed at 600 ms instead of the 1_000 ms it was promised.
    const opened = { startedAt: 0, lastEventAt: 100, streaming: false };
    expect(checkStreamWatchdog(opened, 600, limits)).toBeNull();
    expect(checkStreamWatchdog(opened, 999, limits)).toBeNull();
    expect(checkStreamWatchdog(opened, 1_000, limits)).toBe("ttfb");
  });

  it("caps the first-token wait however long the stream keeps breathing", () => {
    // Liveness must not extend the cap, or a gateway that heartbeats but never answers
    // would hold a run open forever.
    const keptAlive = { startedAt: 0, lastEventAt: 900, streaming: false };
    expect(checkStreamWatchdog(keptAlive, 999, limits)).toBeNull();
    expect(checkStreamWatchdog(keptAlive, 1_000, limits)).toBe("ttfb");
    expect(checkStreamWatchdog({ startedAt: 0, lastEventAt: 990, streaming: false }, 1_000, limits)).toBe(
      "ttfb",
    );
  });

  it("ignores an idle override longer than the first-token budget before output", () => {
    const stretched = { ttfbMs: 1_000, idleMs: 5_000 };
    expect(checkStreamWatchdog({ startedAt: 0, lastEventAt: 100, streaming: false }, 999, stretched)).toBeNull();
    expect(checkStreamWatchdog({ startedAt: 0, lastEventAt: 100, streaming: false }, 1_000, stretched)).toBe(
      "ttfb",
    );
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

  it("aborts on idle after output, not on the original TTFB clock", () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const dog = armStreamWatchdog("gpt-4o-mini", abort);
    vi.advanceTimersByTime(STREAM_TTFB_MS - 1_000);
    dog.touchOutput();
    vi.advanceTimersByTime(STREAM_IDLE_MS - 1);
    expect(abort.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(abort.signal.aborted).toBe(true);
    expect(abortErrorMessage(abort.signal.reason)).toMatch(/No stream events from gpt-4o-mini/);
    dog.close();
    vi.useRealTimers();
  });

  it("keeps the first-token budget when the stream only opened", () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const dog = armStreamWatchdog("gpt-4o-mini", abort);
    // The AI SDK emits `step-start` on the gateway's first frame; the model has said nothing yet.
    vi.advanceTimersByTime(1_000);
    dog.touch();
    vi.advanceTimersByTime(STREAM_IDLE_MS);
    expect(abort.signal.aborted).toBe(false);
    vi.advanceTimersByTime(STREAM_TTFB_MS - STREAM_IDLE_MS - 1_000);
    expect(abort.signal.aborted).toBe(true);
    expect(abortErrorMessage(abort.signal.reason)).toMatch(/No first token from gpt-4o-mini after 120s/);
    dog.close();
    vi.useRealTimers();
  });

  it("still fires at the cap while a silent gateway keeps heartbeating", () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const dog = armStreamWatchdog("gpt-4o-mini", abort);
    for (let elapsed = 10_000; elapsed <= 300_000; elapsed += 10_000) {
      vi.advanceTimersByTime(10_000);
      if (elapsed < STREAM_TTFB_MS) {
        expect(abort.signal.aborted).toBe(false);
      }
      dog.touch();
    }
    expect(abort.signal.aborted).toBe(true);
    expect(abortErrorMessage(abort.signal.reason)).toMatch(/No first token from gpt-4o-mini after 120s/);
    dog.close();
    vi.useRealTimers();
  });

  it("gives a quiet reasoning model room to think instead of failing at 60s", () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const dog = armStreamWatchdog("deepseek-v4-flash", abort);
    dog.touch();
    vi.advanceTimersByTime(STREAM_IDLE_MS);
    expect(abort.signal.aborted).toBe(false);
    dog.touchOutput();
    vi.advanceTimersByTime(STREAM_REASONING_IDLE_MS - 1);
    expect(abort.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(abort.signal.aborted).toBe(true);
    dog.close();
    vi.useRealTimers();
  });

  it("waits for the raised per-run limits instead of the model defaults", () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const dog = armStreamWatchdog("gpt-4o-mini", abort, { ttfbMs: 180_000, idleMs: 150_000 });
    vi.advanceTimersByTime(STREAM_TTFB_MS);
    expect(abort.signal.aborted).toBe(false);
    vi.advanceTimersByTime(180_000 - STREAM_TTFB_MS - 1);
    dog.touchOutput();
    vi.advanceTimersByTime(STREAM_IDLE_MS);
    expect(abort.signal.aborted).toBe(false);
    vi.advanceTimersByTime(150_000 - STREAM_IDLE_MS);
    expect(abort.signal.aborted).toBe(true);
    expect(abortErrorMessage(abort.signal.reason)).toMatch(/No stream events from gpt-4o-mini for 150s/);
    dog.close();
    vi.useRealTimers();
  });
});

describe("stream watchdog copy in Bahasa Indonesia", () => {
  it("writes both timeout kinds in id", () => {
    expect(formatStreamWatchdogError("gpt-5", "ttfb", 120_000, "id")).toBe(
      "Tidak ada token pertama dari gpt-5 setelah 120 detik (timeout). Coba prompt yang lebih pendek, model lain, atau kirim lagi.",
    );
    expect(formatStreamWatchdogError("gpt-5", "idle", 60_000, "id")).toContain("Tidak ada peristiwa stream dari gpt-5");
  });

  it("keeps English as the default", () => {
    expect(formatStreamWatchdogError("gpt-5", "ttfb", 120_000)).toContain("No first token from gpt-5");
    expect(formatStreamWatchdogError("gpt-5", "idle", 60_000, "de" as never)).toContain("No stream events from gpt-5");
  });

  it("localizes the abort fallback but never rewrites a real error", () => {
    expect(abortErrorMessage(undefined)).toBe("The model stream timed out");
    expect(abortErrorMessage(undefined, "id")).toBe("Stream model habis waktu");
    expect(abortErrorMessage(new Error("boom"), "id")).toBe("boom");
  });
});
