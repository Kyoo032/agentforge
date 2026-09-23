/**
 * Where a browser session lives between requests (web-security-spec row T1: "session token stored
 * server-side, cookie carries an opaque id").
 *
 * One interface, two implementations: SQLite through `@agentforge/db` (`auth_sessions`) for the
 * hosted server, and an in-memory map for tests and for any caller that wants a store without a
 * database.
 *
 * NEITHER IMPLEMENTATION KEEPS THE COOKIE'S ID. Both key a row by `hashSessionId(id)` (migration
 * 0021) and hand the presented id back on the way out, so a copy of the table replays nothing and a
 * digest presented as a cookie finds nothing.
 *
 * THE PORTAL REFRESH TOKEN, SEALED, LIVES ON THE ROW (`refresh_sealed`, owner decision 2026-09-23),
 * so a restart signs nobody out. The store never sees it in the clear: it is handed an opaque
 * string sealed by `./session-secrets.ts` and hands the same string back. It is never part of a
 * `SessionRecord`, so nothing that passes a record around — the gate, a handler, a summary — can
 * carry it by accident. It goes with the session: revoking a row wipes it in the same write, the
 * sweep wipes it once a session idles out, and the row's deletion takes it at the absolute expiry.
 *
 * TWO REQUESTS CAN RACE ON ONE SESSION, and each writes what it read. So `save` never clears a
 * revocation (a slide read before a sign-out must not resurrect it), and the portal check has its
 * own writer, `recordRotation`, which moves the stamp only forward and never stores a token on a
 * row that has been revoked in the meantime. `save` touches neither.
 */
import type { Database } from "@agentforge/db";
import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { hashSessionId, type SessionRecord } from "./session";

export interface SessionStore {
  /** Insert a freshly minted session, with its sealed refresh token when there is one. */
  create(session: SessionRecord, refreshSealed?: string | null): Promise<void>;
  /** The stored row under the cookie's id, or null when unknown. Never throws on a stranger's cookie. */
  find(id: string): Promise<SessionRecord | null>;
  /**
   * Persist a slide or a revocation. Never un-revokes and keeps the first revocation time; a row
   * that is revoked after this write holds no sealed token. Leaves `portalCheckedAt` alone.
   */
  save(session: SessionRecord): Promise<void>;
  /**
   * A rotation landed at `at`: the stamp moves forward (never back) and the sealed token becomes
   * `refreshSealed` — in one write, so the two can never disagree. `null` clears it. A row revoked
   * while the rotation was in flight keeps no token. No-op when the session is unknown.
   */
  recordRotation(id: string, at: number, refreshSealed: string | null): Promise<void>;
  /** The sealed refresh token of a live (unrevoked) session, or null. */
  readRefreshSealed(id: string): Promise<string | null>;
  /**
   * Drop sessions whose absolute expiry has passed, and wipe the sealed token of every session that
   * has idled out, whose row stays so it can still report itself. Returns how many rows went.
   */
  purgeExpired(before: number): Promise<number>;
}

/** The row a store keeps for `session`: everything but the cookie's id, which becomes its digest. */
function atRest(session: SessionRecord): SessionRecord {
  return { ...session, id: hashSessionId(session.id) };
}

/** The earlier revocation wins, and a revocation is never cleared. */
function stickyRevocation(stored: number | null, next: number | null): number | null {
  return stored ?? next;
}

export function createMemorySessionStore(seed: readonly SessionRecord[] = []): SessionStore {
  const rows = new Map<string, SessionRecord>(seed.map((session) => [hashSessionId(session.id), atRest(session)]));
  /** Beside the rows rather than in them, as the SQLite store keeps it out of the record it returns. */
  const sealed = new Map<string, string>();
  return {
    async create(session, refreshSealed = null) {
      const key = hashSessionId(session.id);
      rows.set(key, atRest(session));
      if (refreshSealed === null) {
        sealed.delete(key);
      } else {
        sealed.set(key, refreshSealed);
      }
    },
    async find(id) {
      const found = rows.get(hashSessionId(id));
      return found ? { ...found, id } : null;
    },
    async save(session) {
      const key = hashSessionId(session.id);
      const stored = rows.get(key);
      if (!stored) {
        // A store with no row to update is how tests seed one; the SQLite store would write nothing.
        rows.set(key, atRest(session));
        return;
      }
      const revokedAt = stickyRevocation(stored.revokedAt, session.revokedAt);
      rows.set(key, {
        ...stored,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        revokedAt,
      });
      if (revokedAt !== null) {
        sealed.delete(key);
      }
    },
    async recordRotation(id, at, refreshSealed) {
      const key = hashSessionId(id);
      const stored = rows.get(key);
      if (!stored) {
        return;
      }
      rows.set(key, { ...stored, portalCheckedAt: Math.max(stored.portalCheckedAt ?? at, at) });
      if (stored.revokedAt === null && refreshSealed !== null) {
        sealed.set(key, refreshSealed);
      } else {
        sealed.delete(key);
      }
    },
    async readRefreshSealed(id) {
      const key = hashSessionId(id);
      const stored = rows.get(key);
      return stored && stored.revokedAt === null ? (sealed.get(key) ?? null) : null;
    },
    async purgeExpired(before) {
      let removed = 0;
      for (const [key, session] of [...rows]) {
        if (session.absoluteExpiresAt <= before) {
          rows.delete(key);
          sealed.delete(key);
          removed += 1;
        } else if (session.expiresAt <= before) {
          sealed.delete(key);
        }
      }
      return removed;
    },
  };
}

