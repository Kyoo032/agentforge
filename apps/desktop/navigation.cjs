/**
 * The renderer trust boundary: where the renderer may take the window, which frame may speak to the
 * main process, and which renderer-supplied names the shell will act on.
 *
 * Pure so the rule is testable without Electron. `main.cjs` wires it into two Chromium hooks on the
 * main window: `setWindowOpenHandler` (a `target="_blank"` link or `window.open`) and `will-navigate`
 * (a top-level navigation). Both deny by default; the app has exactly one renderer document:
 *
 * - packaged: `file://…/resources/renderer/index.html` (HashRouter, so in-app routing never reaches
 *   `will-navigate` at all — only a real document load does),
 * - webdev: `http://127.0.0.1:3000`.
 *
 * Anything else is either a model-authored link (open it in the user's browser, never a second app
 * window with Node-less-but-still-privileged chrome) or something we simply refuse.
 *
 * See apps/desktop/platform/README.md, row "External links & navigation".
 */

const path = require("node:path");

/** @typedef {"allow" | "external" | "block"} NavigationDecision */
/** @typedef {{ kind: "file", href: string } | { kind: "origin", href: string }} RendererOrigin */

/**
 * Describe the one document the window may hold.
 * @param {{ packaged: boolean, rendererIndex?: string, webdevUrl?: string }} input
 * @returns {RendererOrigin}
 */
function rendererOrigin({ packaged, rendererIndex, webdevUrl }) {
  if (packaged) {
    return { kind: "file", href: fileHref(rendererIndex ?? "") };
  }
  return { kind: "origin", href: originOf(webdevUrl ?? "") };
}

/** Absolute path → a comparable `file:///…` href, lower-cased because Windows paths are case-insensitive. */
function fileHref(absolutePath) {
  const normalized = String(absolutePath).replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }
  const withSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  try {
    return new URL(`file://${encodeURI(withSlash)}`).href.toLowerCase();
  } catch {
    return "";
  }
}

function originOf(value) {
  try {
    return new URL(String(value)).origin;
  } catch {
    return "";
  }
}

/**
 * What to do with a url the renderer wants to open or navigate to.
 *
 * - `"allow"`: the renderer's own document (a reload, or the dev server's own routes).
 * - `"external"`: an `http(s)` address somewhere else — `shell.openExternal`, never a BrowserWindow.
 * - `"block"`: everything else, including `file://` outside the renderer, `agentforge://` (media is
 *   fetched by `<img>`/`<video>`, it is never a navigation) and any exotic scheme.
 *
 * @param {string} url
 * @param {RendererOrigin} origin
 * @returns {NavigationDecision}
 */
function navigationDecision(url, origin) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return "block";
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    if (origin?.kind === "origin" && origin.href && parsed.origin === origin.href) {
      return "allow";
    }
    return "external";
  }
  if (parsed.protocol === "file:") {
    if (origin?.kind !== "file" || !origin.href) {
      return "block";
    }
    // Drop `?query` and `#hash`: HashRouter routes are the same document.
    const href = `file://${parsed.pathname}`.toLowerCase();
    return href === origin.href ? "allow" : "block";
  }
  return "block";
}

/**
 * Whether an `ipcMain` event came from the one document this shell controls.
 *
 * Every channel the preload exposes is privileged — it dispatches into the host, writes a file the
 * user picked, or restarts the process — and `ipcMain` does not care which frame called. A subframe
 * (an `<iframe>` a model-authored document slipped in), a devtools page, or anything a navigation
 * dropped into the window would otherwise reach the same handlers as the app itself.
 *
 * Deny by default: a missing event, a window that is gone, or a `senderFrame` that has already been
 * torn down (reading it throws once the frame is disposed) all answer false.
 *
 * @param {{ senderFrame?: unknown }} event
 * @param {{ isDestroyed?: () => boolean, webContents?: { mainFrame?: unknown } } | null | undefined} window
 * @returns {boolean}
 */
function isTrustedSender(event, window) {
  if (!event || !window || typeof window.isDestroyed !== "function" || window.isDestroyed()) {
    return false;
  }
  try {
    const mainFrame = window.webContents?.mainFrame;
    return Boolean(mainFrame) && event.senderFrame === mainFrame;
  } catch {
    // senderFrame throws once the calling frame is disposed; a dead frame is never trusted.
    return false;
  }
}

/** Control characters are never part of a name; spelled as code points because a regex class of them is not lintable. */
function hasControlCharacter(value) {
  return [...value].some((character) => character.charCodeAt(0) < 0x20);
}

/** Devices and legacy DOS names Windows still resolves anywhere on disk, with or without a suffix. */
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/**
 * The bare filename `host:save-bytes` may pre-fill into the Save dialog, or null when the renderer
 * handed us something that is not a filename at all.
 *
 * The renderer only ever proposes a *default* here — the user still picks the real path — but the
 * proposal is attacker-shaped input (a model names its own downloads), and a default path is the one
 * part of a save dialog people accept without reading. `..\..\Startup\run.exe` must never be the
 * name sitting in the box.
 *
 * `path.win32.basename` rather than `path.basename`, deliberately: the POSIX parser leaves a
 * backslash alone, so `..\..\Startup\run.exe` would come back whole on a Linux CI runner and
 * behave differently from the Windows build it is meant to describe. The win32 parser splits on both
 * separators, so the answer is the same everywhere; the explicit separator check below is the
 * backstop that keeps this a rule rather than a trust in one parser.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function safeSaveFilename(value) {
  if (typeof value !== "string") {
    return null;
  }
  const base = path.win32.basename(value).trim();
  if (!base || base === "." || base === "..") {
    return null;
  }
  if (base.includes("/") || base.includes("\\")) {
    return null;
  }
  // ":" is a drive-relative prefix and an NTFS alternate-data-stream separator.
  if (base.includes(":") || hasControlCharacter(base)) {
    return null;
  }
  if (WINDOWS_RESERVED_NAMES.test(base)) {
    return null;
  }
  return base;
}

/**
 * Whether a key lifted out of an `agentforge://` URL may be templated into a host route.
 *
 * The hostname picks the route (`media`, `video-example`) and the path is the only free part, so it
 * is the only place a `../` or a query string could bend `/api/v1/media/<key>/file` into another
 * endpoint. Real keys are `crypto.randomUUID()` media ids and bundled clip names like
 * `daisy-macro.mp4`, both of which fit comfortably.
 *
 * @param {string} key
 * @returns {boolean}
 */
function isMediaProtocolKey(key) {
  return typeof key === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(key) && key !== "." && key !== "..";
}

module.exports = {
  rendererOrigin,
  navigationDecision,
  isTrustedSender,
  safeSaveFilename,
  isMediaProtocolKey,
};
