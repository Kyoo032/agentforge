/**
 * Cookie names, attributes, and the one decision the `__Host-` prefix forces on us.
 *
 * A browser accepts a `__Host-` cookie only when it is `Secure`, `Path=/` and carries no `Domain`,
 * and the prefix is what stops a sibling origin writing the portal's session id into the browser.
 * It is also impossible over plain http, which is exactly how the review instance runs
 * (`127.0.0.1:4000`, no TLS) -- a `__Host-` cookie set there is silently dropped and sign-in
 * appears to work while never remembering anyone.
 *
 * So the rule, and it is deliberately narrow: **the unprefixed name is used only when the process
 * is not in production, is bound to loopback, AND is not published over https.** Anything else --
 * production, a development process listening on a real interface, or one behind a proxy that
 * terminates TLS -- gets the prefixed, `Secure` name and fails loudly over plain http rather than
 * quietly weakening the cookie. The same split `packages/host/src/auth/session.ts` already makes
 * for the product's own session cookie.
 */

export interface CookieMode {
  readonly production: boolean;
  /** `PORTAL_HOST` -- what the server is bound to, not the `Host` header a client sent. */
  readonly host: string;
  /**
   * `PORTAL_PUBLIC_URL` -- what a BROWSER reaches this portal on, which behind a proxy is not the
   * bind address at all. See `cookiesAreSecure`. Absent means nothing is in front, so the bind
   * address is also the public one.
   */
  readonly publicUrl?: string;
}

export interface CookieNames {
  readonly session: string;
  readonly csrf: string;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["::1", "localhost", "[::1]"]);
/** The whole 127.0.0.0/8 block, not just `.1` — `127.0.0.53` is a loopback resolver, not a peer. */
const LOOPBACK_V4 = /^127\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/;

export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(value)) {
    return true;
  }
  return LOOPBACK_V4.test(value) && value.split(".").every((octet) => Number(octet) <= 255);
}

/** True when the public URL says a browser reaches this portal over TLS. */
function publishedOverHttps(publicUrl: string | undefined): boolean {
  const value = publicUrl?.trim();
  if (!value) {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    // An unparseable value is not a claim about TLS. `config.ts` is where a bad one is reported.
    return false;
  }
}

/**
 * True when the cookies must be `Secure`, which is also when they carry the `__Host-` prefix.
 *
 * The third clause is the one the bind address cannot answer. A portal published through a proxy
 * that terminates TLS -- cloudflared in front of the review instance is the first of them -- is
 * still bound to `127.0.0.1`, so the loopback test alone said "development, plain http" while the
 * browser was on `https://<name>` and holding a thirty-day session cookie with no `Secure` and no
 * prefix. Any plain-http request to that public name would have carried it in the clear, and
 * without the prefix a sibling host could write it, which is exactly the session fixation the
 * prefix exists to stop.
 *
 * `PORTAL_PUBLIC_URL` is the right fact to read because a deployment behind a proxy already has to
 * set it -- the access token's `iss` is built from it, and a token minted with the wrong issuer
 * verifies nowhere -- so the two cannot drift apart without the deployment being broken anyway.
 */
export function cookiesAreSecure(mode: CookieMode): boolean {
  return mode.production || !isLoopbackHost(mode.host) || publishedOverHttps(mode.publicUrl);
}

export function cookieNames(mode: CookieMode): CookieNames {
  return cookiesAreSecure(mode)
    ? Object.freeze({ session: "__Host-portal_session", csrf: "__Host-portal_csrf" })
    : Object.freeze({ session: "portal_session", csrf: "portal_csrf" });
}

/** Only what this app sets. A value with an `=` in it (base64url has none) keeps its tail. */
export function parseCookies(header: string | string[] | undefined): Readonly<Record<string, string>> {
  const raw = Array.isArray(header) ? header.join("; ") : (header ?? "");
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    if (name !== "") {
      out[name] = part.slice(separator + 1).trim();
    }
  }
  return Object.freeze(out);
}

export interface CookieAttributes {
  readonly maxAgeSeconds?: number;
  readonly secure: boolean;
  /**
   * `Lax`, not `Strict`: the browser arrives at `/authorize` by a top-level navigation from the
   * product's own origin, and `Strict` would withhold the session cookie on exactly that hop --
   * which is the hop the 30-day cookie exists to serve.
   */
  readonly sameSite?: "Lax" | "Strict";
}

export function serialiseCookie(name: string, value: string, attributes: CookieAttributes): string {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", `SameSite=${attributes.sameSite ?? "Lax"}`];
  if (attributes.secure) {
    parts.push("Secure");
  }
  if (attributes.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(attributes.maxAgeSeconds))}`);
  }
  return parts.join("; ");
}

/** An expiry in the past with an empty value: the only reliable way to delete one. */
export function clearCookie(name: string, secure: boolean): string {
  return serialiseCookie(name, "", { secure, maxAgeSeconds: 0 });
}
