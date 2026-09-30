import {
  clipSpec,
  loopSpec,
  NX_LOOP_FRAMES,
  type NxImageKind,
  stillPath,
} from "@/components/nultron/nx-image-manifest";
import { imageUrl } from "@/components/nultron/nx-image-urls";
import type { MascotState } from "@/lib/mascot-states";

/**
 * Which files draw a state. Pure lookups, shared by the rig (what to mount) and the warm-up (what to
 * fetch ahead), so the two cannot disagree about what a picture is made of: the still, and on the body
 * only a clip strip (a `once` state) or a loop strip (a working state). A head box has neither.
 */
export function hasStill(state: MascotState, kind: NxImageKind): boolean {
  return imageUrl(stillPath(kind, state)) !== undefined;
}

export function hasClip(state: MascotState, kind: NxImageKind): boolean {
  const clip = clipSpec(state);
  return kind === "full" && clip !== null && imageUrl(clip.src) !== undefined;
}

export function hasLoop(state: MascotState, kind: NxImageKind): boolean {
  const loop = loopSpec(state);
  return kind === "full" && loop !== null && loop.frames === NX_LOOP_FRAMES && imageUrl(loop.src) !== undefined;
}

/** What of a picture to fetch: the still, the strip, or both. */
export type PictureWant = { still?: boolean; sheet?: boolean };

/** The URLs a state's picture is made of, restricted to what `want` asks for. Never a head strip. */
export function pictureUrls(state: MascotState, kind: NxImageKind, want: PictureWant = {}): string[] {
  const { still = true, sheet = true } = want;
  const urls: (string | undefined)[] = [];
  if (still) {
    urls.push(imageUrl(stillPath(kind, state)));
  }
  if (sheet && hasClip(state, kind)) {
    urls.push(imageUrl(clipSpec(state)?.src));
  }
  if (sheet && hasLoop(state, kind)) {
    urls.push(imageUrl(loopSpec(state)?.src));
  }
  return urls.filter((url): url is string => url !== undefined);
}
