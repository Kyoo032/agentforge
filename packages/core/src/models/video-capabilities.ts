export type VideoCapabilities = {
  ratio: boolean;
  resolution: boolean;
  seconds: boolean;
  still: boolean;
};

export const GATEWAY_VIDEO_DURATION_SECONDS = 5;
export const GATEWAY_VIDEO_RESOLUTION = "720p";
export const GATEWAY_VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const GATEWAY_VIDEO_SECONDS_MIN = 2;
export const GATEWAY_VIDEO_SECONDS_MAX = 12;

export type GatewayVideoResolution = (typeof GATEWAY_VIDEO_RESOLUTIONS)[number];

const SEEDANCE_ALL: VideoCapabilities = {
  ratio: true,
  resolution: true,
  seconds: true,
  still: true,
};

const OPENAI_LIKE: VideoCapabilities = {
  ratio: false,
  resolution: false,
  seconds: true,
  still: true,
};

/** Seedance-class models bill by duration × resolution tier (`720p`), not OpenAI pixel `1280x720`. */
export function usesSeedanceVideoWire(model: string): boolean {
  return /seedance|dreamina-seedance|doubao-seedance|veo_|kling|sora/i.test(model);
}

export function videoCapabilities(model: string): VideoCapabilities {
  return usesSeedanceVideoWire(model) ? SEEDANCE_ALL : OPENAI_LIKE;
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
