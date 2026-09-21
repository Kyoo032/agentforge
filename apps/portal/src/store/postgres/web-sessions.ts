/**
 * The per-user counter that makes the portal's own browser session revocable
 * (`apps/portal/migrations/0009_web_session_revocation.sql`, SR-21).
 *
 * The cookie carries the version it was minted under; every use compares it against this table.
 * **No row means version 1**, so nothing has to be back-filled and a user who has never been
 * revoked costs one indexed read and no write, ever.
 */
import type { PoolClient } from "pg";
import type { PortalOps } from "../types";

/** What a cookie minted against a user with no row was signed with. */
export const INITIAL_WEB_SESSION_VERSION = 1;

export function webSessionsOps(client: PoolClient): PortalOps["webSessions"] {
  return {
    async version(userId) {
      const { rows } = await client.query<{ version: number }>(
        `SELECT version FROM web_session_versions WHERE user_id = $1`,
        [userId],
      );
      return rows.length > 0 ? Number(rows[0].version) : INITIAL_WEB_SESSION_VERSION;
    },

    async revoke(input) {
      // The insert lands on 2, not 1: an absent row already reads as 1, so the first revocation
      // has to move past it or it would revoke nothing.
      const { rows } = await client.query<{ version: number }>(
        `INSERT INTO web_session_versions (user_id, tenant_id, version)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET version = web_session_versions.version + 1, updated_at = now()
         RETURNING version`,
        [input.userId, input.tenantId, INITIAL_WEB_SESSION_VERSION + 1],
      );
      return Number(rows[0].version);
    },
  };
}
