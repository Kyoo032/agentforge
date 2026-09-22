/**
 * What every HTML response carries.
 *
 * `src/server.ts` already writes `no-store`, `nosniff` and `Referrer-Policy: no-referrer` on
 * everything. This adds the rest for pages, and the reasons are specific rather than a cargo list:
 *
 *   - `frame-ancestors 'none'` plus `X-Frame-Options: DENY` -- the approve screen is a
 *     clickjacking target by construction: one button that authorises a device.
 *   - `script-src 'none'` -- there is no script on any of these pages, so a CSP that merely
 *     forbids inline script would still allow one someone injected from a CDN.
 *   - `form-action 'self'` -- a successful injection cannot repoint the sign-in form at a
 *     collector. A page inside an `/authorize` flow adds ONE more source: the origin of the
 *     client's `redirect_uri`, and only after that URI has been exact-matched against the client's
 *     registered allowlist (`flows/authorize.ts`, `checkClient`). It has to be there, because a
 *     browser enforces `form-action` across the whole redirect chain of a submission and the
 *     successful `POST /authorize/verify` answers `302 Location: <redirect_uri>?code&state` on
 *     another origin -- with `'self'` alone Chromium blocks the submission outright, which is the
 *     bug `docs/internal/security-register.md` records as SR-20. Nothing else widens it: not the
 *     activate screens, not the error pages, and not a page rendered before the client was
 *     validated.
 *   - `Referrer-Policy: no-referrer` -- the URLs here carry `state`, `code` and `user_code`, and a
 *     `Referer` on any outbound link would hand them over. Repeated here so the rule survives a
 *     change to the server's defaults.
 *   - `Cache-Control: no-store` -- an OTP page in a shared browser's back button is the whole
 *     point of the attack.
 */
import type { PortalResponse } from "../server";

const BEFORE_FORM_ACTION = [
  "default-src 'none'",
  "script-src 'none'",
  // One inline <style> in the layout; no external stylesheet, so nothing to fetch and nothing to
  // point somewhere else. Scripts stay at 'none'.
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
];
const AFTER_FORM_ACTION = ["frame-ancestors 'none'", "base-uri 'none'"];

/**
 * A `redirect_uri` reduced to exactly `new URL(x).origin`, or `null`.
 *
 * `null` for anything that is not an http(s) URL -- `javascript:`, `data:`, a bare scheme, a
 * wildcard, a keyword, junk -- so the only thing that can ever be appended is a real origin. The
 * path, the query and the fragment are dropped by `URL.origin` itself.
 *
 * The shape check on top of that is **not** decoration. `URL.origin` is happy to hand back
 * `https://a,b` and `https://a;b`: neither `,` nor `;` is a forbidden host code point, and both are
 * structural in a CSP header. A `;` would end `form-action` and start a directive of its own; a `,`
 * is worse, because a comma splits the header into TWO policies and everything after it -- here
 * `frame-ancestors 'none'; base-uri 'none'` -- would stop applying to the first one. So the host is
 * matched against a deliberately narrow charset (an already-punycoded name, or a bracketed IPv6
 * literal) with an optional numeric port, and anything else falls back to `'self'`.
 */
const SAFE_ORIGIN = /^https?:\/\/(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

export function formActionSource(redirectUri: string): string | null {
  let origin: string;
  try {
    origin = new URL(redirectUri).origin;
  } catch {
    return null;
  }
  // "null" is what URL.origin answers for an opaque origin (data:, blob: of one, a non-special
  // scheme), and it is also a CSP keyword source -- so it is refused by name as well as by shape.
  if (origin === "null" || !SAFE_ORIGIN.test(origin)) {
    return null;
  }
  return origin;
}

/**
 * `form-action 'self'`, plus the origin of each already-validated `redirect_uri` the caller
 * passed. Deduplicated, and silently short of anything `formActionSource` refuses -- a page that
 * cannot name its client's origin falls back to `'self'`, which fails closed.
 */
function contentSecurityPolicy(formActionOrigins: readonly string[] = []): string {
  const sources = ["'self'"];
  for (const value of formActionOrigins) {
    const origin = formActionSource(value);
    if (origin !== null && !sources.includes(origin)) {
      sources.push(origin);
    }
  }
  return [...BEFORE_FORM_ACTION, `form-action ${sources.join(" ")}`, ...AFTER_FORM_ACTION].join("; ");
}

export const HTML_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": contentSecurityPolicy(),
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store, no-cache, must-revalidate",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
});

export interface HtmlResponseOptions {
  readonly status?: number;
  /** At most one -- see `withCookie`. */
  readonly cookie?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * URLs whose ORIGIN may also be a form target on this page, beyond `'self'`.
   *
   * Pass only a value that has already been validated against a registered allowlist -- today the
   * `redirect_uri` of an `/authorize` flow whose `checkClient` has returned ok. Never a raw query
   * parameter, never a wildcard, never a scheme on its own: only the origin is emitted, and
   * `formActionSource` drops anything that is not one.
   */
  readonly formActionOrigins?: readonly string[];
}

export function htmlResponse(body: string, options: HtmlResponseOptions = {}): PortalResponse {
  return {
    status: options.status ?? 200,
    headers: withCookie(
      {
        ...HTML_SECURITY_HEADERS,
        "content-security-policy": contentSecurityPolicy(options.formActionOrigins),
        ...options.headers,
      },
      options.cookie,
    ),
    body,
  };
}

/**
 * A 302 back to the client's registered `redirect_uri`. `no-store` and `no-referrer` ride along,
 * because this response's `Location` carries the authorization code.
 */
export function redirectResponse(
  location: string,
  options: { readonly cookie?: string } = {},
): PortalResponse {
  return {
    status: 302,
    headers: withCookie(
      {
        location,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "content-type": "text/plain; charset=utf-8",
      },
      options.cookie,
    ),
    body: "",
  };
}

/**
 * **One `Set-Cookie` per response, by construction.**
 *
 * `PortalResponse.headers` is `Record<string, string>` (`src/server.ts`) and that file belongs to
 * another lane, so a second cookie has nowhere to go -- and silently dropping one would be the
 * kind of bug that only shows up as "sign-in sometimes forgets you". Every page here needs at most
 * one: the form pages mint a CSRF cookie, the redirect after sign-in mints the session cookie, and
 * nothing needs both at once because a CSRF cookie set on the form page is still there on the post.
 */
function withCookie(
  headers: Readonly<Record<string, string>>,
  cookie: string | undefined,
): Record<string, string> {
  return cookie === undefined ? { ...headers } : { ...headers, "set-cookie": cookie };
}
