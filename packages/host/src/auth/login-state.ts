/**
 * The login-CSRF `state` of the browser sign-in (Phase 9,
 * docs/internal/web-phase9-portal-login.md §Browser flow, steps 1 and 3).
 *
 * `GET /api/v1/auth/start` mints one, puts it in an HttpOnly cookie and echoes it in the authorize
 * URL. The portal hands it back on the redirect, the browser posts it to `/api/v1/auth/login`, and
 * the host compares the two. That comparison is the only thing standing between a signed-in tenant
 * and an attacker who plants **their** authorization code in somebody else's browser: without it
 * the victim works, uploads and pays inside the attacker's tenant and nothing looks wrong.
 *
 * The raw value lives in the cookie rather than a hash of it. That is deliberate and it is enough:
 * the cookie is `HttpOnly` (no page script reads it), `SameSite=Lax` (no cross-site POST carries
 * it), `Secure` and `__Host-` prefixed on the server (no sibling host writes it), and it is spent
 * in ten minutes and cleared on every attempt. Storing a digest would protect nothing extra — an
 * attacker who can read this cookie can already read the session cookie beside it.
 *
 * Everything here is pure but for `mintLoginState`. No value from this module is ever logged.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SessionCookieMode } from "./session";

/** 32 random bytes, the same width as the session id (`./session.ts`). */
export const LOGIN_STATE_BYTES = 32;

/**
 * Two names for one cookie, the identical split `SESSION_COOKIE` makes and for the identical
 * reason: a browser on plain http silently drops a `__Host-` cookie, so webdev and the desktop
 * shell could never read one back.
 */
export const LOGIN_STATE_COOKIE = "agentforge_login_state";
export const LOGIN_STATE_COOKIE_SECURE = "__Host-agentforge_login_state";

/**
 * Ten minutes: long enough for somebody to read an e-mail and type a six-digit code at the portal,
 * short enough that a state left behind on a shared machine is worthless by the time anyone finds
 * it. The cookie is cleared on every login attempt regardless, so this is the outer bound.
 */
export const LOGIN_STATE_MAX_AGE_SECONDS = 600;

export function loginStateCookieName(mode: SessionCookieMode): string {
  return mode.secure ? LOGIN_STATE_COOKIE_SECURE : LOGIN_STATE_COOKIE;
}

export function mintLoginState(): string {
  return randomBytes(LOGIN_STATE_BYTES).toString("base64url");
}

/**
 * `decodeURIComponent` throws on a malformed escape and this value comes off an attacker-controlled
 * `Cookie` header, so an undecodable value reads as "no cookie" rather than surfacing as a 500.
 * The same rule `readSessionCookie` applies to the session cookie (`./session.ts`).
 */
function decodeCookieValue(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** This mode's state cookie out of a raw `Cookie` header, or null. The other mode's name is ignored. */
export function readLoginStateCookie(header: string | null | undefined, mode: SessionCookieMode): string | null {
  if (!header) {
    return null;
  }
  const name = loginStateCookieName(mode);
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1 || part.slice(0, index).trim() !== name) {
      continue;
    }
    const value = decodeCookieValue(part.slice(index + 1).trim());
    return value && value.length > 0 ? value : null;
  }
  return null;
}

/**
 * Constant-time equality for two states.
 *
 * Both sides are hashed to a fixed 32 bytes first, so the comparison itself is the same work for
 * every input and the branch on length that `timingSafeEqual` would otherwise force never happens.
 * An absent or empty state is never a match — "nothing equals nothing" is exactly the case an
 * attacker who can suppress the cookie would otherwise get for free.
 */
export function statesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}
