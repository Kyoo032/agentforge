function hostnameOf(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`http://${trimmed}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}

/** True when the host is this machine's loopback name. */
export function isLocalRequestHost(host: string | null | undefined): boolean {
  if (!host) {
    return false;
  }
  const hostname = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/** True when Origin or Referer points at localhost / 127.0.0.1. */
export function isLocalRequestUrl(originOrReferer: string | null | undefined): boolean {
  if (!originOrReferer) {
    return false;
  }
  return isLocalRequestHost(hostnameOf(originOrReferer));
}

/** Loopback names a Host header may carry; anything else names a different machine. */
const LOOPBACK_HOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/** Strips the optional `:port` from a Host header value, or returns null when it is not a host[:port]. */
function hostNameOfHeader(value: string): string | null {
  if (value.startsWith("[")) {
    const bracketed = value.match(/^\[([0-9a-f:.]+)\](?::\d{1,5})?$/);
    return bracketed ? bracketed[1] : null;
  }
  const named = value.match(/^([^:]+)(?::\d{1,5})?$/);
  if (named) {
    return named[1];
  }
  // A bare IPv6 literal carries no port, so the remaining colons are part of the address itself.
  return /^[0-9a-f:.]+$/.test(value) ? value : null;
}

/**
 * True when the Host header names this machine's loopback interface, with or without a port.
 *
 * A MISSING Host is rejected, unlike a missing Origin. Origin is genuinely absent from plenty of
 * honest local clients (curl, native tooling, same-origin GETs), so its absence carries no signal.
 * Host is different: HTTP/1.1 makes it mandatory, and every real client on loopback — browsers,
 * curl, fetch, Node's own http.request — sends it. So a missing Host is a malformed request rather
 * than a hint of trusted local tooling, and trusting it would hand an attacker a one-header bypass
 * of this check. Rejecting it costs no legitimate caller anything.
 */
export function isLoopbackHostHeader(host: string | null | undefined): boolean {
  const value = host?.trim().toLowerCase();
  if (!value) {
    return false;
  }
  const hostname = hostNameOfHeader(value);
  return hostname !== null && LOOPBACK_HOST_NAMES.has(hostname);
}

/**
 * Mutating /api calls: missing Origin is treated as same-machine (curl, native).
 * When Origin is present, its host must be localhost or 127.0.0.1.
 * A remote Origin is never allowed, even if Referer is local.
 */
export function isAllowedMutatingApiRequest(
  origin: string | null | undefined,
  _referer?: string | null | undefined,
): boolean {
  const source = origin?.trim();
  if (!source) {
    return true;
  }
  return isLocalRequestUrl(source);
}
