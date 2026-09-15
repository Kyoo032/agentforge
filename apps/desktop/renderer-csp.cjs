/**
 * The packaged renderer's Content-Security-Policy, and the one place it is written down.
 *
 * It is enforced twice, because neither half covers the other:
 *
 * - a `<meta http-equiv="Content-Security-Policy">` baked into `resources/renderer/index.html` at
 *   pack time by `scripts/stage-renderer.mjs`. This is what actually governs the packaged window:
 *   the renderer is a `file://` document and Electron's `webRequest` does not observe Chromium's
 *   file loader, so a response header never reaches it.
 * - a response header from `installContentSecurityPolicy()` in `main.cjs`, which covers everything
 *   else the packaged session serves (`agentforge://` responses among them) and would carry the
 *   policy if the renderer were ever moved off `file://`.
 *
 * The policy itself is "this bundle, and nothing else". The packaged renderer loads a local Vite
 * build plus the `agentforge://` media scheme and never talks to the network itself — the host does
 * that from the main process over IPC — so every remote origin is refused outright.
 *
 * Why each relaxation exists, so none of them is widened by accident:
 * - `style-src 'unsafe-inline'`: the UI sets inline `style` attributes (progress widths, measured
 *   layout) that CSP counts as inline styles. `script-src` gets no such allowance, which is the half
 *   that turns an injection through model-authored markdown into a no-op.
 * - `img-src data:`: the preload hands the brand logo to the renderer as a data URI.
 * - `img-src`/`media-src blob:`: the editor and the media studios build object URLs over generated
 *   bytes before anything is saved.
 * - `agentforge:`: gallery media and the bundled example clips, served by `registerMediaProtocol()`.
 *
 * This is deliberately NOT in `apps/web/index.html`. Webdev serves that file through Vite, which
 * injects an inline module preamble for React Fast Refresh, eval's inside its HMR client and opens a
 * websocket back to the dev server — none of which survive `script-src 'self'` / `connect-src 'self'`.
 * A meta tag there would break `pnpm dev` while adding nothing to the build that ships.
 */
const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: agentforge:",
  "media-src 'self' blob: agentforge:",
  "connect-src 'self' agentforge:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Matches an existing CSP meta tag, so re-staging a renderer replaces the policy instead of stacking it. */
const CSP_META = /[ \t]*<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>\r?\n?/gi;

/**
 * Return `html` with the policy as the first thing in `<head>`.
 *
 * First in `<head>` on purpose: a meta policy only governs what the parser meets after it, so a
 * script tag above it would already have run. Pure, so the pack step's one job — "the shipped
 * index.html carries this policy" — is checkable without building anything.
 *
 * @param {string} html
 * @param {string} [csp]
 * @returns {string}
 * @throws {Error} when there is no `<head>` to inject into; a renderer without one is not shippable.
 */
function injectCspMeta(html, csp = RENDERER_CSP) {
  const source = String(html).replace(CSP_META, "");
  const head = /<head(\s[^>]*)?>/i.exec(source);
  if (!head) {
    throw new Error("renderer index.html has no <head> to carry the Content-Security-Policy");
  }
  const at = head.index + head[0].length;
  const tag = `\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`;
  return `${source.slice(0, at)}${tag}${source.slice(at)}`;
}

module.exports = {
  RENDERER_CSP,
  injectCspMeta,
};
