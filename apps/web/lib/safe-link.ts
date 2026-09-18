const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * The letter-digit-hyphen set a hostname may use. `url.hostname` is already lowercased and
 * punycode-encoded by the parser, so a label that cannot be written this way is not a name the
 * resolver would take: a bracketed IPv6 literal, an underscore label, or whatever a parser quirk
 * lets through.
 */
const SAFE_HOSTNAME = /^[a-z0-9.-]+$/;

/**
 * The href a rendered markdown link may carry: absolute http(s) only. Every
 * other scheme (javascript:, data:, file:, mailto:, relative paths) returns
 * null and the renderer shows the link text as plain text.
 *
 * What comes back is `url.href` — the parser's normalised spelling, not the text the model wrote.
 * The two differ more often than they look: `https:\\evil.com` is `https://evil.com/` to every
 * browser, a space becomes `%20`, and a mixed-case host folds to lowercase. Returning the raw
 * string let the markup claim one destination while the click went to another.
 *
 * A confusable that survives as valid punycode (`xn--ypal-43d9g.com` for a Cyrillic `раypal.com`)
 * is still returned: it is a real http host, and deciding whether a *valid* name looks like another
 * one is the browser's call — it has the user's locales and the address bar. What this guarantees
 * is that the href in the markup is the address the browser will actually resolve.
 */
export function safeLinkHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (!HTTP_PROTOCOLS.has(url.protocol) || !SAFE_HOSTNAME.test(url.hostname)) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
