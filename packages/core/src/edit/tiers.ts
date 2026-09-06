import { imageToVideoForModel } from "../models/video-capabilities";

export const EDIT_TIER_IDS = ["draft", "standard", "cinematic"] as const;
export type EditTier = (typeof EDIT_TIER_IDS)[number];

export type EditTierConfig = {
  id: EditTier;
  video: string[];
  image: string[];
};

export const EDIT_TIERS: Record<EditTier, EditTierConfig> = {
  draft: {
    id: "draft",
    video: ["grok-imagine-video", "seedance-2.0-mini"],
    image: ["gpt-image-2", "seedream-*"],
  },
  standard: {
    id: "standard",
    video: ["seedance-2.0-fast", "grok-imagine-video-1.5-preview"],
    image: ["gpt-image-2", "seedream-5.0-pro"],
  },
  cinematic: {
    id: "cinematic",
    video: ["seedance-2.5", "doubao-seedance-*", "veo_*", "kling*", "sora*"],
    image: ["gpt-image-2"],
  },
};

export const CAMERA_CHIPS = {
  static: "locked-off static camera, no camera movement",
  "slow push-in": "slow cinematic push-in toward the subject",
  "pull back": "camera pulls back, revealing more of the scene",
  orbit: "camera slowly orbits around the subject",
  "pan left": "camera pans left",
  "pan right": "camera pans right",
  "tilt up": "camera tilts up",
  handheld: "handheld camera, subtle natural shake",
} as const;

export type CameraChip = keyof typeof CAMERA_CHIPS;

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function matchLiveCandidate(candidate: string, liveModelIds: string[]): string | undefined {
  if (candidate.includes("*")) {
    const re = globToRegExp(candidate);
    return liveModelIds.find((id) => re.test(id));
  }
  const want = candidate.toLowerCase();
  return liveModelIds.find((id) => id.toLowerCase() === want);
}

export function routeEditModel(input: {
  kind: "video" | "image";
  tier: EditTier;
  liveModelIds: string[];
  requireImageToVideo?: boolean;
}): string | null {
  const config = EDIT_TIERS[input.tier];
  const candidates = input.kind === "video" ? config.video : config.image;
  for (const candidate of candidates) {
    const hit = matchLiveCandidate(candidate, input.liveModelIds);
    if (!hit) {
      continue;
    }
    if (input.kind === "video" && input.requireImageToVideo && !imageToVideoForModel(hit)) {
      continue;
    }
    return hit;
  }
  return null;
}
