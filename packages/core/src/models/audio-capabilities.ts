/**
 * What the Music studio may put on screen for a given audio model.
 *
 * The video twin of this file (`video-capabilities.ts`) exists because a clip-length picker that
 * offers a length the model rejects costs the desk a failed job. The same applies here: Suno is
 * driven either from a short description (it writes the lyrics) or from lyrics the user supplies
 * with a style and a title, and the two modes take different fields. Offering both at once produces
 * a request the relay cannot read.
 *
 * No Node-only imports: the renderer loads this module through the `@agentforge/core/audio-capabilities`
 * subpath, the same way the Videos studio loads its own.
 */

import { audioRole } from "./media-kind";

/** How the prompt reaches a music model. */
export const MUSIC_MODES = ["describe", "custom"] as const;
export type MusicMode = (typeof MUSIC_MODES)[number];

export type MusicCapabilities = {
  /** The model accepts user-written lyrics (`custom` mode). */
  lyrics: boolean;
  /** The model accepts a style / genre tag list. */
  style: boolean;
  /** The model accepts a track title. */
  title: boolean;
  /** The model can render the track with no vocals. */
  instrumental: boolean;
};

/** Caps that keep a request inside what the Suno relay accepts, and a runaway paste out of the job. */
export const MUSIC_PROMPT_MAX = 1_000;
export const MUSIC_LYRICS_MAX = 3_000;
export const MUSIC_STYLE_MAX = 200;
export const MUSIC_TITLE_MAX = 80;

const SUNO_LIKE: MusicCapabilities = {
  lyrics: true,
  style: true,
  title: true,
  instrumental: true,
};

/** Anything we cannot identify gets the description box and nothing else. */
const DESCRIBE_ONLY: MusicCapabilities = {
  lyrics: false,
  style: false,
  title: false,
  instrumental: false,
};

export function usesSunoMusicWire(model: string): boolean {
  return /^suno_/i.test(model.trim());
}

export function musicCapabilities(model: string): MusicCapabilities {
  return usesSunoMusicWire(model) ? { ...SUNO_LIKE } : { ...DESCRIBE_ONLY };
}

export function isMusicMode(value: unknown): value is MusicMode {
  return typeof value === "string" && (MUSIC_MODES as readonly string[]).includes(value);
}

/** The mode a model can actually serve: a model with no lyrics field only ever describes. */
export function resolveMusicMode(model: string, wanted?: string): MusicMode {
  if (wanted === "custom" && musicCapabilities(model).lyrics) {
    return "custom";
  }
  return "describe";
}

/**
 * Whether a speech model is reachable over the plain HTTP job route.
 *
 * On this gateway (2026-09) the answer is no for every live id: the only TTS entry is
 * `qwen3-tts-instruct-flash-realtime`, and `audioRole` returns `realtime` for it because the
 * realtime family speaks WebSocket behind its `openai` endpoint label. The Music studio reads this
 * to explain why the voice-over control is off rather than failing at submit time, and the control
 * turns itself on the day the catalog lists a non-realtime TTS id.
 */
export function speechReachable(ids: readonly string[]): boolean {
  return ids.some((id) => audioRole(id) === "speech");
}

/** Why the voice-over control is off, as a machine-readable reason the renderer maps to copy. */
export type SpeechUnavailableReason = "no_audio_models" | "realtime_only";

export function speechUnavailableReason(ids: readonly string[]): SpeechUnavailableReason | null {
  if (speechReachable(ids)) {
    return null;
  }
  return ids.some((id) => audioRole(id) === "realtime") ? "realtime_only" : "no_audio_models";
}
