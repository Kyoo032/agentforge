import { describe, expect, it, vi } from "vitest";
import { armRunStallGuard, isRunOutputEvent } from "./run-stall";

function guardWithLog(model: string, locale: "en" | "id" = "en") {
  const stalls: string[] = [];
  const guard = armRunStallGuard({ model, locale, onStall: (message) => stalls.push(message) });
  return { guard, stalls };
}

describe("armRunStallGuard", () => {
  it("keeps a run alive when output arrives at 21s and again at 79s", () => {
    vi.useFakeTimers();
    const { guard, stalls } = guardWithLog("gpt-4o-mini");
    // The timeline measured on the 3100 desk: first delta at 21 s, tool rounds, next delta at 79 s.
    vi.advanceTimersByTime(21_000);
    guard.touchOutput();
    vi.advanceTimersByTime(58_000);
    guard.touchOutput();
    vi.advanceTimersByTime(41_000);
    expect(stalls).toEqual([]);
    // Still a guard: 60 s after the last output the run is reported as stalled, not at 120 s.
    vi.advanceTimersByTime(19_000);
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toMatch(/No stream events from gpt-4o-mini for 60s/);
    guard.close();
    vi.useRealTimers();
  });

  it("still reports a run that never produced anything", () => {
    vi.useFakeTimers();
    const { guard, stalls } = guardWithLog("gpt-4o-mini");
    vi.advanceTimersByTime(119_000);
    expect(stalls).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toMatch(/No first token from gpt-4o-mini after 120s/);
    guard.close();
    vi.useRealTimers();
  });

  it("does not let a probe or another output-less event spend the first-token budget", () => {
    vi.useFakeTimers();
    const { guard, stalls } = guardWithLog("gpt-4o-mini");
    vi.advanceTimersByTime(500);
    guard.touch();
    vi.advanceTimersByTime(60_000);
    expect(stalls).toEqual([]);
    vi.advanceTimersByTime(59_500);
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toMatch(/No first token from gpt-4o-mini after 120s/);
    guard.close();
    vi.useRealTimers();
  });

  it("caps a heartbeating run that never answers at the first-token budget", () => {
    vi.useFakeTimers();
    const { guard, stalls } = guardWithLog("gpt-4o-mini");
    for (let elapsed = 10_000; elapsed <= 300_000; elapsed += 10_000) {
      vi.advanceTimersByTime(10_000);
      if (elapsed < 120_000) {
        expect(stalls).toEqual([]);
      }
      guard.touch();
    }
    expect(stalls).toHaveLength(1);
    expect(stalls[0]).toMatch(/No first token from gpt-4o-mini after 120s/);
    guard.close();
    vi.useRealTimers();
  });

  it("gives a quiet reasoning model its longer budget", () => {
    vi.useFakeTimers();
    const { guard, stalls } = guardWithLog("deepseek-v4-flash");
    guard.touch();
    vi.advanceTimersByTime(120_000);
    expect(stalls).toEqual([]);
    guard.touchOutput();
    vi.advanceTimersByTime(179_999);
    expect(stalls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(stalls).toHaveLength(1);
    guard.close();
    vi.useRealTimers();
  });

  it("keeps the failure bilingual", () => {
    vi.useFakeTimers();
    const { guard, stalls } = guardWithLog("gpt-4o-mini", "id");
    vi.advanceTimersByTime(120_000);
    expect(stalls[0]).toMatch(/^Tidak ada token pertama dari gpt-4o-mini setelah 120 detik/);
    guard.close();
    vi.useRealTimers();
  });

  it("closes without firing", () => {
    vi.useFakeTimers();
    const { guard, stalls } = guardWithLog("gpt-4o-mini");
    guard.close();
    vi.advanceTimersByTime(600_000);
    expect(stalls).toEqual([]);
    vi.useRealTimers();
  });
});

describe("isRunOutputEvent", () => {
  it("counts model output and nothing else", () => {
    expect(isRunOutputEvent({ type: "assistant.delta", text: "hi" })).toBe(true);
    expect(isRunOutputEvent({ type: "assistant.thinking", text: "hm" })).toBe(true);
    expect(isRunOutputEvent({ type: "tool.started", toolKey: "datetime", input: null })).toBe(true);
    expect(isRunOutputEvent({ type: "tool.completed", toolKey: "datetime", output: null })).toBe(true);
    expect(isRunOutputEvent({ type: "run.started", runId: "r1" })).toBe(false);
    expect(
      isRunOutputEvent({ type: "run.probing", model: "gpt-4o-mini", attempt: 1, attempts: 3, message: "..." }),
    ).toBe(false);
  });
});
