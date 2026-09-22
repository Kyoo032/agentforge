/**
 * The portal's own browser session -- the 30-day cookie `device-code-login.md` promises, so "the
 * second and third device activation need no OTP at all".
 *
 * It is a signed value, not a row. The reason is a boundary rather than a preference: the store
 * contract (`src/store/types.ts`) belongs to another lane and has no table for a browser session,
 * and inventing one here would mean a migration this lane can write but no code path that can
 * write to it. So the cookie carries its own claims and an HMAC.
 *
 * **It is still revocable** (SR-21). The cookie carries the version it was minted under and every
 * use compares that against `web_session_versions` inside the tenant scope
 * (`apps/portal/migrations/0009_web_session_revocation.sql`); a bump ends the session on the next
 * request. On top of that, every use re-runs `login_precheck`, so a disabled user, a suspended or
 * past-due org, a revoked device or an exhausted seat cap stops it too.
 *
 * A cookie minted before the version existed carries no `ver` and is refused rather than assumed
 * to be version 1: the whole point is that the server decides, and a payload shape the server does
 * not recognise is not a shape it can decide about. The cost is one extra sign-in, once.
 *
 * The HMAC key is derived from the signing key by signing a fixed label. Ed25519 signatures are
 * deterministic, so the same `PORTAL_SIGNING_KEY` yields the same secret across restarts, and the
 * seed itself never leaves `src/jwt/keys.ts`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PortalKey } from "../jwt/keys";

/** Thirty days (`device-code-login.md`, GET /activate). */
export const WEB_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERSION = 1;
const LABEL = "portal-web-session-v1";

export interface WebSession {
  readonly tenantId: string;
  readonly userId: string;
  readonly orgId: string;
  /**
   * The `devices.install_id` this browser's device row is keyed by. Carried so a returning
   * browser lands on the same `devices` row and therefore the same `device_id`.
   */
  readonly installId: string;
  /**
   * `web_session_versions.version` at the moment this cookie was minted. A cookie whose version
   * is behind the stored one has been revoked and is refused on its next use.
   */
  readonly ver: number;
  /** Epoch milliseconds. */
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export type WebSessionSecret = Buffer;

/** Deterministic per signing key, and computable only by the holder of the private half. */
export function webSessionSecret(key: PortalKey): WebSessionSecret {
  return key.sign(Buffer.from(LABEL, "utf8"));
}

interface Payload extends WebSession {
  readonly v: number;
}

function sign(secret: WebSessionSecret, body: string): string {
  return createHmac("sha256", secret).update(body, "ascii").digest("base64url");
}

export function mintWebSession(
  secret: WebSessionSecret,
  session: Omit<WebSession, "issuedAt" | "expiresAt">,
  now: number,
  ttlMs: number = WEB_SESSION_TTL_MS,
): string {
  const payload: Payload = { v: VERSION, ...session, issuedAt: now, expiresAt: now + ttlMs };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

/**
 * `null` for every failure -- a bad signature, a stale version, an expired window and a value that
 * is not a cookie of ours all mean the same thing to the caller: sign in again.
 */
export function readWebSession(
  secret: WebSessionSecret,
  cookieValue: string | undefined,
  now: number,
): WebSession | null {
  if (!cookieValue) {
    return null;
  }
  const separator = cookieValue.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }
  const body = cookieValue.slice(0, separator);
  const presented = Buffer.from(cookieValue.slice(separator + 1), "base64url");
  const expected = Buffer.from(sign(secret, body), "base64url");
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return null;
  }

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }
  if (payload?.v !== VERSION || typeof payload.expiresAt !== "number" || payload.expiresAt <= now) {
    return null;
  }
  if (
    typeof payload.tenantId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.orgId !== "string" ||
    typeof payload.installId !== "string" ||
    !Number.isInteger(payload.ver)
  ) {
    return null;
  }

  return Object.freeze({
    tenantId: payload.tenantId,
    userId: payload.userId,
    orgId: payload.orgId,
    installId: payload.installId,
    ver: payload.ver,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  });
}
