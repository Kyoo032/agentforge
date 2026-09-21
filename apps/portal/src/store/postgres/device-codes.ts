/**
 * device_codes: the state machine of `docs/internal/portal/device-code-login.md`.
 *
 *   pending ──approve──> approved ──redeem──> redeemed
 *      │  └──deny──────> denied
 *      └──expires_at / 200 polls──> expired
 *
 * Every transition is terminal except `pending -> approved`, and `redeemed` is reached exactly
 * once — the single-use guarantee lives in the same transaction that creates the session.
 */
import type { PoolClient } from "pg";
import { normaliseUserCode, randomUserCode, sha256 } from "../../crypto";
import type {
  ApproveDeviceCodeResult,
  Clock,
  DenyDeviceCodeResult,
  PollDeviceCodeResult,
  PortalOps,
} from "../types";
import { type Row, toDeviceCode } from "./rows";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_SECONDS = 5;
/** `slow_down` widens the interval by 5 s, "permanently for this attempt". */
const SLOW_DOWN_STEP_SECONDS = 5;
/** device_codes_interval_chk allows 1..60, so the widening stops there rather than failing a CHECK. */
const MAX_INTERVAL_SECONDS = 60;
/** Two polls inside one window are fine; the third is what answers slow_down. */
const POLLS_PER_WINDOW = 2;
/** "More than 200 polls on one device_code -> expire it and audit device_code.poll_abuse." */
const MAX_POLLS = 200;
/** How many times a user_code collision is retried before giving up. */
const USER_CODE_ATTEMPTS = 8;

function first(rows: Row[]): Row | null {
  return rows.length > 0 ? rows[0] : null;
}

