/**
 * The Videos, Images and Music galleries: what a row mounts, and what a row with no file shows.
 *
 * Measured on the dev desk, 2026-09-29: Videos opened 78 `<video controls>` (72 gallery rows and 6
 * bundled examples) with no `preload` and no error state, and 36 of the gallery rows answered 404 on
 * their file, so the page held dozens of failing loads and a black box for each. `renderToStaticMarkup`
 * runs no effects, so what it returns is the first frame: enough to say what is mounted, and with
 * what. That a failed load swaps in the tile is the `onError` wiring, held here by source.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GALLERY_METADATA_COUNT,
  GalleryAudio,
  GalleryImage,
  GalleryVideo,
  MediaMissingTile,
  galleryPreload,
} from "@/components/gallery-media";
import { applyLocale, resetLocaleForTests, t } from "./i18n";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (file: string) => readFileSync(join(web, file), "utf8");

afterEach(() => {
  resetLocaleForTests();
  vi.unstubAllGlobals();
});

describe("a gallery video", () => {
  it("does not load anything until Play, except the newest few", () => {
    const first = renderToStaticMarkup(<GalleryVideo src="/v/1" missing={false} index={0} />);
    expect(first).toContain("<video");
    expect(first).toContain('preload="metadata"');
    const later = renderToStaticMarkup(<GalleryVideo src="/v/9" missing={false} index={GALLERY_METADATA_COUNT} />);
    expect(later).toContain('preload="none"');
    expect(later).not.toContain('preload="metadata"');
    expect(galleryPreload(GALLERY_METADATA_COUNT - 1)).toBe("metadata");
    expect(galleryPreload(GALLERY_METADATA_COUNT)).toBe("none");
    expect(galleryPreload(71)).toBe("none");
  });

  it("mounts no player for a row the host says has no file, so it asks for nothing", () => {
    const html = renderToStaticMarkup(<GalleryVideo src="/api/v1/media/x/file" missing index={0} />);
    expect(html).not.toContain("<video");
    expect(html).not.toContain("/api/v1/media/x/file");
    expect(html).toContain('data-testid="media-missing"');
    expect(html).toContain("aspect-video");
  });

  it("waits to mount a player until the tile is near the viewport where the browser can say so", () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const html = renderToStaticMarkup(<GalleryVideo src="/v/40" missing={false} index={40} />);
    expect(html).not.toContain("<video");
    // The box keeps its size, so the grid does not jump when the player arrives.
    expect(html).toContain("aspect-video");
  });

  it("has an error state for a file that fails to load after all", () => {
    const code = source("components/gallery-media.tsx");
    expect(code).toMatch(/<video[\s\S]*?onError=\{\(\) => setFailed\(true\)\}/);
    expect(code).toMatch(/<audio[^>]*onError=\{\(\) => setFailed\(true\)\}/);
    expect(code).toMatch(/<img[\s\S]*?onError=\{\(\) => setFailed\(true\)\}/);
  });
});

describe("a gallery picture and a gallery song", () => {
  it("loads a picture lazily and a song only on Play", () => {
    const image = renderToStaticMarkup(<GalleryImage src="/i/1" alt="a fox" missing={false} />);
    expect(image).toContain('loading="lazy"');
    expect(image).toContain('decoding="async"');
    const song = renderToStaticMarkup(<GalleryAudio src="/a/1" missing={false} />);
    expect(song).toContain('preload="none"');
  });

  it("shows the missing tile instead of a broken image or an unplayable song", () => {
    const image = renderToStaticMarkup(<GalleryImage src="/i/1" alt="a fox" missing />);
    expect(image).not.toContain("<img");
    expect(image).toContain('data-testid="media-missing"');
    const song = renderToStaticMarkup(<GalleryAudio src="/a/1" missing />);
    expect(song).not.toContain("<audio");
    expect(song).toContain('data-testid="media-missing"');
  });
});

describe("the missing tile's words", () => {
  it.each(["en", "id"] as const)("is in the catalogue and rendered in %s", (locale) => {
    applyLocale(locale);
    const html = renderToStaticMarkup(<MediaMissingTile className="aspect-video w-full" />);
    expect(t("common.mediaMissing.title")).not.toBe("common.mediaMissing.title");
    expect(t("common.mediaMissing.hint")).not.toBe("common.mediaMissing.hint");
    expect(html).toContain(t("common.mediaMissing.title"));
    expect(html).toContain(t("common.mediaMissing.hint"));
  });

  it("differs between English and Indonesian", () => {
    applyLocale("en");
    const en = t("common.mediaMissing.title");
    applyLocale("id");
    expect(t("common.mediaMissing.title")).not.toBe(en);
  });
});

describe("the galleries use them", () => {
  it("Videos mounts no bare <video> per row and passes the host's fileMissing", () => {
    const code = source("components/videos-studio.tsx");
    expect(code).not.toContain("<video");
    expect(code).toContain("<GalleryVideo");
    expect(code).toContain("missing={item.fileMissing === true}");
  });

  it("Images and Music go through the same tiles", () => {
    const images = source("components/images-studio.tsx");
    expect(images).not.toContain("<img");
    expect(images).toContain("<GalleryImage");
    const music = source("components/music-studio.tsx");
    expect(music).not.toContain("<audio");
    expect(music).toContain("<GalleryAudio");
  });
});
