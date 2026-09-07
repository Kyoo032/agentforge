export type VideoCapabilities = {
  ratio: boolean;
  resolution: boolean;
  seconds: boolean;
  still: boolean;
  imageToVideo: boolean;
};

export const GATEWAY_VIDEO_DURATION_SECONDS = 5;
export const GATEWAY_VIDEO_RESOLUTION = "720p";
export const GATEWAY_VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const GATEWAY_VIDEO_SECONDS_MIN = 2;
export const GATEWAY_VIDEO_SECONDS_MAX = 12;

export type GatewayVideoResolution = (typeof GATEWAY_VIDEO_RESOLUTIONS)[number];

const SEEDANCE_ALL = {
  ratio: true,
  resolution: true,
  seconds: true,
  still: true,
} as const;

const OPENAI_LIKE = {
  ratio: false,
  resolution: false,
  seconds: true,
  still: true,
} as const;

/** Seedance-class models bill by duration × resolution tier (`720p`), not OpenAI pixel `1280x720`. */
export function usesSeedanceVideoWire(model: string): boolean {
  return /seedance|dreamina-seedance|doubao-seedance|veo_|kling|sora/i.test(model);
}

/**
 * Honest image-to-video gate (G-20). Unknown ids are false.
 * `still` remains the legacy UI-field flag and may stay true when `imageToVideo` is false.
 */
export function imageToVideoForModel(model: string): boolean {
  if (/omni-fast-v2v/i.test(model)) {
    return false;
  }
  if (/mj_video/i.test(model)) {
    return false;
  }
  if (/grok-imagine-video/i.test(model)) {
    return true;
  }
  if (/seedance|dreamina|doubao-seedance|veo_|kling|\bsora/i.test(model)) {
    return true;
  }
  return false;
}

export function videoCapabilities(model: string): VideoCapabilities {
  const base = usesSeedanceVideoWire(model) ? SEEDANCE_ALL : OPENAI_LIKE;
  return { ...base, imageToVideo: imageToVideoForModel(model) };
}

export function clampVideoSeconds(seconds?: number): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return GATEWAY_VIDEO_DURATION_SECONDS;
  }
  return Math.min(GATEWAY_VIDEO_SECONDS_MAX, Math.max(GATEWAY_VIDEO_SECONDS_MIN, Math.round(seconds)));
}

export function normalizeVideoResolution(resolution?: string): GatewayVideoResolution {
  if (resolution === "480p" || resolution === "720p" || resolution === "1080p") {
    return resolution;
  }
  return GATEWAY_VIDEO_RESOLUTION;
}
