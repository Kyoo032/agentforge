/**
 * The browser session for the hosted deployment (docs/internal/web-migration-plan.md, Phase 2;
 * docs/internal/web-security-spec.md, row T1).
 *
 * The cookie carries an opaque 32-byte id and nothing else; every attribute of the session lives
 * server-side in the store (`./session-store`). Idle timeout 12 h, absolute lifetime 30 days, and
 * `lastSeenAt` slides at most once every 5 minutes so a busy tab does not write on every request.
 *
 * Everything here is pure: `now` is a parameter, records are never mutated, and no portal token ever
 * reaches this module. The desktop (IPC) and webdev never mint a session at all — the caller decides
 * that from `isServerMode()`.
 */
import { randomBytes } from "node:crypto";

/** 32 random bytes, per T1 ("cookie carries an opaque id"). */
export const SESSION_ID_BYTES = 32;

/**
 * Two names for one cookie, the same split the CSRF cookie already makes (`../csrf.ts`).
 *
 * The hosted server mints the `__Host-` prefixed name. A browser accepts that prefix only when the
 * cookie is `Secure`, `Path=/` and carries no `Domain`, and — the reason it is here — nothing but
 * that exact origin can write it: no sibling subdomain, no `document.cookie` on a related host. So a
 * stolen-or-planted session id cannot be pushed into the browser from anywhere but us.
 *
 * Off server mode the prefix is impossible: webdev and the desktop shell speak plain http, where a
 * browser silently drops a `__Host-` cookie. They keep the plain name and behave exactly as before.
 */
export const SESSION_COOKIE = "agentforge_session";
export const SESSION_COOKIE_SECURE = "__Host-agentforge_session";

/** Which half of the deployment this is; `secure: true` is the hosted HTTPS server. */
export type SessionCookieMode = { readonly secure: boolean };

/** The cookie name this mode writes and reads. The other mode's name is ignored entirely. */
export function sessionCookieName(mode: SessionCookieMode): string {
  return mode.secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE;
}

export const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/** A request older than this since `lastSeenAt` writes the slide; anything sooner is free. */
export const SLIDE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * One vocabulary for both halves of the product: the portal's reason codes
 * (docs/internal/portal/device-code-login.md:222 and the table at :409-423) plus the two this phase
 * adds — `session_required` (the brief's 401 for a mutating call with no session) and
 * `portal_unavailable` (the portal was unreachable, which the portal itself cannot report).
 * `invalid_request` / `invalid_grant` are the RFC 6749 families the portal returns without a reason.
 */
export const AUTH_REASONS = [
  "tenant_inactive",
  "org_inactive",
  "org_past_due",
  "user_inactive",
  "seat_cap_reached",
  "device_revoked",
  "session_revoked",
  "refresh_reused",
  "refresh_expired",
  "invalid_request",
  "invalid_grant",
  "session_required",
  "portal_unavailable",
] as const;

export type AuthReason = (typeof AUTH_REASONS)[number];

export function isAuthReason(value: unknown): value is AuthReason {
  return typeof value === "string" && (AUTH_REASONS as readonly string[]).includes(value);
}

/** The server-side row behind the cookie. Epoch milliseconds throughout, like every other host table. */
export type SessionRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly orgId: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly revokedAt: number | null;
};

export type SessionVerdict =
  | { readonly ok: true; readonly session: SessionRecord; readonly slid: boolean }
  | { readonly ok: false; readonly reason: AuthReason };

export type SessionSummary = {
  readonly signedIn: true;
  readonly userId: string;
  readonly orgId: string;
  readonly tenantId: string;
  readonly expiresAt: number;
};

export function mintSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString("base64url");
}

export function createSession(input: { tenantId: string; userId: string; orgId: string; now?: number }): SessionRecord {
  const now = input.now ?? Date.now();
  return {
    id: mintSessionId(),
    tenantId: input.tenantId,
    userId: input.userId,
    orgId: input.orgId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + IDLE_TIMEOUT_MS,
    absoluteExpiresAt: now + ABSOLUTE_LIFETIME_MS,
    revokedAt: null,
  };
}

/**
 * Lookup result → verdict. Revoked beats expired so a forced sign-out reports itself as one
 * (`session_revoked` is recoverable by signing in; the copy differs).
 */
export function verifySession(session: SessionRecord | null | undefined, now: number = Date.now()): SessionVerdict {
  if (!session) {
    return { ok: false, reason: "session_required" };
  }
  if (session.revokedAt !== null) {
    return { ok: false, reason: "session_revoked" };
  }
  if (now >= session.expiresAt || now >= session.absoluteExpiresAt) {
    return { ok: false, reason: "refresh_expired" };
  }
  if (now - session.lastSeenAt < SLIDE_INTERVAL_MS) {
    return { ok: true, session, slid: false };
  }
  return { ok: true, session: slidSession(session, now), slid: true };
}

/** A copy seen at `now`, with the idle window re-opened but never past the absolute expiry. */
export function slidSession(session: SessionRecord, now: number): SessionRecord {
  return {
    ...session,
    lastSeenAt: now,
    expiresAt: Math.min(now + IDLE_TIMEOUT_MS, session.absoluteExpiresAt),
  };
}

/** A revoked copy. Re-revoking keeps the first time, so an audit reads the moment it actually died. */
export function revokedSession(session: SessionRecord, now: number = Date.now()): SessionRecord {
  return { ...session, revokedAt: session.revokedAt ?? now };
}

export function sessionSummary(session: SessionRecord): SessionSummary {
  return {
    signedIn: true,
    userId: session.userId,
    orgId: session.orgId,
    tenantId: session.tenantId,
    expiresAt: session.expiresAt,
  };
}

/**
 * Cookie lifetime tracks the absolute expiry: the idle timeout is enforced server-side.
 *
 * The attributes themselves (`HttpOnly; SameSite=Lax; Path=/`, plus `Secure` on the hosted server —
 * A2 / T1) are set on the `HostCookie` the routes return and serialised once, by the HTTP adapter.
 * Lax rather than Strict because the sign-in returns through a top-level navigation from the portal.
 */
export function sessionCookieMaxAge(session: SessionRecord, now: number = Date.now()): number {
  return Math.max(0, Math.floor((session.absoluteExpiresAt - now) / 1000));
}

/**
 * `decodeURIComponent` throws on a malformed escape (`%`, `%zz`), and this value comes straight off
 * an attacker-controlled `Cookie` header. A cookie nobody can decode is a cookie nobody sent: null,
 * so the caller answers 401 instead of letting a `URIError` surface as a 500.
 */
function decodeCookieValue(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * The session id out of a raw `Cookie` header, or null.
 *
 * `mode` is required rather than defaulted: a caller that read the plain name on the hosted server
 * would hand back exactly the session-fixation the `__Host-` prefix exists to prevent, and a default
 * is how that happens by accident.
 */
export function readSessionCookie(header: string | null | undefined, mode: SessionCookieMode): string | null {
  if (!header) {
    return null;
  }
  const name = sessionCookieName(mode);
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    if (part.slice(0, index).trim() !== name) {
      continue;
    }
    const value = decodeCookieValue(part.slice(index + 1).trim());
    return value && value.length > 0 ? value : null;
  }
  return null;
}
