import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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
 * **Bound to the session since Phase 3 lane C.** The token is `<salt>.<HMAC(key, sessionId.salt)>`
 * rather than bare randomness, so a token minted for one session is refused when it is echoed by
 * another — the double-submit pair alone proves same-origin script, not same-signed-in-person, and
 * a shared machine or a stolen-then-reused cookie is exactly where that gap bites. Off server mode
 * there is no session, so the binding is to the empty id: one code path, and webdev and the desktop
 * behave exactly as before.
 */

/** Cookie the renderer reads off the hosted server. Deliberately NOT HttpOnly. */
export const CSRF_COOKIE_SECURE = "__Host-agentforge_csrf";

/** Cookie the renderer reads on plain http (webdev, desktop), where `__Host-` would be rejected. */
export const CSRF_COOKIE = "agentforge_csrf";

/** Header the renderer echoes the cookie in on every mutating call. */
export const CSRF_HEADER = "x-agentforge-csrf";

/** Salt in the token, so two tokens for one session still differ. */
const SALT_BYTES = 16;

/**
 * The HMAC key. Process-lifetime randomness: a token only has to outlive the process that minted
 * it, and `mintCsrfTokenFor` is re-run for any cookie that does not verify, so a restart costs one
 * re-mint on the next GET rather than a wedged browser.
 *
 * **Single-process assumption.** Two app processes behind the proxy would each mint tokens the
 * other refuses. The hosted deployment is one Express host today (`apps/web/server.ts`); running
 * more than one means a shared key from the environment, and that is a deploy-time decision, not a
 * default invented here. Recorded in docs/internal/web-phase3-lane-c.md.
 */
let signingKey: Buffer | null = null;

function csrfSigningKey(): Buffer {
  signingKey ??= randomBytes(32);
  return signingKey;
}

/** Tests only: forget the process key so the next mint starts a new one. */
export function resetCsrfSigningKeyForTests(): void {
  signingKey = null;
}

function sign(sessionId: string, salt: string, key: Buffer): string {
  return createHmac("sha256", key).update(`${sessionId}.${salt}`).digest("base64url");
}

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

/**
 * A fresh, unguessable token bound to `sessionId`, in base64url plus one `.`, safe to put in a
 * cookie and a header unencoded.
 *
 * An absent session id (webdev, the desktop, and a hosted visitor who has not signed in yet) binds
 * to the empty string, which is what `checkCsrfToken` then verifies against — so an anonymous token
 * stops working the moment the browser signs in, and the next GET mints the bound one.
 */
export function mintCsrfTokenFor(sessionId: string | null | undefined, key: Buffer = csrfSigningKey()): string {
  const salt = randomBytes(SALT_BYTES).toString("base64url");
  return `${salt}.${sign(sessionId ?? "", salt, key)}`;
}

/** A fresh token bound to no session. Kept for callers that have no session to bind to. */
export function mintCsrfToken(): string {
  return mintCsrfTokenFor(null);
}

/**
 * Does this token carry this process's signature over this session id?
 *
 * A token minted before a restart, before a sign-in, or for a different session all fail here, and
 * all are answered the same way: the adapter mints a replacement on the next safe request.
 */
export function csrfTokenMatchesSession(
  token: string | null | undefined,
  sessionId: string | null | undefined,
  key: Buffer = csrfSigningKey(),
): boolean {
  const parts = token?.trim().split(".");
  if (parts?.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    return false;
  }
  return equalsInConstantTime(parts[1], sign(sessionId ?? "", parts[0], key));
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
  sessionId?: string | null,
): CsrfCheck {
  const cookie = readCsrfCookie(cookies, mode)?.trim();
  const header = headerToken?.trim();
  if (!cookie || !header) {
    return { ok: false, code: "csrf_missing", message: MISSING_MESSAGE };
  }
  if (!equalsInConstantTime(cookie, header)) {
    return { ok: false, code: "csrf_invalid", message: INVALID_MESSAGE };
  }
  // The pair matching proves same-origin script. This proves it is *this* browser session's token:
  // a token lifted from another session, or minted before this one signed in, does not verify.
  if (!csrfTokenMatchesSession(cookie, sessionId)) {
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
