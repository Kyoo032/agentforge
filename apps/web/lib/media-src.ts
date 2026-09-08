/**
 * Host media paths that the packaged renderer must load through the agentforge:// scheme
 * (its window is a file:// page; relative /api paths have nowhere to go). Each entry maps a
 * host route to the protocol hostname the desktop shell registers for it (apps/desktop/main.cjs).
 */
const DESKTOP_MEDIA_ROUTES: ReadonlyArray<{ pattern: RegExp; host: string }> = [
  { pattern: /\/api\/v1\/media\/([^/?#]+)\/file/, host: "media" },
  { pattern: /\/api\/v1\/videos\/examples\/([^/?#]+)\/file/, host: "video-example" },
];

/** The URL a `<video>` / `<img>` should use for a host media path, in the browser or in the desktop shell. */
export function desktopMediaSrc(url: string, electron: boolean): string {
  if (!electron) {
    return url;
  }
  for (const route of DESKTOP_MEDIA_ROUTES) {
    const match = url.match(route.pattern);
    if (match?.[1]) {
      return `agentforge://${route.host}/${match[1]}`;
    }
  }
  return url;
}
