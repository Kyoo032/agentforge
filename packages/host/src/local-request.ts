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
