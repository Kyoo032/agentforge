export type MediaKind = "chat" | "image" | "video" | "audio" | "other";

export const MEDIA_KINDS: MediaKind[] = ["chat", "image", "video", "audio", "other"];

export type RoutedModels<T extends { id: string }> = Record<MediaKind, T[]>;

export const DEFAULT_GATEWAY_IMAGE_MODEL = "gpt-image-2";
export const DEFAULT_GATEWAY_VIDEO_MODEL = "grok-imagine-video";
export const DEFAULT_GATEWAY_MUSIC_MODEL = "suno_music";
export const DEFAULT_GATEWAY_LYRICS_MODEL = "suno_lyrics";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

const EMBEDDING = /embedding/i;
const EMBEDDING_PREF = ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-004"];

const IMAGE_PREF = ["gpt-image-2", "seedream-5.0-pro", "doubao-seedream-5-0-pro-260628"];

/** The only music generator on this gateway (2026-09; docs/internal/gateway-model-selection.md 5.3). */
const MUSIC_PREF = ["suno_music"];
const LYRICS_PREF = ["suno_lyrics"];
/** Non-realtime text-to-speech. Empty on this gateway today — see `speechModelRole` below. */
const SPEECH_PREF = ["qwen-audio-3.0-tts", "tts-1-hd", "tts-1"];

/** Veo fast completes reliably on the gateway (2026-09); cheap t2v ids follow as fallbacks. */
const VIDEO_PREF = ["veo_3_1-fast", "grok-imagine-video", "omni-fast-v2v", "grok-imagine-video-1.5-preview"];

const OTHER =
  /(^|\/)(text-)?embedding|babbage|davinci|computer-use|omni-moderation|text-moderation|moderation/i;
const AUDIO = /suno_|whisper|\btts\b|tts-1|lyria|transcribe|audio-/i;
const VIDEO =
  /seedance|veo[_-]|kling|\bsora\b|happyhorse|mj_video|grok-imagine-video|-t2v|-i2v|-r2v|-v2v|video-edit|omni-fast-v2v/i;
const IMAGE =
  /gpt-image|dall-e|chatgpt-image|seedream|flux-|imagen-|mj_|grok-imagine-image|nano-banana|qwen-image|wan2\.7-image|z-image|image-edit|gemini-[\w.-]*image/i;

export function mediaKind(id: string): MediaKind {
  const value = id.trim();
  if (!value) {
    return "other";
  }
  if (OTHER.test(value)) {
    return "other";
  }
  if (AUDIO.test(value)) {
    return "audio";
  }
  if (VIDEO.test(value)) {
    return "video";
  }
  if (IMAGE.test(value)) {
    return "image";
  }
  const lower = value.toLowerCase();
  if (lower.includes("video")) {
    return "video";
  }
  if (lower.includes("image") && !lower.includes("imagine")) {
    return "image";
  }
  return "chat";
}

/**
 * What an `audio`-classified id actually does. `mediaKind` lumps every audio id together, but the
 * Music studio has to tell a song generator from a lyric writer, a reader from a transcriber:
 * sending a prompt to the wrong one bills the desk for nothing.
 *
 * `realtime` is its own answer on purpose. Section 2.1 of `docs/internal/gateway-model-selection.md`
 * says the `*-realtime` ids speak WebSocket behind an `openai` endpoint label, so they cannot be
 * driven from a plain HTTP job route — treating one as TTS would produce a request nothing answers.
 */
export type AudioRole = "music" | "lyrics" | "speech" | "realtime" | "transcribe" | "other";

const LYRICS_ID = /suno_lyrics|lyric/i;
const MUSIC_ID = /suno_music|\bmusic\b|lyria/i;
const TRANSCRIBE_ID = /whisper|transcribe|\basr\b|-asr/i;
const SPEECH_ID = /\btts\b|tts-|-tts|text-to-speech|speech/i;
const REALTIME_ID = /realtime/i;

export function audioRole(id: string): AudioRole {
  const value = id.trim();
  if (!value || mediaKind(value) !== "audio") {
    return "other";
  }
  if (LYRICS_ID.test(value)) {
    return "lyrics";
  }
  if (MUSIC_ID.test(value)) {
    return "music";
  }
  if (TRANSCRIBE_ID.test(value)) {
    return "transcribe";
  }
  // Realtime is checked before TTS so `qwen3-tts-instruct-flash-realtime` never looks reachable.
  if (REALTIME_ID.test(value)) {
    return "realtime";
  }
  if (SPEECH_ID.test(value)) {
    return "speech";
  }
  return "other";
}

export function isMusicModelId(id: string): boolean {
  return audioRole(id) === "music";
}

export function isLyricsModelId(id: string): boolean {
  return audioRole(id) === "lyrics";
}

/** Text-to-speech we can actually POST to. A WebSocket-only realtime id is deliberately excluded. */
export function isSpeechModelId(id: string): boolean {
  return audioRole(id) === "speech";
}

export function routeModelsByKind<T extends { id: string }>(models: T[]): RoutedModels<T> {
  const routed: RoutedModels<T> = {
    chat: [],
    image: [],
    video: [],
    audio: [],
    other: [],
  };
  for (const model of models) {
    routed[mediaKind(model.id)].push(model);
  }
  return routed;
}

/** Return the live catalog spelling of the first preferred id (case-insensitive). */
export function firstLiveId(preferred: string[], ids: string[]): string | undefined {
  const byLower = new Map(ids.map((id) => [id.toLowerCase(), id]));
  for (const want of preferred) {
    const hit = byLower.get(want.toLowerCase());
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

export function pickPreferredImageModel(ids: string[]): string {
  const usable = ids.filter((id) => mediaKind(id) === "image" && !id.toLowerCase().startsWith("mj_"));
  return firstLiveId(IMAGE_PREF, usable) ?? usable[0] ?? DEFAULT_GATEWAY_IMAGE_MODEL;
}

export function pickPreferredVideoModel(ids: string[]): string {
  const usable = ids.filter((id) => mediaKind(id) === "video" && !id.toLowerCase().startsWith("mj_"));
  return firstLiveId(VIDEO_PREF, usable) ?? usable[0] ?? DEFAULT_GATEWAY_VIDEO_MODEL;
}

export function pickPreferredMusicModel(ids: string[]): string {
  const usable = ids.filter((id) => isMusicModelId(id));
  return firstLiveId(MUSIC_PREF, usable) ?? usable[0] ?? DEFAULT_GATEWAY_MUSIC_MODEL;
}

export function pickPreferredLyricsModel(ids: string[]): string {
  const usable = ids.filter((id) => isLyricsModelId(id));
  return firstLiveId(LYRICS_PREF, usable) ?? usable[0] ?? DEFAULT_GATEWAY_LYRICS_MODEL;
}

/**
 * Empty string when the live catalog has no non-realtime TTS id, which is the case on this gateway
 * today. There is no default to fall back on: inventing one would send the desk at a model the
 * gateway does not serve, and the studio would rather say so than fail at submit time.
 */
export function pickPreferredSpeechModel(ids: string[]): string {
  const usable = ids.filter((id) => isSpeechModelId(id));
  return firstLiveId(SPEECH_PREF, usable) ?? usable[0] ?? "";
}

export function isEmbeddingModelId(id: string): boolean {
  return EMBEDDING.test(id.trim());
}

export function pickPreferredEmbeddingModel(ids: string[]): string {
  const usable = ids.filter((id) => isEmbeddingModelId(id));
  return firstLiveId(EMBEDDING_PREF, usable) ?? usable[0] ?? DEFAULT_EMBEDDING_MODEL;
}
