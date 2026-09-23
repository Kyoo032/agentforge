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
import { createSession, hashSessionId, revokedSession, slidSession, type SessionRecord } from "./session";
import { openRefresh, sealRefresh } from "./session-secrets";
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
  it("finds a session only by the cookie's id, never by the digest it stores", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session);
    expect((await store.find(session.id))?.id).toBe(session.id);
    // What a copy of the table would hand an attacker is not a cookie.
    expect(await store.find(hashSessionId(session.id))).toBeNull();
  });

  it("never un-revokes: a slide saved after a revocation keeps the revocation", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session);
    // Two requests on one session: one revokes it, the other slides the copy it read before that.
    await store.save(revokedSession(session, T0 + 10));
    await store.save(slidSession(session, T0 + 6 * 60 * 1000));
    const found = await store.find(session.id);
    expect(found?.revokedAt).toBe(T0 + 10);
    expect(found?.lastSeenAt).toBe(T0 + 6 * 60 * 1000);
  });

  it("keeps the first revocation time when revoked twice", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session);
    await store.save(revokedSession(session, T0 + 10));
    await store.save(revokedSession(session, T0 + 99));
    expect((await store.find(session.id))?.revokedAt).toBe(T0 + 10);
  });

  it("round-trips when the portal last vouched, and only ever moves it forward", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session);
    expect((await store.find(session.id))?.portalCheckedAt).toBe(T0);
    await store.recordRotation(session.id, T0 + 20 * 60 * 1000, "sealed-2");
    expect((await store.find(session.id))?.portalCheckedAt).toBe(T0 + 20 * 60 * 1000);
    // A check that finished late must not rewind one that finished after it.
    await store.recordRotation(session.id, T0 + 11 * 60 * 1000, "sealed-3");
    expect((await store.find(session.id))?.portalCheckedAt).toBe(T0 + 20 * 60 * 1000);
  });

  it("does not let a slide rewind the portal check", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session);
    await store.recordRotation(session.id, T0 + 20 * 60 * 1000, "sealed-2");
    await store.save(slidSession(session, T0 + 21 * 60 * 1000));
    expect((await store.find(session.id))?.portalCheckedAt).toBe(T0 + 20 * 60 * 1000);
  });

  it("keeps the sealed refresh token with the row it was created with, and never hands it out in the record", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session, "sealed-at-sign-in");
    expect(await store.readRefreshSealed(session.id)).toBe("sealed-at-sign-in");
    const found = (await store.find(session.id)) as Record<string, unknown>;
    expect(Object.values(found)).not.toContain("sealed-at-sign-in");
    expect(Object.keys(found)).not.toContain("refreshSealed");
  });

  it("holds no sealed token for a session created without one", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session);
    expect(await store.readRefreshSealed(session.id)).toBeNull();
  });

  it("replaces the sealed token and the check stamp in one rotation write", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session, "sealed-1");
    await store.recordRotation(session.id, T0 + 10 * 60 * 1000, "sealed-2");
    expect(await store.readRefreshSealed(session.id)).toBe("sealed-2");
    expect((await store.find(session.id))?.portalCheckedAt).toBe(T0 + 10 * 60 * 1000);
  });

  it("clears the sealed token when a rotation has nothing to store", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session, "sealed-1");
    await store.recordRotation(session.id, T0 + 10 * 60 * 1000, null);
    // The portal has spent sealed-1: keeping it would turn the next restart into a replay.
    expect(await store.readRefreshSealed(session.id)).toBeNull();
  });

  it("wipes the sealed token when the session is revoked, and a stale slide never brings it back", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session, "sealed-1");
    await store.save(revokedSession(session, T0 + 10));
    expect(await store.readRefreshSealed(session.id)).toBeNull();
    await store.save(slidSession(session, T0 + 6 * 60 * 1000));
    expect(await store.readRefreshSealed(session.id)).toBeNull();
  });

  it("never stores a rotated token on a row that was revoked while the rotation was in flight", async () => {
    const store = make();
    const session = sessionFor();
    await store.create(session, "sealed-1");
    await store.save(revokedSession(session, T0 + 10));
    await store.recordRotation(session.id, T0 + 20, "sealed-late");
    expect(await store.readRefreshSealed(session.id)).toBeNull();
    expect((await store.find(session.id))?.revokedAt).toBe(T0 + 10);
  });

  it("wipes the sealed token of a session that idled out, and deletes the rows past their absolute expiry", async () => {
    const store = make();
    const live = sessionFor();
    const idle = sessionFor({ expiresAt: T0 - 1 });
    const dead = sessionFor({ absoluteExpiresAt: T0 - 1, expiresAt: T0 - 2 });
    await store.create(live, "sealed-live");
    await store.create(idle, "sealed-idle");
    await store.create(dead, "sealed-dead");
    expect(await store.purgeExpired(T0)).toBe(1);
    expect(await store.readRefreshSealed(live.id)).toBe("sealed-live");
    expect(await store.readRefreshSealed(idle.id)).toBeNull();
    expect(await store.find(idle.id)).not.toBeNull();
    expect(await store.find(dead.id)).toBeNull();
  });

  it("records nothing for a session it does not hold", async () => {
    const store = make();
    await store.recordRotation("no-such-session", T0, "sealed");
    expect(await store.readRefreshSealed("no-such-session")).toBeNull();
    expect(await store.find("no-such-session")).toBeNull();
  });
});

describe("the SQLite store at rest", () => {
  it("writes the SHA-256 of the id, and never the id itself", async () => {
    const { sql } = await import("@agentforge/db");
    const session = sessionFor({ userId: "usr_at_rest" });
    await drizzleStore.create(session);
    const rows = sql.prepare("SELECT id FROM auth_sessions WHERE user_id = ?").all("usr_at_rest") as Array<{
      id: string;
    }>;
    expect(rows).toEqual([{ id: hashSessionId(session.id) }]);
    expect(JSON.stringify(rows)).not.toContain(session.id);
  });

  it("keeps only the sealed envelope in refresh_sealed, never the token itself", async () => {
    const { sql } = await import("@agentforge/db");
    const wrap = Buffer.alloc(32, 7);
    const session = sessionFor({ userId: "usr_sealed_at_rest" });
    const sealedToken = sealRefresh(
      hashSessionId(session.id),
      { refreshToken: "raw-refresh-at-rest", deviceId: "dev_9" },
      wrap,
    );
    await drizzleStore.create(session, sealedToken);
    const row = sql.prepare("SELECT refresh_sealed FROM auth_sessions WHERE user_id = ?").get("usr_sealed_at_rest") as {
      refresh_sealed: string;
    };
    expect(row.refresh_sealed).not.toContain("raw-refresh-at-rest");
    expect(openRefresh(hashSessionId(session.id), row.refresh_sealed, wrap)).toEqual({
      refreshToken: "raw-refresh-at-rest",
      deviceId: "dev_9",
    });
  });

  it("never finds a row written before 0021, whose id is the raw cookie value", async () => {
    const { sql } = await import("@agentforge/db");
    const raw = "a-raw-cookie-id-from-before-the-digest-migration";
    sql
      .prepare(
        "INSERT INTO auth_sessions (id, tenant_id, user_id, org_id, created_at, last_seen_at, expires_at, absolute_expires_at) VALUES (?, 'tnt_1', 'usr_old', 'org_1', ?, ?, ?, ?)",
      )
      .run(raw, T0, T0, T0 + 60_000, T0 + 120_000);
    expect(await drizzleStore.find(raw)).toBeNull();
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
