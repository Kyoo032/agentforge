/**
 * login_otps: 6 digits, 10-minute TTL, 5 attempts per code, single use, 3 sends per 15 minutes per
 * address, and 20 guesses per address per 24 hours.
 *
 * Both limits per address are counted from the rows themselves over `ix_login_otps_tenant_email`,
 * exactly as `schema.md` describes: no counter column, nothing to reconcile. `prune_login_otps()`
 * keeps 24 h of rows, which is what keeps the 15-minute send window and the 24-hour guess window
 * countable. A prune that kept less would quietly shrink the daily limit's memory.
 */
import type { PoolClient } from "pg";
import { hashEquals, normaliseEmail, sha256 } from "../../crypto";
import type { Clock, PortalOps, SendLoginOtpResult, VerifyLoginOtpResult } from "../types";
import { type Row, toLoginOtp } from "./rows";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const SEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
/** login_otps_attempts_chk caps the column at 5; a sixth verify can never succeed. */
const MAX_ATTEMPTS = 5;
/**
 * Guesses per address per 24 hours, across every code and both purposes. Without it, five a code
 * and three codes per 15 minutes is about 1,440 guesses a day at one address, which is roughly a
 * 0.14% chance a day of guessing a six-digit code, repeatable every day. Twenty is 0.002% a day,
 * and still leaves an honest person with fat fingers four codes' worth of mistakes.
 */
const MAX_GUESSES_PER_DAY = 20;
const GUESS_WINDOW_MS = 24 * 60 * 60 * 1000;

export function loginOtpsOps(client: PoolClient, clock: Clock): PortalOps["loginOtps"] {
  return {
    async send(input): Promise<SendLoginOtpResult> {
      const email = normaliseEmail(input.email);
      const windowStart = new Date(clock.now().getTime() - SEND_WINDOW_MS);

      const recent = await client.query<{ created_at: Date }>(
        `SELECT created_at FROM login_otps
          WHERE tenant_id = $1 AND email = $2 AND created_at > $3
          ORDER BY created_at ASC`,
        [input.tenantId, email, windowStart.toISOString()],
      );

      if (recent.rows.length >= MAX_SENDS_PER_WINDOW) {
        // Retry when the oldest send in the window falls out of it — the moment a budget frees up.
        const oldest = new Date(recent.rows[0].created_at).getTime();
        const retryAfter = Math.max(1, Math.ceil((oldest + SEND_WINDOW_MS - clock.now().getTime()) / 1000));
        return { ok: false, reason: "send_rate_limited", retryAfter };
      }

      const expiresAt = new Date(clock.now().getTime() + (input.ttlMs ?? DEFAULT_TTL_MS));
      const { rows } = await client.query<Row>(
        `INSERT INTO login_otps (tenant_id, email, otp_hash, purpose, expires_at, created_ip)
         VALUES ($1, $2, $3, COALESCE($4, 'activate'), $5, $6)
         RETURNING *`,
        [
          input.tenantId,
          email,
          sha256(input.code),
          input.purpose ?? null,
          expiresAt.toISOString(),
          input.createdIp ?? null,
        ],
      );
      return { ok: true, otp: toLoginOtp(rows[0]) };
    },

    async verify(input): Promise<VerifyLoginOtpResult> {
      const email = normaliseEmail(input.email);

      // The address's daily total comes first, so it refuses even the right code on a fresh code.
      // Every row of the last 24 h is locked in a fixed order: two verifies for one address, for
      // either purpose, then take turns, and each sees the other's guess. The total is exact, not
      // "twenty, plus however many guesses arrived at once".
      const dayStart = new Date(clock.now().getTime() - GUESS_WINDOW_MS);
      const today = await client.query<{ attempts: number }>(
        `SELECT attempts FROM login_otps
          WHERE tenant_id = $1 AND email = $2 AND created_at > $3
          ORDER BY created_at, id
          FOR UPDATE`,
        [input.tenantId, email, dayStart.toISOString()],
      );
      const guessed = today.rows.reduce((sum, row) => sum + Number(row.attempts), 0);
      if (guessed >= MAX_GUESSES_PER_DAY) {
        return { ok: false, reason: "locked", attemptsRemaining: 0 };
      }

      // The newest *unconsumed* code for the address: requesting a second code retires the first,
      // which is what stops a user typing a stale one and burning attempts on it.
      const { rows } = await client.query<Row & { otp_hash: Buffer }>(
        `SELECT * FROM login_otps
          WHERE tenant_id = $1 AND email = $2 AND purpose = COALESCE($3, 'activate')
            AND consumed_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [input.tenantId, email, input.purpose ?? null],
      );
      const row = rows[0];
      if (!row) {
        return { ok: false, reason: "no_code", attemptsRemaining: 0 };
      }

      const attempts = Number(row.attempts);
      if (attempts >= MAX_ATTEMPTS) {
        return { ok: false, reason: "too_many_attempts", attemptsRemaining: 0 };
      }
      if (new Date(String(row.expires_at)) <= clock.now()) {
        return { ok: false, reason: "expired", attemptsRemaining: MAX_ATTEMPTS - attempts };
      }

      if (!hashEquals(sha256(input.code), row.otp_hash)) {
        const bumped = await client.query<Row>(
          `UPDATE login_otps SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
          [row.id],
        );
        const used = Number(bumped.rows[0].attempts);
        return { ok: false, reason: "invalid_code", attemptsRemaining: MAX_ATTEMPTS - used };
      }

      // consumed_at is set in the same transaction that signs the user in: that is what makes the
      // code single-use rather than merely short-lived.
      const consumed = await client.query<Row>(
        `UPDATE login_otps SET consumed_at = now() WHERE id = $1 RETURNING *`,
        [row.id],
      );
      return { ok: true, otp: toLoginOtp(consumed.rows[0]) };
    },

    async prune() {
      const { rows } = await client.query<{ prune_login_otps: number }>(`SELECT prune_login_otps()`);
      return Number(rows[0]?.prune_login_otps ?? 0);
    },
  };
}
