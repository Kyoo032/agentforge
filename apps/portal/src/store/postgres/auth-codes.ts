/**
 * auth_codes and oauth_clients — the browser half of the login
 * (`apps/portal/migrations/0006_browser_login.sql`).
 *
 * An authorization code is worth a session for 60 seconds, so it is bound to two things and checked
 * against both: the client it was issued to, and the redirect_uri it was issued for. Binding first,
 * expiry and single-use after: a code presented by the wrong client is refused on that ground
 * whether or not it is still fresh, so nothing about its freshness leaks to the wrong caller.
 *
 * **`state_hash` is written and never compared** (SR-43). The login-CSRF binding on `state` is the
 * host's: `/auth/start` mints it into a `__Host-` cookie and `POST /api/v1/auth/login` compares the
 * two in constant time (`packages/host/src/auth/routes.ts`, `readState`) before the portal is
 * called at all. The host does not send `state` to `/auth/token`, so a check here could only ever
 * have been skipped — a branch that never runs, documented as a control, is worse than no branch.
 * The hash stays on the row: it is 32 bytes, it costs nothing, and it lets an audit tie a code to
 * the nonce the browser carried.
 */
import type { PoolClient } from "pg";
import { hashEquals, sha256 } from "../../crypto";
import type { Clock, ConsumeAuthCodeResult, PortalOps } from "../types";
import { type Row, toAuthCode, toOAuthClient } from "./rows";

const DEFAULT_TTL_MS = 60 * 1000;

function first(rows: Row[]): Row | null {
  return rows.length > 0 ? rows[0] : null;
}

export function authCodesOps(client: PoolClient, clock: Clock): PortalOps["authCodes"] {
  return {
    async issue(input) {
      const expiresAt = new Date(clock.now().getTime() + (input.ttlMs ?? DEFAULT_TTL_MS));
      const { rows } = await client.query<Row>(
        `INSERT INTO auth_codes (tenant_id, org_id, user_id, client_id, code_hash, redirect_uri,
                                 state_hash, expires_at, created_ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          input.tenantId,
          input.orgId,
          input.userId,
          input.clientId,
          sha256(input.rawCode),
          input.redirectUri,
          sha256(input.state),
          expiresAt.toISOString(),
          input.createdIp ?? null,
        ],
      );
      return toAuthCode(rows[0]);
    },

    async consume(input): Promise<ConsumeAuthCodeResult> {
      const { rows } = await client.query<Row>(
        `SELECT * FROM auth_codes WHERE code_hash = $1 FOR UPDATE`,
        [sha256(input.rawCode)],
      );
      const row = first(rows);
      if (!row) {
        return { ok: false, reason: "invalid_grant" };
      }
      if (String(row.client_id) !== input.clientId) {
        return { ok: false, reason: "client_mismatch" };
      }
      if (String(row.redirect_uri) !== input.redirectUri) {
        return { ok: false, reason: "redirect_mismatch" };
      }
      if (row.consumed_at !== null) {
        return { ok: false, reason: "already_used" };
      }
      if (new Date(String(row.expires_at)) <= clock.now()) {
        return { ok: false, reason: "expired" };
      }

      const consumed = await client.query<Row>(
        `UPDATE auth_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING *`,
        [row.id],
      );
      // The row was locked FOR UPDATE above, so losing this race means someone else consumed it.
      const updated = first(consumed.rows);
      if (!updated) {
        return { ok: false, reason: "already_used" };
      }
      return { ok: true, code: toAuthCode(updated) };
    },
  };
}

export function oauthClientsOps(client: PoolClient): PortalOps["oauthClients"] {
  const load = async (clientId: string): Promise<(Row & { secret_hash: Buffer }) | null> => {
    const { rows } = await client.query<Row & { secret_hash: Buffer }>(
      `SELECT * FROM oauth_clients WHERE client_id = $1`,
      [clientId],
    );
    return rows.length > 0 ? rows[0] : null;
  };

  return {
    async create(input) {
      const { rows } = await client.query<Row>(
        `INSERT INTO oauth_clients (client_id, tenant_id, name, secret_hash, redirect_uris)
         VALUES ($1, $2, $3, $4, $5::text[])
         RETURNING *`,
        [input.clientId, input.tenantId, input.name, sha256(input.secret), [...input.redirectUris]],
      );
      return toOAuthClient(rows[0]);
    },
    async findByClientId(clientId) {
      const row = await load(clientId);
      return row ? toOAuthClient(row) : null;
    },
    async verifySecret(clientId, secret) {
      const row = await load(clientId);
      if (row?.status !== "active") {
        // Hash the candidate anyway, so an unknown client and a wrong secret cost the same.
        sha256(secret);
        return false;
      }
      return hashEquals(sha256(secret), row.secret_hash);
    },
    async rotateSecret(clientId, secret) {
      const { rows } = await client.query<Row>(
        `UPDATE oauth_clients SET secret_hash = $2, updated_at = now()
          WHERE client_id = $1 AND status = 'active'
          RETURNING *`,
        [clientId, sha256(secret)],
      );
      const row = first(rows);
      return row ? toOAuthClient(row) : null;
    },
    async setRedirectUris(clientId, redirectUris) {
      const { rows } = await client.query<Row>(
        `UPDATE oauth_clients SET redirect_uris = $2::text[], updated_at = now()
          WHERE client_id = $1 AND status = 'active'
          RETURNING *`,
        [clientId, [...redirectUris]],
      );
      const row = first(rows);
      return row ? toOAuthClient(row) : null;
    },
    async allowsRedirect(clientId, redirectUri) {
      const row = await load(clientId);
      if (row?.status !== "active") {
        return false;
      }
      // Exact match only. No prefix rule and no wildcard: a redirect allowlist that matches
      // loosely is an open redirect, and an open redirect here hands over the authorization code.
      const allowed = Array.isArray(row.redirect_uris) ? row.redirect_uris.map(String) : [];
      return allowed.includes(redirectUri);
    },
  };
}
