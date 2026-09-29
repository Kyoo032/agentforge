"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { t } from "@/lib/i18n";

/**
 * The players and pictures of the Videos, Images and Music galleries.
 *
 * A gallery is a list that only grows, and each row used to mount its own player with no `preload`
 * and no error state. On the dev desk that was 72 `<video controls>` next to the 6 bundled examples,
 * half of whose files answered 404: 78 video elements and dozens of failing loads on one page, and a
 * blank black box for every row that could not play. Three rules, one place:
 *
 *  - A row the host says has no file (`fileMissing`), or whose file fails to load, shows a
 *    "File missing" tile. Nothing is mounted for the first case, so it costs no request at all.
 *  - A video is mounted only when it is near the viewport, and asks for nothing until it is played
 *    (`preload="none"`), except the newest few, which fetch their first frame so the top of the
 *    gallery is not a wall of black. Scrolling to a row mounts it once; it stays mounted.
 *  - An image is loaded lazily by the browser; audio waits for Play.
 */

/** How many of the newest clips fetch a first frame. Every other clip waits for Play. */
export const GALLERY_METADATA_COUNT = 4;

/** How far outside the viewport (px) a tile is still mounted, so it is ready as it scrolls in. */
const NEAR_MARGIN_PX = 300;

export function galleryPreload(index: number): "metadata" | "none" {
  return index < GALLERY_METADATA_COUNT ? "metadata" : "none";
}

/**
 * True once the element behind `ref` has been within `NEAR_MARGIN_PX` of the viewport, and true from
 * the start where there is no `IntersectionObserver` (a server render, a test): there is nothing to
 * wait for, so the media mounts. It never goes back to false, so a tile that scrolls away keeps its
 * player and its place in the clip.
 */
export function useNearViewport(): { ref: RefObject<HTMLDivElement | null>; near: boolean } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const node = ref.current;
    if (near || !node) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: `${NEAR_MARGIN_PX}px 0px` },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);

  return { ref, near };
}

/** What stands where a file that is gone would have been. The size is the player's, so the grid holds. */
export function MediaMissingTile({ className }: { className: string }) {
  return (
    <div
      className={`${className} flex flex-col items-center justify-center gap-0.5 bg-[var(--surface-2)] px-3 text-center`}
      role="img"
      aria-label={t("common.mediaMissing.title")}
      data-testid="media-missing"
    >
      <span className="text-sm font-medium text-[var(--text-2)]">{t("common.mediaMissing.title")}</span>
      <span className="text-xs text-[var(--text-3)]">{t("common.mediaMissing.hint")}</span>
    </div>
  );
}

const VIDEO_BOX = "aspect-video w-full";

export function GalleryVideo({
  src,
  missing,
  index,
}: {
  src: string;
  /** The host's `fileMissing`: nothing is mounted, so nothing is requested. */
  missing: boolean;
  /** Position in the gallery, newest first. */
  index: number;
}) {
  const { ref, near } = useNearViewport();
  const [failed, setFailed] = useState(false);

  if (missing || failed) {
    return <MediaMissingTile className={VIDEO_BOX} />;
  }
  return (
    <div ref={ref} className={`${VIDEO_BOX} bg-black`}>
      {near ? (
        <video
          src={src}
          controls
          playsInline
          preload={galleryPreload(index)}
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
          data-testid="gallery-video"
        />
      ) : null}
    </div>
  );
}

export function GalleryAudio({ src, missing }: { src: string; missing: boolean }) {
  const [failed, setFailed] = useState(false);

  if (missing || failed) {
    return <MediaMissingTile className="mt-2 h-14 w-full rounded-md" />;
  }
  // A generated song has no transcript, so there is no caption track to give it.
  return <audio src={src} controls preload="none" className="mt-2 w-full" onError={() => setFailed(true)} />;
}

export function GalleryImage({ src, alt, missing }: { src: string; alt: string; missing: boolean }) {
  const [failed, setFailed] = useState(false);

  if (missing || failed) {
    return <MediaMissingTile className="aspect-square w-full" />;
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="aspect-square w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}
