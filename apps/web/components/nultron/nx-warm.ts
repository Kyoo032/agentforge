import type { NxImageKind } from "@/components/nultron/nx-image-manifest";
import { type PictureWant, pictureUrls } from "@/components/nultron/nx-picture";
import type { MascotState } from "@/lib/mascot-states";

/**
 * Fetching a picture before the desk needs it. Nothing here runs on its own: a mount point says which
 * states the character can reach from where it stands, and asks for them at the moment that becomes
 * likely, so a page pays for the pictures it can show and no others.
 *
 *  - the small stills of the next likely states, when the browser is idle (`warmMascotAtIdle`);
 *  - a strip (a clip or a loop, 40 to 150 KB) only when the pointer, focus or a started job says it is
 *    about to play (`warmMascot` with `{ still: false }`).
 *
 * The images are only fetched, never decoded: a decoded strip is `frames x 320 x 320 x 4` bytes (about 5 MB
 * for a clip, 1.6 MB for a loop), and it is decoded when the strip is first painted. The `Image` objects
 * are kept, so the browser's in-memory cache keeps the encoded file and a later `<img>` with the same URL
 * does not go back to the network.
 */
const started = new Map<string, HTMLImageElement>();

/** Starts a fetch for each URL not asked for before. Returns how many it started. */
export function warmUrls(urls: readonly string[]): number {
  if (typeof Image === "undefined") {
    return 0;
  }
  let count = 0;
  for (const url of urls) {
    if (started.has(url)) {
      continue;
    }
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    started.set(url, image);
    count += 1;
  }
  return count;
}

/** Fetches the picture files of `states` as drawn at `kind` (a head has no strip). */
export function warmMascot(states: readonly MascotState[], kind: NxImageKind, want?: PictureWant): number {
  return warmUrls(states.flatMap((state) => pictureUrls(state, kind, want)));
}

/** The longest an idle warm-up waits for a quiet moment, and the delay where the browser has no idle callback. */
export const IDLE_TIMEOUT_MS = 2000;
export const IDLE_FALLBACK_MS = 250;

type IdleWindow = {
  requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/** Runs `run` when the browser is idle (or after `IDLE_TIMEOUT_MS`, or `IDLE_FALLBACK_MS` with no idle callback). Returns the cancel. */
export function whenIdle(run: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const idle = window as unknown as IdleWindow;
  if (typeof idle.requestIdleCallback === "function") {
    const id = idle.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => idle.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(run, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(id);
}

/** `warmMascot` at idle. Returns the cancel, so an effect can hand it back as its cleanup. */
export function warmMascotAtIdle(states: readonly MascotState[], kind: NxImageKind, want?: PictureWant): () => void {
  return whenIdle(() => warmMascot(states, kind, want));
}

/** Test seam: forget what was fetched, so a case starts from a page that has warmed nothing. */
export function forgetWarmed(): void {
  started.clear();
}

/** Test seam: what has been asked for. */
export function warmedUrls(): string[] {
  return [...started.keys()];
}
