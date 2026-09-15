/**
 * Which media URLs the renderer may auto-load into an `<img>` / `<video>`.
 *
 * Model output is untrusted. A remote http(s) URL reaching an image or video
 * element makes the renderer fetch an attacker-chosen origin with no click:
 * a tracking beacon at minimum, and inside the desktop shell a request sent
 * from the app's own network position. So only media the host serves is
 * renderable, plus small inline image data URLs of known raster types.
 * Anything else degrades to a plain link (see `safeLinkHref`).
 */
const HOST_MEDIA_PREFIXES: readonly string[] = ["/api/v1/media/", "agentforge://media/"];

/** `data:image/<png|jpeg|webp|gif>` followed by a parameter or the payload separator. */
const INLINE_IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif)[;,]/i;

/** A path the local host serves from its own media store. */
function isHostServedMediaUrl(url: string): boolean {
  return HOST_MEDIA_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export function isRenderableImageUrl(url: string): boolean {
  return isHostServedMediaUrl(url) || INLINE_IMAGE_DATA_URL.test(url);
}

export function isRenderableVideoUrl(url: string): boolean {
  return isHostServedMediaUrl(url);
}
