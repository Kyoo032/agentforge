const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * The href a rendered markdown link may carry: absolute http(s) only. Every
 * other scheme (javascript:, data:, file:, mailto:, relative paths) returns
 * null and the renderer shows the link text as plain text.
 */
export function safeLinkHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return HTTP_PROTOCOLS.has(url.protocol) && url.hostname ? trimmed : null;
  } catch {
    return null;
  }
}
