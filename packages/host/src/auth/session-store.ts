/**
 * Where a browser session lives between requests (web-security-spec row T1: "session token stored
 * server-side, cookie carries an opaque id").
 *
 * One interface, two implementations: SQLite through `@agentforge/db` (`auth_sessions`) for the
 * hosted server, and an in-memory map for tests and for any caller that wants a store without a
 * database. No portal token is stored here — see `./portal-client` for why the refresh token stays
 * in process memory in this phase.
 */
import type { Database } from "@agentforge/db";
import { eq, lte } from "drizzle-orm";
import type { SessionRecord } from "./session";

export interface SessionStore {
  /** Insert a freshly minted session. */
  create(session: SessionRecord): Promise<void>;
  /** The stored row, or null when the id is unknown. Never throws on a stranger's cookie. */
  find(id: string): Promise<SessionRecord | null>;
  /** Persist a new copy of an existing session (a slide, or a revocation). */
  save(session: SessionRecord): Promise<void>;
  /** Drop sessions whose absolute expiry has passed. Returns how many rows went. */
  purgeExpired(before: number): Promise<number>;
}

function copy(session: SessionRecord): SessionRecord {
  return { ...session };
}

export function createMemorySessionStore(seed: readonly SessionRecord[] = []): SessionStore {
  const rows = new Map<string, SessionRecord>(seed.map((session) => [session.id, copy(session)]));
  return {
    async create(session) {
      rows.set(session.id, copy(session));
    },
    async find(id) {
      const found = rows.get(id);
      return found ? copy(found) : null;
    },
    async save(session) {
      rows.set(session.id, copy(session));
    },
    async purgeExpired(before) {
      let removed = 0;
      for (const [id, session] of [...rows]) {
        if (session.absoluteExpiresAt <= before) {
          rows.delete(id);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

/**
 * The portal tokens behind a session, keyed by session id.
 *
 * Deliberately **process memory only**, for this phase. The device-code doc keeps the access token
 * in memory and the refresh token in a keychain-wrapped file on the desktop; the server has no
 * equivalent at-rest envelope until the per-tenant secret storage of Phase 4
 * (docs/internal/web-migration-plan.md §Phase 4). Writing a raw refresh token into SQLite before
 * then would be the one plaintext secret in the database, so it does not happen here. The cost is
 * stated plainly: a server restart drops the refresh tokens and every signed-in browser has to sign
 * in again at its next refresh.
 */
export type PortalTokenSet = {
  readonly refreshToken: string;
  readonly accessToken: string;
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
    async create(session) {
      const authSessions = await table();
      await database.insert(authSessions).values(session);
    },
    async find(id) {
      const authSessions = await table();
      const [row] = await database.select().from(authSessions).where(eq(authSessions.id, id)).limit(1);
      return row ? { ...row, revokedAt: row.revokedAt ?? null } : null;
    },
    async save(session) {
      const authSessions = await table();
      await database
        .update(authSessions)
        .set({
          lastSeenAt: session.lastSeenAt,
          expiresAt: session.expiresAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
          revokedAt: session.revokedAt,
        })
        .where(eq(authSessions.id, session.id));
    },
    async purgeExpired(before) {
      const authSessions = await table();
      const result = await database.delete(authSessions).where(lte(authSessions.absoluteExpiresAt, before));
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
    async create(session) {
      return (await resolve()).create(session);
    },
    async find(id) {
      return (await resolve()).find(id);
    },
    async save(session) {
      return (await resolve()).save(session);
    },
    async purgeExpired(before) {
      return (await resolve()).purgeExpired(before);
    },
  };
}
