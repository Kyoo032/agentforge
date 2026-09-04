export type MediaKind = "chat" | "image" | "video" | "audio" | "other";

export const MEDIA_KINDS: MediaKind[] = ["chat", "image", "video", "audio", "other"];

export type RoutedModels<T extends { id: string }> = Record<MediaKind, T[]>;

export const DEFAULT_GATEWAY_IMAGE_MODEL = "gpt-image-2";
export const DEFAULT_GATEWAY_VIDEO_MODEL = "grok-imagine-video";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

const EMBEDDING = /embedding/i;
const EMBEDDING_PREF = ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-004"];

const IMAGE_PREF = ["gpt-image-2", "seedream-5.0-pro", "doubao-seedream-5-0-pro-260628"];

/** Cheap t2v first. Seedance 2.5 stays in the picker as the quality option. */
const VIDEO_PREF = ["grok-imagine-video", "omni-fast-v2v", "grok-imagine-video-1.5-preview"];

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

export function isEmbeddingModelId(id: string): boolean {
  return EMBEDDING.test(id.trim());
}

export function pickPreferredEmbeddingModel(ids: string[]): string {
  const usable = ids.filter((id) => isEmbeddingModelId(id));
  return firstLiveId(EMBEDDING_PREF, usable) ?? usable[0] ?? DEFAULT_EMBEDDING_MODEL;
}
