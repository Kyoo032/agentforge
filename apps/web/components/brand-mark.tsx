import mark24 from "@/components/brand-art/mark-24.png";
import mark32 from "@/components/brand-art/mark-32.png";
import mark48 from "@/components/brand-art/mark-48.png";
import mark64 from "@/components/brand-art/mark-64.png";

/**
 * The Nultron mark: Rizky's logo tile, edge to edge with transparent corners.
 *
 * Two sizes, each with a 2x file. 24 and 32 are size-tuned by the brand kit (a tighter crop so the
 * face still reads that small); 48 and 64 are the same tile for high-density screens. The files
 * are imported rather than served from `public/` so the bundler puts a hash in the name and the
 * URL resolves in the packaged desktop, where the renderer is a `file://` document and an absolute
 * `/brand/...` path would point at the root of the disk.
 *
 * A brand flavor that ships its own logo does not come through here: the callers draw `logoSrc`
 * for it (`usesBundledMark` in `lib/product-brand.tsx` decides).
 */
export const MARK_SIZES = [24, 32] as const;
export type MarkSize = (typeof MARK_SIZES)[number];

export const MARK_FILES: Readonly<Record<MarkSize, { src: string; srcSet: string }>> = Object.freeze({
  24: { src: mark24, srcSet: `${mark24} 1x, ${mark48} 2x` },
  32: { src: mark32, srcSet: `${mark32} 1x, ${mark64} 2x` },
});

type Props = {
  size?: MarkSize;
  className?: string;
  testId?: string;
  /** The product name when nothing beside the mark says it; empty (decorative) when something does. */
  alt?: string;
};

export function BrandMark({ size = 24, className, testId, alt = "" }: Props) {
  const file = MARK_FILES[size];
  return (
    <img
      src={file.src}
      srcSet={file.srcSet}
      width={size}
      height={size}
      alt={alt}
      decoding="async"
      draggable={false}
      className={className}
      data-testid={testId}
    />
  );
}
