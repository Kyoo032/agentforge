/** devices and sessions — the two rows a login chain is made of. */
import type { PoolClient } from "pg";
import type { Clock, PortalOps } from "../types";
import { type Row, toDevice, toSession } from "./rows";

const DEFAULT_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function first(rows: Row[]): Row | null {
  return rows.length > 0 ? rows[0] : null;
}

export function devicesOps(client: PoolClient): PortalOps["devices"] {
  return {
    async upsert(input) {
      // Locked first rather than going straight to ON CONFLICT, because a revoked install must be
      // refused, not quietly updated back into life: "a revoked device cannot be re-approved
      // without an admin clearing it" (device-code-login.md, POST /auth/device/approve, step 4).
      const existing = await client.query<Row>(
        `SELECT * FROM devices WHERE user_id = $1 AND install_id = $2 FOR UPDATE`,
        [input.userId, input.installId],
      );
      const current = first(existing.rows);
      if (current && current.status === "revoked") {
        return { ok: false, reason: "device_revoked", device: toDevice(current) };
      }

      const { rows } = await client.query<Row>(
        `INSERT INTO devices (tenant_id, org_id, user_id, install_id, label, platform,
                              os_version, app_version, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
         ON CONFLICT (user_id, install_id) DO UPDATE
           SET label        = COALESCE(EXCLUDED.label, devices.label),
               platform     = EXCLUDED.platform,
               os_version   = COALESCE(EXCLUDED.os_version, devices.os_version),
               app_version  = COALESCE(EXCLUDED.app_version, devices.app_version),
               org_id       = EXCLUDED.org_id,
               last_seen_at = now()
         RETURNING *`,
        [
          input.tenantId,
          input.orgId,
          input.userId,
          input.installId,
          input.label ?? null,
          input.platform,
          input.osVersion ?? null,
          input.appVersion ?? null,
        ],
      );
      return { ok: true, device: toDevice(rows[0]) };
    },
    async findById(id) {
      const { rows } = await client.query<Row>(`SELECT * FROM devices WHERE id = $1`, [id]);
      const row = first(rows);
      return row ? toDevice(row) : null;
    },
    async findByInstall(userId, installId) {
      const { rows } = await client.query<Row>(
        `SELECT * FROM devices WHERE user_id = $1 AND install_id = $2`,
        [userId, installId],
      );
      const row = first(rows);
      return row ? toDevice(row) : null;
    },
    async revoke(id, reason) {
      const { rows } = await client.query<Row>(
        `UPDATE devices
            SET status = 'revoked',
                revoked_at = COALESCE(revoked_at, now()),
                revoked_reason = COALESCE(revoked_reason, $2)
          WHERE id = $1
          RETURNING *`,
        [id, reason],
      );
      const row = first(rows);
      return row ? toDevice(row) : null;
    },
    async touch(id) {
      await client.query(`UPDATE devices SET last_seen_at = now() WHERE id = $1`, [id]);
    },
  };
}

export function sessionsOps(client: PoolClient, clock: Clock): PortalOps["sessions"] {
  const revokeOne = async (sessionId: string, reason: string): Promise<void> => {
    // 0005's helper: the whole refresh chain, the session row, and one audit_log entry.
    await client.query(`SELECT revoke_session_chain($1, $2)`, [sessionId, reason]);
  };

  return {
    async create(input) {
      const absoluteExpiresAt = new Date(
        clock.now().getTime() + (input.absoluteTtlMs ?? DEFAULT_ABSOLUTE_TTL_MS),
      );
      const { rows } = await client.query<Row>(
        `INSERT INTO sessions (tenant_id, org_id, user_id, device_id, scope, absolute_expires_at,
                               last_seen_at, last_ip, last_user_agent)
         VALUES ($1, $2, $3, $4, COALESCE($5, 'app'), $6, COALESCE($7::timestamptz, now()), $8, $9)
         RETURNING *`,
        [
          input.tenantId,
          input.orgId,
          input.userId,
          input.deviceId,
          input.scope ?? null,
          absoluteExpiresAt.toISOString(),
          input.lastSeenAt ?? null,
          input.ip ?? null,
          input.userAgent ?? null,
        ],
      );
      return toSession(rows[0]);
    },
    async findById(id) {
      const { rows } = await client.query<Row>(`SELECT * FROM sessions WHERE id = $1`, [id]);
      const row = first(rows);
      return row ? toSession(row) : null;
    },
    async listLiveForUser(userId) {
      const { rows } = await client.query<Row>(
        `SELECT * FROM sessions
          WHERE user_id = $1 AND revoked_at IS NULL
          ORDER BY last_seen_at DESC`,
        [userId],
      );
      return Object.freeze(rows.map(toSession));
    },
    async revoke(id, reason) {
      await revokeOne(id, reason);
      const { rows } = await client.query<Row>(`SELECT * FROM sessions WHERE id = $1`, [id]);
      const row = first(rows);
      return row ? toSession(row) : null;
    },
    async revokeAllForUser(userId, reason) {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      for (const row of rows) {
        await revokeOne(row.id, reason);
      }
      return rows.length;
    },
    async revokeAllForDevice(deviceId, reason) {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM sessions WHERE device_id = $1 AND revoked_at IS NULL`,
        [deviceId],
      );
      for (const row of rows) {
        await revokeOne(row.id, reason);
      }
      return rows.length;
    },
    async touch(id, ip, userAgent) {
      await client.query(
        `UPDATE sessions
            SET last_seen_at = now(),
                last_ip = COALESCE($2::inet, last_ip),
                last_user_agent = COALESCE($3, last_user_agent)
          WHERE id = $1`,
        [id, ip ?? null, userAgent ?? null],
      );
    },
  };
}
