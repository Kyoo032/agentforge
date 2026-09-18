/**
 * "Is this bundle being served by the hosted deployment?"
 *
 * The renderer cannot ask `process.env`, and it must not guess from the hostname: a desk, the
 * webdev on :3000 and the hosted service all load the same bundle over http. So the server says so
 * itself — `apps/web/server.ts` stamps one marker into the `index.html` it serves when
 * `isServerMode()` — and this module is the only place that reads it.
 *
 * The marker is a capability statement from the server, never a permission: it can only make a
 * decision *stricter* (see `resolveGate`). A desk page that forges it locks itself out of its own
 * app, which is nobody's attack.
 */

/** `name` of the marker meta tag. */
export const HOSTED_MARKER_ATTRIBUTE = "agentforge-server";

/** The selector `isHostedBuild` looks for. */
export const HOSTED_MARKER_META = `meta[name="${HOSTED_MARKER_ATTRIBUTE}"]`;

/** Exactly what the server injects. One line, no surrounding whitespace, so injection is reversible. */
export const HOSTED_MARKER_TAG = `<meta name="${HOSTED_MARKER_ATTRIBUTE}" content="1" />`;

/** Global fallback for a bundle served without an `index.html` of ours (a native shell, a test). */
export const HOSTED_MARKER_GLOBAL = "__AGENTFORGE_SERVER__";

/** The only bit of the DOM this module touches, so a test can hand over a two-field stand-in. */
export type HostedScope = {
  readonly document?: { querySelector(selector: string): { getAttribute(name: string): string | null } | null };
  readonly __AGENTFORGE_SERVER__?: unknown;
};

const TRUE_WORDS: ReadonlySet<string> = new Set(["1", "true", "yes"]);

/** Same truthiness everywhere: a boolean as-is, a string by word, anything else false. */
function isTrue(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return typeof value === "string" && TRUE_WORDS.has(value.trim().toLowerCase());
}

function markerContent(scope: HostedScope): string | null {
  try {
    return scope.document?.querySelector(HOSTED_MARKER_META)?.getAttribute("content") ?? null;
  } catch {
    // A detached or exotic document is not a hosted page; never let this throw into a render.
    return null;
  }
}

/**
 * True only on the bundle the hosted server served. False on the packaged desktop, on webdev, and
 * in any test that does not say otherwise — which is what keeps the desk behaviour unchanged.
 */
export function isHostedBuild(scope: HostedScope = globalThis as HostedScope): boolean {
  return isTrue(markerContent(scope)) || isTrue(scope.__AGENTFORGE_SERVER__);
}

const HEAD_CLOSE = /<\/head\s*>/i;

/**
 * `index.html` → the same html with the hosted marker in its head, or untouched when `hosted` is
 * false. Pure on purpose: `server.ts` cannot be unit-tested, this can.
 */
export function injectHostedMarker(html: string, hosted: boolean): string {
  if (!hosted || html.includes(`name="${HOSTED_MARKER_ATTRIBUTE}"`)) {
    return html;
  }
  const head = HEAD_CLOSE.exec(html);
  if (!head) {
    // No head to stamp (a fragment, a hand-written shell): the front of the document still reaches
    // the parser before any script that could read the marker.
    return `${HOSTED_MARKER_TAG}${html}`;
  }
  return `${html.slice(0, head.index)}${HOSTED_MARKER_TAG}${html.slice(head.index)}`;
}