export function deviceCodesOps(client: PoolClient, clock: Clock): PortalOps["deviceCodes"] {
  return {
    async create(input) {
      const expiresAt = new Date(clock.now().getTime() + (input.ttlMs ?? DEFAULT_TTL_MS));
      const hash = sha256(input.rawDeviceCode);

      // uq_device_codes_user_code_live is partial (pending/approved only), so the 8-char space
      // recycles instead of exhausting. A collision therefore just means "try another one".
      for (let attempt = 0; attempt < USER_CODE_ATTEMPTS; attempt += 1) {
        const userCode = randomUserCode();
        // A savepoint, not a bare try/catch: a unique violation aborts the whole transaction in
        // Postgres, so without this the retry would run inside a poisoned one (25P02) and the
        // caller's earlier work would be lost as well.
        await client.query("SAVEPOINT device_code_mint");
        try {
          const { rows } = await client.query<Row>(
            `INSERT INTO device_codes (tenant_id, device_code_hash, user_code, install_id, platform,
                                       client_name, client_version, requested_scope,
                                       interval_seconds, expires_at, created_ip)
             VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'app'), $9, $10, $11)
             RETURNING *`,
            [
              input.tenantId ?? null,
              hash,
              userCode,
              input.installId,
              input.platform ?? null,
              input.clientName ?? null,
              input.clientVersion ?? null,
              input.requestedScope ?? null,
              input.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS,
              expiresAt.toISOString(),
              input.createdIp ?? null,
            ],
          );
          await client.query("RELEASE SAVEPOINT device_code_mint");
          return toDeviceCode(rows[0]);
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT device_code_mint");
          const code = (error as { code?: string }).code;
          const constraint = (error as { constraint?: string }).constraint;
          if (code === "23505" && constraint === "uq_device_codes_user_code_live") {
            continue;
          }
          throw error;
        }
      }
      throw new Error("could not mint a free user_code after several attempts");
    },

    async findByUserCode(userCode) {
      const { rows } = await client.query<Row>(`SELECT * FROM device_codes WHERE user_code = $1`, [
        normaliseUserCode(userCode),
      ]);
      const row = first(rows);
      return row ? toDeviceCode(row) : null;
    },

    async approve(input): Promise<ApproveDeviceCodeResult> {
      const { rows } = await client.query<Row>(
        `SELECT * FROM device_codes WHERE user_code = $1 FOR UPDATE`,
        [normaliseUserCode(input.userCode)],
      );
      const row = first(rows);
      if (row?.status !== "pending" || new Date(String(row.expires_at)) <= clock.now()) {
        return { ok: false, reason: "device_code_expired" };
      }
      // The tenant hint on the row, when there was one, is binding: a code minted for one partner
      // cannot be approved into another.
      if (row.tenant_id !== null && String(row.tenant_id) !== input.tenantId) {
        return { ok: false, reason: "tenant_inactive" };
      }

      // One UPDATE, because device_codes_approved_chk requires tenant/user/org together.
      const updated = await client.query<Row>(
        `UPDATE device_codes
            SET status = 'approved',
                tenant_id = $2,
                org_id = $3,
                user_id = $4,
                device_id = $5,
                approved_at = now(),
                approved_ip = $6
          WHERE id = $1
          RETURNING *`,
        [row.id, input.tenantId, input.orgId, input.userId, input.deviceId, input.approvedIp ?? null],
      );
      return { ok: true, code: toDeviceCode(updated.rows[0]) };
    },

    async deny(userCode): Promise<DenyDeviceCodeResult> {
      const { rows } = await client.query<Row>(
        `UPDATE device_codes
            SET status = 'denied', denied_at = now()
          WHERE user_code = $1 AND status = 'pending' AND expires_at > now()
          RETURNING *`,
        [normaliseUserCode(userCode)],
      );
      const row = first(rows);
      return row ? { ok: true, code: toDeviceCode(row) } : { ok: false, reason: "device_code_expired" };
    },

    async poll(rawDeviceCode, installId): Promise<PollDeviceCodeResult> {
      const { rows } = await client.query<Row>(
        `SELECT * FROM device_codes WHERE device_code_hash = $1 FOR UPDATE`,
        [sha256(rawDeviceCode)],
      );
      const row = first(rows);
      if (!row) {
        return { reason: "invalid_grant" };
      }
      // "install_id in the body must equal device_codes.install_id" — the row is not even counted
      // as a poll, so a wrong install cannot burn someone else's 200.
      if (String(row.install_id) !== installId) {
        return { reason: "invalid_grant" };
      }

      const now = clock.now();
      const intervalSeconds = Number(row.interval_seconds);
      const windowStartedAt = row.poll_window_started_at ? new Date(String(row.poll_window_started_at)) : null;
      const inWindow =
        windowStartedAt !== null && now.getTime() - windowStartedAt.getTime() < intervalSeconds * 1000;
      const windowCount = inWindow ? Number(row.poll_window_count) + 1 : 1;
      const pollCount = Number(row.poll_count) + 1;

      const expiredByTime = new Date(String(row.expires_at)) <= now;
      const abusive = pollCount > MAX_POLLS;
      const tooFast = windowCount > POLLS_PER_WINDOW;
      const status = String(row.status);

      // Where the two clocks disagree the row wins: a code that lapsed while the app was asleep is
      // expired now, whatever its stored status says.
      const nextStatus = abusive || (status === "pending" && expiredByTime) ? "expired" : status;
      // Only an answered slow_down widens the interval. Being slow-downed for a code that is
      // already approved would punish the successful poll.
      const answeringSlowDown = tooFast && nextStatus === "pending" && !abusive;
      const nextInterval = answeringSlowDown
        ? Math.min(intervalSeconds + SLOW_DOWN_STEP_SECONDS, MAX_INTERVAL_SECONDS)
        : intervalSeconds;

      await client.query(
        `UPDATE device_codes
            SET poll_count = $2,
                last_polled_at = $3,
                poll_window_started_at = $4,
                poll_window_count = $5,
                interval_seconds = $6,
                status = $7
          WHERE id = $1`,
        [
          row.id,
          pollCount,
          now.toISOString(),
          (inWindow && windowStartedAt ? windowStartedAt : now).toISOString(),
          windowCount,
          nextInterval,
          nextStatus,
        ],
      );

      if (abusive) {
        // The caller audits `device_code.poll_abuse`; the store's job is to make the code dead.
        return { reason: "device_code_expired" };
      }
      if (nextStatus === "expired") {
        return { reason: "device_code_expired" };
      }
      if (nextStatus === "denied") {
        return { reason: "device_code_denied" };
      }
      if (nextStatus === "redeemed") {
        // Already exchanged for a session. The caller audits `device_code.replayed`.
        return { reason: "invalid_grant" };
      }
      if (nextStatus === "approved") {
        const fresh = await client.query<Row>(`SELECT * FROM device_codes WHERE id = $1`, [row.id]);
        return { reason: "ok", code: toDeviceCode(fresh.rows[0]) };
      }
      if (answeringSlowDown) {
        return { reason: "slow_down", intervalSeconds: nextInterval, retryAfter: nextInterval };
      }
      return { reason: "authorization_pending", intervalSeconds: nextInterval };
    },

    async redeem(input) {
      const { rows } = await client.query<Row>(
        `UPDATE device_codes
            SET status = 'redeemed', used_at = now(), session_id = $2
          WHERE device_code_hash = $1 AND status = 'approved'
          RETURNING *`,
        [sha256(input.rawDeviceCode), input.sessionId],
      );
      const row = first(rows);
      return row ? toDeviceCode(row) : null;
    },

    async expireDue() {
      const { rows } = await client.query<{ expire_device_codes: number }>(
        `SELECT expire_device_codes()`,
      );
      return Number(rows[0]?.expire_device_codes ?? 0);
    },
  };
}
