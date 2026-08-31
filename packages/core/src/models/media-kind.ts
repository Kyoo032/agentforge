export type MediaKind = "chat" | "image" | "video" | "audio" | "other";

export const MEDIA_KINDS: MediaKind[] = ["chat", "image", "video", "audio", "other"];

export type RoutedModels<T extends { id: string }> = Record<MediaKind, T[]>;

export const DEFAULT_GATEWAY_IMAGE_MODEL = "gpt-image-2";
export const DEFAULT_GATEWAY_VIDEO_MODEL = "seedance-2.0-fast";

const IMAGE_PREF = ["gpt-image-2"];

const VIDEO_PREF = ["seedance-2.0-fast", "seedance-2.0-mini"];

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

function firstPresent(preferred: string[], ids: string[]): string | undefined {
  const available = new Set(ids);
  return preferred.find((id) => available.has(id));
}

export function pickPreferredImageModel(ids: string[]): string {
  const usable = ids.filter((id) => mediaKind(id) === "image" && !id.toLowerCase().startsWith("mj_"));
  return firstPresent(IMAGE_PREF, usable) ?? usable[0] ?? DEFAULT_GATEWAY_IMAGE_MODEL;
}

export function pickPreferredVideoModel(ids: string[]): string {
  const usable = ids.filter((id) => mediaKind(id) === "video" && !id.toLowerCase().startsWith("mj_"));
  return firstPresent(VIDEO_PREF, usable) ?? DEFAULT_GATEWAY_VIDEO_MODEL;
}
