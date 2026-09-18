/**
 * Both implementations of `SessionStore`, against the same behaviour.
 *
 * ISOLATION: the drizzle half needs a real SQLite file, and `@agentforge/db` resolves that path once,
 * when it is first imported. So the data dir is pointed at a throwaway directory HERE, before the
 * dynamic import below — never at `data/`, where the operator's own sessions and desks live.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, revokedSession, slidSession, type SessionRecord } from "./session";
import {
  createDrizzleSessionStore,
  createMemorySessionStore,
  createMemoryTokenVault,
  type SessionStore,
} from "./session-store";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-session-store-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_SECRETS_KEY = "d".repeat(64);
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;

const T0 = Date.UTC(2026, 8, 18, 9, 0, 0);

/** Filled in `beforeAll`: importing it at the top would open the database before the line above. */
let drizzleStore: SessionStore;

beforeAll(async () => {
  const { db } = await import("@agentforge/db");
  drizzleStore = createDrizzleSessionStore(db);
}, 60_000);

afterAll(async () => {
  // The SQLite file lives in dataDir; close it so Windows releases the handle before cleanup.
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function sessionFor(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return { ...createSession({ tenantId: "tnt_1", userId: "usr_1", orgId: "org_1", now: T0 }), ...overrides };
}

const implementations: Array<[string, () => SessionStore]> = [
  ["memory", () => createMemorySessionStore()],
  ["drizzle", () => drizzleStore],
];

describe.each(implementations)("SessionStore (%s)", (_name, make) => {
  it("round-trips a session", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session);
    expect(await store.find(session.id)).toEqual(session);
  });

  it("is null for an unknown id", async () => {
    const store = make();
    expect(await store.find("nope-not-a-session")).toBeNull();
  });

  it("stores the slid copy without touching the other fields", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session);
    const slid = slidSession(session, T0 + 6 * 60 * 1000);
    await store.save(slid);
    const found = await store.find(session.id);
    expect(found).toEqual(slid);
    expect(found?.createdAt).toBe(T0);
  });

  it("revokes a session and keeps the row findable", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session);
    await store.save(revokedSession(session, T0 + 10));
    expect((await store.find(session.id))?.revokedAt).toBe(T0 + 10);
  });

  it("does not leak one session into another", async () => {
    const store = make();
    const a = sessionFor({ userId: "usr_a" });
    const b = sessionFor({ userId: "usr_b" });
    await store.create(a);
    await store.create(b);
    expect((await store.find(a.id))?.userId).toBe("usr_a");
    expect((await store.find(b.id))?.userId).toBe("usr_b");
  });

  it("purges sessions whose absolute expiry has passed and keeps live ones", async () => {
    const store = make();
    const dead = sessionFor({ absoluteExpiresAt: T0 - 1 });
    const live = sessionFor();
    await store.create(dead);
    await store.create(live);
    // Exactly one: the throwaway database holds only what this suite put in it.
    expect(await store.purgeExpired(T0)).toBe(1);
    expect(await store.find(dead.id)).toBeNull();
    expect(await store.find(live.id)).not.toBeNull();
  });

  it("overwrites nothing on create of a fresh id", async () => {
    const store = make();
    const a = sessionFor();
    await store.create(a);
    const b = sessionFor();
    await store.create(b);
    expect(await store.find(a.id)).toEqual(a);
  });
});

describe("createMemorySessionStore", () => {
  it("hands out copies, so a caller cannot mutate the stored record", async () => {
    const store = createMemorySessionStore();
    const session = createSession({ tenantId: "t", userId: "u", orgId: "o", now: T0 });
    await store.create(session);
    const found = (await store.find(session.id)) as { lastSeenAt: number };
    found.lastSeenAt = 1;
    expect((await store.find(session.id))?.lastSeenAt).toBe(T0);
  });
});

describe("createMemoryTokenVault", () => {
  it("hands a session's portal tokens back and forgets them on delete", async () => {
    const vault = createMemoryTokenVault();
    await vault.put("s1", { refreshToken: "r1", accessToken: "a1", deviceId: "d1" });
    expect(await vault.get("s1")).toEqual({ refreshToken: "r1", accessToken: "a1", deviceId: "d1" });
    await vault.delete("s1");
    expect(await vault.get("s1")).toBeNull();
  });

  it("is null for a session it never saw (a server restart, for one)", async () => {
    expect(await createMemoryTokenVault().get("s-unknown")).toBeNull();
  });

  it("replaces the rotated refresh token rather than keeping both", async () => {
    const vault = createMemoryTokenVault();
    await vault.put("s1", { refreshToken: "r1", accessToken: "a1", deviceId: null });
    await vault.put("s1", { refreshToken: "r2", accessToken: "a2", deviceId: null });
    expect((await vault.get("s1"))?.refreshToken).toBe("r2");
  });
});
