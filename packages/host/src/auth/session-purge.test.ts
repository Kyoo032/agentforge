/**
 * Expired sessions have to leave the table on their own: nothing else deletes a row, so without a
 * sweep `auth_sessions` grows for the life of the deployment and keeps 30-day-old identities around
 * long after they stopped being usable (web-security-spec row T1).
 *
 * The timer is `unref()`'d, so it never holds the process open — a one-shot CLI that happens to
 * touch the store still exits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_PURGE_INTERVAL_MS, hostSessionStore, resetHostAuthForTests, startSessionPurge } from "./index";
import { createSession, type SessionRecord } from "./session";
import { createMemorySessionStore, type SessionStore } from "./session-store";

const T0 = Date.UTC(2026, 8, 18, 9, 0, 0);

function expired(now: number): SessionRecord {
  const session = createSession({ tenantId: "t", userId: "u", orgId: "o", now });
  return { ...session, absoluteExpiresAt: now - 1 };
}

function tracked(inner: SessionStore): { store: SessionStore; sweeps: number[] } {
  const sweeps: number[] = [];
  return {
    sweeps,
    store: {
      ...inner,
      async purgeExpired(before) {
        sweeps.push(before);
        return inner.purgeExpired(before);
      },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startSessionPurge", () => {
  it("sweeps once at first use, before any interval has passed", async () => {
    const { store, sweeps } = tracked(createMemorySessionStore());
    const stop = startSessionPurge(store, { now: () => T0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sweeps).toEqual([T0]);
    stop();
  });

  it("sweeps again every 15 minutes", async () => {
    const { store, sweeps } = tracked(createMemorySessionStore());
    let now = T0;
    const stop = startSessionPurge(store, { now: () => now });
    await vi.advanceTimersByTimeAsync(0);
    now = T0 + SESSION_PURGE_INTERVAL_MS;
    await vi.advanceTimersByTimeAsync(SESSION_PURGE_INTERVAL_MS);
    now = T0 + 2 * SESSION_PURGE_INTERVAL_MS;
    await vi.advanceTimersByTimeAsync(SESSION_PURGE_INTERVAL_MS);
    expect(sweeps).toEqual([T0, T0 + SESSION_PURGE_INTERVAL_MS, T0 + 2 * SESSION_PURGE_INTERVAL_MS]);
    stop();
  });

  it("is 15 minutes", () => {
    expect(SESSION_PURGE_INTERVAL_MS).toBe(15 * 60 * 1000);
  });

  it("actually drops the expired rows and keeps the live ones", async () => {
    const store = createMemorySessionStore();
    const dead = expired(T0);
    const alive = createSession({ tenantId: "t", userId: "u", orgId: "o", now: T0 });
    await store.create(dead);
    await store.create(alive);
    const stop = startSessionPurge(store, { now: () => T0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(await store.find(dead.id)).toBeNull();
    expect(await store.find(alive.id)).not.toBeNull();
    stop();
  });

  it("stops sweeping once the handle is stopped", async () => {
    const { store, sweeps } = tracked(createMemorySessionStore());
    const stop = startSessionPurge(store, { now: () => T0 });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(10 * SESSION_PURGE_INTERVAL_MS);
    expect(sweeps).toHaveLength(1);
  });

  it("does not hold the process open", () => {
    const store = createMemorySessionStore();
    const stop = startSessionPurge(store, { now: () => T0 });
    // Fake timers record `unref()`; a held timer here would keep a CLI alive for 15 minutes.
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is wired into the composition root, and torn down with it", () => {
    resetHostAuthForTests();
    expect(vi.getTimerCount()).toBe(0);
    hostSessionStore();
    expect(vi.getTimerCount()).toBe(1);
    // A second caller gets the same store, not a second timer.
    hostSessionStore();
    expect(vi.getTimerCount()).toBe(1);
    resetHostAuthForTests();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("survives a store that throws, and keeps sweeping", async () => {
    const sweeps: number[] = [];
    const angry: SessionStore = {
      ...createMemorySessionStore(),
      async purgeExpired(before) {
        sweeps.push(before);
        throw new Error("database is away");
      },
    };
    let now = T0;
    const stop = startSessionPurge(angry, { now: () => now });
    await vi.advanceTimersByTimeAsync(0);
    now = T0 + SESSION_PURGE_INTERVAL_MS;
    await vi.advanceTimersByTimeAsync(SESSION_PURGE_INTERVAL_MS);
    expect(sweeps).toHaveLength(2);
    stop();
  });
});
