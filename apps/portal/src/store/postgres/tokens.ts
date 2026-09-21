/**
 * refresh_tokens and the login gate.
 *
 * Both are thin: `rotate_refresh_token` and `login_precheck` are the plpgsql functions from
 * `0005_functions.sql`, and re-implementing either in TypeScript would mean two definitions of
 * reuse detection and two definitions of a seat. The rule (`README.md` of the migrations, 0005
 * rollback note) is explicit — "nothing in the application re-implements these checks".
 */
import type { PoolClient } from "pg";
import { sha256 } from "../../crypto";
import type { DenialReason, PortalOps, ReasonCode, RotateRefreshTokenResult } from "../types";
import { type Row, iso, toRefreshToken } from "./rows";

/** The sliding window from `device-code-login.md`; the absolute 90-day session ceiling caps it. */
const DEFAULT_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface RotateRow {
  reason_code: string;
  session_id: string | null;
  tenant_id: string | null;
  org_id: string | null;
  user_id: string | null;
  device_id: string | null;
  new_token_id: string | null;
  generation: number | null;
  expires_at: Date | null;
}

export function refreshTokensOps(client: PoolClient): PortalOps["refreshTokens"] {
  return {
    async issue(input) {
      const ttlSeconds = (input.ttlMs ?? DEFAULT_REFRESH_TTL_MS) / 1000;
      // LEAST against the session's absolute ceiling, exactly as rotate_refresh_token does for
      // every later generation: a generation-1 token must not outlive its own session either.
      const { rows } = await client.query<Row>(
        `INSERT INTO refresh_tokens (tenant_id, session_id, token_hash, generation, expires_at)
         SELECT s.tenant_id, s.id, $2, 1,
                LEAST(now() + make_interval(secs => $3::double precision), s.absolute_expires_at)
           FROM sessions s
          WHERE s.id = $1
         RETURNING *`,
        [input.sessionId, sha256(input.rawToken), ttlSeconds],
      );
      if (rows.length === 0) {
        throw new Error(`cannot issue a refresh token: session ${input.sessionId} is not in scope`);
      }
      return toRefreshToken(rows[0]);
    },

    async rotate(input): Promise<RotateRefreshTokenResult> {
      const ttlSeconds = (input.ttlMs ?? DEFAULT_REFRESH_TTL_MS) / 1000;
      const { rows } = await client.query<RotateRow>(
        `SELECT * FROM rotate_refresh_token($1::bytea, $2::bytea, $3::uuid,
                                            make_interval(secs => $4::double precision),
                                            $5::inet, $6::text)`,
        [
          sha256(input.presentedToken),
          sha256(input.newToken),
          input.deviceId ?? null,
          ttlSeconds,
          input.ip ?? null,
          input.userAgent ?? null,
        ],
      );
      const row = rows[0];
      if (!row) {
        // The function always returns exactly one row; no row means the call itself was refused.
        return Object.freeze({ reason: "refresh_expired" as DenialReason, sessionId: null, tenantId: null });
      }
      if (row.reason_code !== "ok") {
        return Object.freeze({
          reason: row.reason_code as DenialReason,
          sessionId: row.session_id,
          tenantId: row.tenant_id,
        });
      }
      return Object.freeze({
        reason: "ok" as const,
        sessionId: String(row.session_id),
        tenantId: String(row.tenant_id),
        orgId: String(row.org_id),
        userId: String(row.user_id),
        deviceId: String(row.device_id),
        newTokenId: String(row.new_token_id),
        generation: Number(row.generation),
        expiresAt: iso(row.expires_at),
      });
    },

    async listForSession(sessionId) {
      const { rows } = await client.query<Row>(
        `SELECT * FROM refresh_tokens WHERE session_id = $1 ORDER BY generation ASC`,
        [sessionId],
      );
      return Object.freeze(rows.map(toRefreshToken));
    },
  };
}

/**
 * `login_precheck(user, device, session)`. Called inside the same transaction that inserts the
 * session, because on the new-session path it takes the org advisory lock that makes the seat
 * check atomic against a concurrent login.
 */
export function loginPrecheck(client: PoolClient): PortalOps["loginPrecheck"] {
  return async (input) => {
    const { rows } = await client.query<{ reason: string }>(
      `SELECT login_precheck($1::uuid, $2::uuid, $3::uuid) AS reason`,
      [input.userId, input.deviceId, input.sessionId ?? null],
    );
    return (rows[0]?.reason ?? "user_inactive") as ReasonCode;
  };
}
