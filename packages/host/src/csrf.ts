import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Double-submit CSRF token for the HTTP adapter (docs/internal/web-security-spec.md A2).
 *
 * The token is minted on the first GET that arrives without one and handed back as a cookie the
 * renderer can read, so `apps/web/lib/api-client.ts` can echo it in `x-agentforge-csrf` on every
 * mutating call. A cross-site page can make the browser send the cookie, but it cannot read it and
 * therefore cannot set the header, which is what makes the pair a proof of same-origin script.
 *
 * The cookie is minted in every mode so the renderer path is exercised on webdev; only the hosted
 * server (`isServerMode`) rejects a call that fails the check. Webdev and the desktop are unchanged.
 *
 * Phase 2 follow-up: bind the token to the portal session by minting it as
 * HMAC(server key, session id) + salt instead of bare randomness, so a token issued to one session
 * cannot be replayed by another. Until the session lands there is nothing to bind to, and the
 * comparison below is already constant-time and length-safe, so the shape does not change.
 */

/** Cookie the renderer reads off the hosted server. Deliberately NOT HttpOnly. */
export const CSRF_COOKIE_SECURE = "__Host-agentforge_csrf";

/** Cookie the renderer reads on plain http (webdev, desktop), where `__Host-` would be rejected. */
export const CSRF_COOKIE = "agentforge_csrf";

/** Header the renderer echoes the cookie in on every mutating call. */
export const CSRF_HEADER = "x-agentforge-csrf";

/** 32 bytes of randomness: 256 bits, the same order as a session id. */
const TOKEN_BYTES = 32;

const MISSING_MESSAGE = "Missing CSRF token";
const INVALID_MESSAGE = "CSRF token does not match this session";

/**
 * Which half of the deployment this process is: `secure: true` is the hosted HTTPS server.
 *
 * The flag picks the cookie NAME as well as the `Secure` attribute, because the two cannot be
 * separated: a browser accepts a `__Host-` cookie only when it is `Secure`, `Path=/` and carries no
 * `Domain`, and it silently drops one sent over plain http — which would break webdev and the
 * desktop. So the prefix is used exactly where `Secure` is.
 */
export type CsrfMode = { readonly secure: boolean };

export type CsrfErrorCode = "csrf_missing" | "csrf_invalid";

export type CsrfCheck =
  | { readonly ok: true; readonly code?: undefined; readonly message?: undefined }
  | { readonly ok: false; readonly code: CsrfErrorCode; readonly message: string };

/** A fresh, unguessable token in base64url, safe to put in a cookie and a header unencoded. */
export function mintCsrfToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** The cookie name this mode mints and reads; the other mode's name is ignored entirely. */
export function csrfCookieName(mode: CsrfMode): string {
  return mode.secure ? CSRF_COOKIE_SECURE : CSRF_COOKIE;
}

/** The token this mode's cookie carries, or undefined when it is absent or empty. */
export function readCsrfCookie(cookies: Readonly<Record<string, string>>, mode: CsrfMode): string | undefined {
  return cookies[csrfCookieName(mode)] || undefined;
}

/**
 * The `Set-Cookie` value for a minted token.
 *
 * `SameSite=Lax` (not `Strict`) so a normal top-level navigation into the app still carries the
 * token; `HttpOnly` is omitted on purpose because the renderer has to read it; `Secure` and the
 * `__Host-` name are added on the hosted server, where everything is HTTPS, and left off on loopback
 * webdev, where they are not. No `Domain` attribute is ever written, which `__Host-` also requires.
 */
export function csrfSetCookie(token: string, mode: CsrfMode): string {
  const attributes = [`${csrfCookieName(mode)}=${encodeURIComponent(token)}`, "Path=/", "SameSite=Lax"];
  return mode.secure ? [...attributes, "Secure"].join("; ") : attributes.join("; ");
}

/**
 * Compares this mode's cookie against the echoed header in constant time, without leaking which one
 * failed. Taking the whole cookie jar keeps the name choice in one place: a caller cannot check the
 * wrong cookie for the mode it is running in.
 */
export function checkCsrfToken(
  cookies: Readonly<Record<string, string>>,
  headerToken: string | null | undefined,
  mode: CsrfMode,
): CsrfCheck {
  // Phase 2 follow-up: bind the token to the portal session - mint it as HMAC(server key, session id)
  // and verify that HMAC here - so a token issued to one session cannot be replayed in another. There
  // is no session to bind to until the portal exchange lands; the comparison below does not change.
  const cookie = readCsrfCookie(cookies, mode)?.trim();
  const header = headerToken?.trim();
  if (!cookie || !header) {
    return { ok: false, code: "csrf_missing", message: MISSING_MESSAGE };
  }
  if (!equalsInConstantTime(cookie, header)) {
    return { ok: false, code: "csrf_invalid", message: INVALID_MESSAGE };
  }
  return { ok: true };
}

/** `timingSafeEqual` throws on a length mismatch, so the lengths are compared first. */
function equalsInConstantTime(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
