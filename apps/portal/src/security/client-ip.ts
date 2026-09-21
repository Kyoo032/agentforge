/**
 * Which address a request came from, and when the portal is allowed to believe the header.
 *
 * `X-Forwarded-For` is trusted **only** when `PORTAL_TRUST_PROXY=1` is set. Without that flag it
 * is ignored entirely, because every rate-limit bucket in `src/security/rate-limit.ts` is keyed on
 * this value and a header anyone can send is a header anyone can use to evade one -- or to exhaust
 * someone else's window.
 *
 * The flag itself is read and validated by `loadConfig` and arrives here as `trustProxy` on the
 * runtime (SR-33). This module reads no environment of its own: a typo in the variable used to
 * mean "off", silently, and now it is a boot error.
 *
 * The value also reaches `audit_log.ip` and `device_codes.created_ip`, which are `inet` columns, so
 * anything that is not an address becomes `null` rather than a failed INSERT.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** `::ffff:127.0.0.1` is the same address as `127.0.0.1`, and `inet` prefers the short form. */
function normalise(value: string): string | null {
  const trimmed = value.trim().replace(/^\[|\]$/g, "");
  if (trimmed === "") {
    return null;
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  const candidate = mapped ? mapped[1] : trimmed;

  const v4 = IPV4.exec(candidate);
  if (v4) {
    return v4.slice(1).every((octet) => Number(octet) <= 255) ? candidate : null;
  }
  // A conservative IPv6 shape: hex groups and colons only. `inet` rejects anything else anyway,
  // but a `null` here is a missing audit field rather than a 500 on the login path.
  return /^[0-9a-f:]+$/i.test(candidate) && candidate.includes(":") ? candidate : null;
}

export interface ClientIpInput {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** `request.ip` from `src/server.ts` -- the socket's own peer address. */
  readonly socketIp: string | null;
  readonly trustProxy: boolean;
}

export function clientIp(input: ClientIpInput): string | null {
  if (input.trustProxy) {
    const header = input.headers["x-forwarded-for"];
    const raw = Array.isArray(header) ? header[0] : header;
    // Left-most is the original client; the rest are proxies that appended themselves.
    const first = raw?.split(",")[0];
    const forwarded = first ? normalise(first) : null;
    if (forwarded) {
      return forwarded;
    }
  }
  return input.socketIp ? normalise(input.socketIp) : null;
}

/** A stable bucket key: the address when there is one, a single shared bucket when there is not. */
export function rateLimitKey(ip: string | null): string {
  return ip ?? "unknown-ip";
}
