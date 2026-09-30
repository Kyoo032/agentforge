/**
 * Resolves a file under `images/` to the URL the build serves it from. `import.meta.glob` (not a string
 * path such as `/nultron/...`) is what keeps this right under the desktop shell, which loads the
 * renderer as a `file://` document where an absolute path points at the disk's root, and on the hosted
 * app with its absolute base. It also puts a content hash in the file name, so a replaced render is
 * never served stale.
 */
const urls = import.meta.glob("./images/**/*.{png,webp}", { eager: true, query: "?url", import: "default" }) as Record<
  string,
  string
>;

export function imageUrl(path: string | undefined): string | undefined {
  return path === undefined ? undefined : urls[`./images/${path}`];
}

/** Every file that is actually present, relative to `images/`. */
export function presentImages(): string[] {
  return Object.keys(urls).map((key) => key.replace("./images/", ""));
}
