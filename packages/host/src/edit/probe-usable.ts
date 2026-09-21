/**
 * Is what ffprobe said about this file good enough to build a timeline from? (SR-27)
 *
 * WHY THIS EXISTS. `ffprobe` exits **0** on a file it could not really read: hand it four kilobytes
 * of rubbish named `clip.png` and it reports a video stream with `width: 0, height: 0` and no
 * duration, and says nothing on stderr. `probe()` faithfully passes those zeros along, the Edit
 * document's `assetSchema` refuses them (`width` is `z.number().int().positive()`), and the refusal
 * surfaces as `invalid_op` — from `appendOps`, which runs AFTER the bytes have been charged against
 * the tenant's storage ceiling and AFTER the object has been written. The tenant paid for an import
 * that failed, the stored object was orphaned, and the answer named the wrong thing.
 *
 * "ffprobe exited 0" is therefore not the question. The question is whether the numbers it gave
 * back describe media this app can place, and that is what this module answers — before the asset
 * is built, in time for the import route's existing `unsupported_media` refund path.
 *
 * Two families, because the requirement differs:
 *
 * - **Visual** (`image`, `video`) need positive pixel dimensions. An asset with none cannot be laid
 *   out, scaled or rendered, and the schema will refuse it a few lines later anyway.
 * - **Timed** (`video`, `audio`) need a positive duration. Without one the clip is one frame long:
 *   `importedClipDurationFrames` falls back to `1/30` of a second, which is not a meeting recording
 *   or a music bed, it is a mistake the owner only finds on the timeline.
 *
 * A still image is not timed, so its missing duration is ordinary and says nothing.
 */

import type { ProbeResult } from "./ffmpeg/recipes";

export type ImportKind = "image" | "video" | "audio";

/** Kinds that occupy pixels: nothing can be placed without a width and a height. */
const VISUAL: ReadonlySet<ImportKind> = new Set(["image", "video"]);

/** Kinds that occupy time: a clip with no duration is a single frame nobody asked for. */
const TIMED: ReadonlySet<ImportKind> = new Set(["video", "audio"]);

function positive(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Why this probe cannot be turned into an asset, or `null` when it can.
 *
 * The string is for the SERVER LOG — the caller answers `unsupported_media` with the catalog's own
 * sentence, because "height: 0" is not something to put in front of a person.
 */
export function unusableProbeReason(kind: ImportKind, probed: ProbeResult): string | null {
  if (VISUAL.has(kind) && !(positive(probed.width) && positive(probed.height))) {
    return "no usable pixel dimensions";
  }
  if (TIMED.has(kind) && !positive(probed.durationSeconds)) {
    return "no usable duration";
  }
  return null;
}
