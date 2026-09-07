import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmitLock, EMIT_LOCK_MS } from "./use-emit-lock";

describe("emit lock (G-12)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("locks touching clips until the card event", () => {
    const lock = createEmitLock();
    lock.onToolStarted(["c1", "c2"]);
    expect(lock.isActive()).toBe(true);
    expect(lock.lockedClipIds()).toEqual(["c1", "c2"]);
    expect(lock.isLocked("c1")).toBe(true);
    lock.onCard();
    expect(lock.isActive()).toBe(false);
    expect(lock.lockedClipIds()).toEqual([]);
    lock.dispose();
  });

  it("auto-releases after 5 seconds", () => {
    vi.useFakeTimers();
    const lock = createEmitLock();
    lock.onToolStarted(["clip-a"]);
    vi.advanceTimersByTime(EMIT_LOCK_MS - 1);
    expect(lock.isActive()).toBe(true);
    expect(lock.isLocked("clip-a")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(lock.isActive()).toBe(false);
    expect(lock.lockedClipIds()).toEqual([]);
    lock.dispose();
  });

  it("never locks while a job is pending", () => {
    vi.useFakeTimers();
    const lock = createEmitLock();
    lock.onToolStarted(["clip-a"], { jobPending: true });
    expect(lock.isActive()).toBe(false);
    expect(lock.lockedClipIds()).toEqual([]);
    vi.advanceTimersByTime(EMIT_LOCK_MS);
    expect(lock.isActive()).toBe(false);
    lock.dispose();
  });
});
