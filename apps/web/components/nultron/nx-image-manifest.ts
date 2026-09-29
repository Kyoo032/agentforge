import manifest from "@/components/nultron/images/manifest.json";
import type { MascotState } from "@/lib/mascot-states";

/**
 * The picture of the character, `images/manifest.json`: one still per state for the body and one for
 * the head, a short one-shot clip for the states that have one, and an optional four-frame loop for a
 * state that works. The files come from the offline 3D renders and are replaced by name.
 *
 *   full/<state>.<ext>    the whole body, a square canvas (`full.size` px)
 *   head/<state>.<ext>    the head only, a square canvas (`head.size` px), for boxes under 64 px
 *   clips/<state>.<ext>   `frames` canvases of `size` px side by side, played once at `fps`
 *   loops/<state>.<ext>   4 canvases side by side, looped (stepped) while a job runs
 *
 * `manifest.json` is imported, not fetched: it is typed and bundled. Paths in it are relative to
 * `images/`, and `nx-image-urls.ts` turns them into the URLs the build serves.
 */
export type NxImageKind = "full" | "head";

export type NxClip = { src: string; frames: number; fps: number; size: number };
export type NxLoop = { src: string; frames: number; fps?: number; size?: number };

export type NxManifest = {
  version: number;
  source?: string;
  full: { size: number; states: Record<string, string> };
  head: { size: number; states: Record<string, string> };
  clips: Record<string, NxClip>;
  loops?: Record<string, NxLoop>;
  bytes?: number;
};

export const NX_MANIFEST = manifest as unknown as NxManifest;

/** `--motion-4` in app/globals.css, the beat every clip is timed in. A test holds the two equal. */
export const NX_BEAT_MS = 320;

/** A busy loop is exactly this many frames: `--ease-busy` is `steps(4)`. */
export const NX_LOOP_FRAMES = 4;

/** The rate of a loop whose manifest entry states none. */
export const NX_LOOP_DEFAULT_FPS = 4;

export function stillPath(kind: NxImageKind, state: MascotState): string | undefined {
  return NX_MANIFEST[kind].states[state];
}

/** Clips are drawn on the full canvas: a head box has none and takes a small transform clip instead. */
export function clipSpec(state: MascotState): NxClip | null {
  return NX_MANIFEST.clips[state] ?? null;
}

export function loopSpec(state: MascotState): NxLoop | null {
  return NX_MANIFEST.loops?.[state] ?? null;
}

/** How long a clip plays, in ms. */
export function clipMs(clip: NxClip): number {
  return (clip.frames / clip.fps) * 1000;
}

/** A clip's length in beats of `--motion-4`, so its duration still comes from the desk's motion scale. */
export function clipBeats(clip: NxClip): number {
  return Math.round((clipMs(clip) / NX_BEAT_MS) * 1000) / 1000;
}

/** A busy loop's cycle in beats of `--motion-4`: its frames at the fps the manifest records for THAT loop (3, 4 or 6). */
export function loopBeats(loop: NxLoop): number {
  const fps = loop.fps ?? NX_LOOP_DEFAULT_FPS;
  return Math.round(((loop.frames / fps) * 1000 / NX_BEAT_MS) * 1000) / 1000;
}

/** Every file the manifest names, relative to `images/`. */
export function manifestFiles(): string[] {
  return [
    ...Object.values(NX_MANIFEST.full.states),
    ...Object.values(NX_MANIFEST.head.states),
    ...Object.values(NX_MANIFEST.clips).map((clip) => clip.src),
    ...Object.values(NX_MANIFEST.loops ?? {}).map((loop) => loop.src),
  ];
}
