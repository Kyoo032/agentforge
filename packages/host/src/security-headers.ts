/**
 * The response headers the hosted deployment must carry, set by the APP rather than only by the
 * proxy (docs/internal/security-owasp-2026-09.md, finding A05-3).
 *
 * WHY THIS EXISTS. Every one of these already lives in `webapp-deploy/Caddyfile`, and that file is
 * good. The problem is that it is the only copy: the app itself sent `X-Content-Type-Options` and
 * nothing else, so any deployment not fronted by exactly that Caddyfile — a different proxy, a
 * staging box, a Kubernetes ingress, a future CDN — served the whole SPA with no CSP and no framing
 * protection, and nothing in the repo would have noticed. A control that depends on one file in one
 * folder being copied correctly is not a control.
 *
 * DUPLICATION IS THE POINT, AND IT IS SAFE. Caddy's `header` directive REPLACES a header rather than
 * appending to it, so on the real deployment the proxy's value wins and nothing is sent twice. Here
 * the app is the floor and the proxy is the ceiling. To stop the two drifting apart,
 * `security-headers.test.ts` reads the Caddyfile and fails if the two policies stop agreeing.
 *
 * SERVER MODE ONLY. Webdev serves Vite's own inline module preloads and the desktop shell loads from
 * a custom protocol; a CSP written for the built bundle would break both. Off server mode this file
 * does nothing at all, which is why the desktop and webdev behave exactly as they did.
 */

/**
 * Content-Security-Policy, kept identical to the Caddyfile's.
 *
 * `script-src 'self'` with no hash and no `'unsafe-inline'`: the built `apps/web/dist/index.html`
 * loads one external module bundle and one external stylesheet. `style-src` keeps `'unsafe-inline'`
 * because component libraries inject `<style>` elements at runtime — scripts are the half this rule
 * exists for. `img-src data:` is for the inline `data:image/(png|jpeg|webp|gif)` that
 * `apps/web/lib/renderable-media.ts` allows (`svg+xml` is rejected there and stays blocked).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.tokotokenai.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

/** One year, every subdomain, no `preload` — the same call the Caddyfile documents. */
export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

/** Every powerful feature off; the app asks for none of them. */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "geolocation=()",
  "gyroscope=()",
  "interest-cohort=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "serial=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

/**
 * The whole set. `X-Content-Type-Options` is deliberately here as well as on each individual result
 * writer: a response that takes a path through the adapter nobody thought about still gets it.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Strict-Transport-Security": STRICT_TRANSPORT_SECURITY,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": PERMISSIONS_POLICY,
};

/** Minimal shape of what these are written onto, so this module needs no `node:http` import. */
export type HeaderSink = { setHeader(name: string, value: string): unknown };

/**
 * Writes the set, in server mode only.
 *
 * Called early, before a handler's own headers, so a route that needs something stricter still
 * wins: `handlers/artifacts.ts` replaces the policy with `Content-Security-Policy: sandbox` on an
 * artifact body, and `writeHostResult` applies a result's own headers after these.
 */
export function applySecurityHeaders(res: HeaderSink, serverMode: boolean): void {
  if (!serverMode) {
    return;
  }
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
}