/**
 * The portal tokens behind a session, keyed by session id: this process's working copy.
 *
 * Process memory, as the access token must be (the device-code doc: never written to disk). The
 * refresh token is ALSO kept sealed on the session row (`refresh_sealed`, `./session-secrets.ts`),
 * which is what survives a restart: after one, a session's first portal check finds this vault
 * empty, opens the sealed token and refreshes (`./portal-check.ts`). Until that refresh lands there
 * is no access token, hence `null`.
 */
export type PortalTokenSet = {
  readonly refreshToken: string;
  /** Null after a restart, until the next rotation hands a fresh one back. */
  readonly accessToken: string | null;
  readonly deviceId: string | null;
};

export interface TokenVault {
  put(sessionId: string, tokens: PortalTokenSet): Promise<void>;
  get(sessionId: string): Promise<PortalTokenSet | null>;
  delete(sessionId: string): Promise<void>;
}

export function createMemoryTokenVault(): TokenVault {
  const rows = new Map<string, PortalTokenSet>();
  return {
    async put(sessionId, tokens) {
      rows.set(sessionId, { ...tokens });
    },
    async get(sessionId) {
      const found = rows.get(sessionId);
      return found ? { ...found } : null;
    },
    async delete(sessionId) {
      rows.delete(sessionId);
    },
  };
}

/**
 * The drizzle table is imported lazily: `@agentforge/db`'s entry point opens the SQLite file as an
 * import side effect, and neither the desktop nor a unit test that never signs in should pay for it.
 */
async function table() {
  const { authSessions } = await import("@agentforge/db");
  return authSessions;
}

export function createDrizzleSessionStore(database: Database): SessionStore {
  return {
    async create(session, refreshSealed = null) {
      const authSessions = await table();
      await database.insert(authSessions).values({ ...atRest(session), refreshSealed });
    },
    async find(id) {
      const authSessions = await table();
      // Named columns, not `select()`: the sealed token must never ride out on a record.
      const [row] = await database
        .select({
          tenantId: authSessions.tenantId,
          userId: authSessions.userId,
          orgId: authSessions.orgId,
          createdAt: authSessions.createdAt,
          lastSeenAt: authSessions.lastSeenAt,
          expiresAt: authSessions.expiresAt,
          absoluteExpiresAt: authSessions.absoluteExpiresAt,
          revokedAt: authSessions.revokedAt,
          portalCheckedAt: authSessions.portalCheckedAt,
        })
        .from(authSessions)
        .where(eq(authSessions.id, hashSessionId(id)))
        .limit(1);
      return row
        ? { ...row, id, revokedAt: row.revokedAt ?? null, portalCheckedAt: row.portalCheckedAt ?? null }
        : null;
    },
    async save(session) {
      const authSessions = await table();
      await database
        .update(authSessions)
        .set({
          lastSeenAt: session.lastSeenAt,
          expiresAt: session.expiresAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
          // Never un-revokes, and the first revocation time stands: see the module comment.
          revokedAt: sql`coalesce(${authSessions.revokedAt}, ${session.revokedAt})`,
          // A row that is revoked once this write lands keeps no token. SQLite evaluates every SET
          // against the row as it was, so this reads the pre-write `revoked_at`.
          refreshSealed: sql`CASE WHEN coalesce(${authSessions.revokedAt}, ${session.revokedAt}) IS NULL THEN ${authSessions.refreshSealed} ELSE NULL END`,
        })
        .where(eq(authSessions.id, hashSessionId(session.id)));
    },
    async recordRotation(id, at, refreshSealed) {
      const authSessions = await table();
      await database
        .update(authSessions)
        .set({
          portalCheckedAt: sql`max(coalesce(${authSessions.portalCheckedAt}, ${at}), ${at})`,
          refreshSealed: sql`CASE WHEN ${authSessions.revokedAt} IS NULL THEN ${refreshSealed} ELSE NULL END`,
        })
        .where(eq(authSessions.id, hashSessionId(id)));
    },
    async readRefreshSealed(id) {
      const authSessions = await table();
      const [row] = await database
        .select({ refreshSealed: authSessions.refreshSealed })
        .from(authSessions)
        .where(and(eq(authSessions.id, hashSessionId(id)), isNull(authSessions.revokedAt)))
        .limit(1);
      return row?.refreshSealed ?? null;
    },
    async purgeExpired(before) {
      const authSessions = await table();
      const result = await database.delete(authSessions).where(lte(authSessions.absoluteExpiresAt, before));
      // Idled out: the row stays to report `refresh_expired`, the token it can no longer use does not.
      await database
        .update(authSessions)
        .set({ refreshSealed: null })
        .where(and(lte(authSessions.expiresAt, before), isNotNull(authSessions.refreshSealed)));
      return Number((result as { changes?: number }).changes ?? 0);
    },
  };
}

/**
 * The store the hosted server actually runs on. Lazy so that importing the router does not open the
 * database — the desktop and webdev never reach this call at all.
 */
export function createHostSessionStore(): SessionStore {
  let inner: Promise<SessionStore> | null = null;
  const resolve = async (): Promise<SessionStore> => {
    inner ??= import("@agentforge/db").then(({ db }) => createDrizzleSessionStore(db));
    return inner;
  };
  return {
    async create(session, refreshSealed) {
      return (await resolve()).create(session, refreshSealed);
    },
    async find(id) {
      return (await resolve()).find(id);
    },
    async save(session) {
      return (await resolve()).save(session);
    },
    async recordRotation(id, at, refreshSealed) {
      return (await resolve()).recordRotation(id, at, refreshSealed);
    },
    async readRefreshSealed(id) {
      return (await resolve()).readRefreshSealed(id);
    },
    async purgeExpired(before) {
      return (await resolve()).purgeExpired(before);
    },
  };
}
