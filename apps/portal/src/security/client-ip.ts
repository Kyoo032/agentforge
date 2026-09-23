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
 * **One trusted hop: the RIGHT-most entry, and only that one.** The header is a chain, and the
 * client writes its start. The proxy in front (Caddy, `webapp-deploy/Caddyfile`) either replaces
 * the header with the peer it saw, or appends that peer to whatever the client sent. Either way,
 * the last entry is the only one this deployment's own proxy wrote. Reading the left-most entry, as
 * this used to, let a caller pick a fresh rate-limit bucket per request by rotating a forged
 * prefix, or pick somebody else's bucket to exhaust. When the last entry is not an address
 * (a proxy that writes `ip:port`, say), the answer is the socket peer, **never** an entry further
 * left: those are the client's. The host keys its own limiter the same way
 * (`packages/host/src/rate-limit.ts`, `clientIp`). A second appending proxy in front of the first
 * moves the client one hop left, so this rule changes whenever the proxy chain does.
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
    // Repeated header lines are one chain in order; node joins them with ", " itself.
    const raw = Array.isArray(header) ? header.join(",") : header;
    // The last entry is the one the proxy in front wrote. Nothing to its left is trusted.
    const lastHop = raw?.split(",").at(-1);
    const forwarded = lastHop ? normalise(lastHop) : null;
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
