import { isDefaultChatAgent } from "./default-chat";
import { sanitizeProductModes, type ProductMode } from "./product-modes";

export type GeneratePinKind = "image" | "video" | "music";

const MODE_FOR_KIND: Record<GeneratePinKind, ProductMode> = {
  image: "images",
  video: "videos",
  music: "music",
};

const PIN_KEY: Record<GeneratePinKind, "imageGenModel" | "videoGenModel" | "musicGenModel"> = {
  image: "imageGenModel",
  video: "videoGenModel",
  music: "musicGenModel",
};

export function readGeneratePin(
  config: Record<string, unknown> | null | undefined,
  kind: GeneratePinKind,
): string | undefined {
  if (!config) {
    return undefined;
  }
  const value = config[PIN_KEY[kind]];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function mergeGeneratePins(
  current: Record<string, unknown> | null | undefined,
  patch: { imageGenModel?: string | null; videoGenModel?: string | null; musicGenModel?: string | null },
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  if ("imageGenModel" in patch) {
    const trimmed = typeof patch.imageGenModel === "string" ? patch.imageGenModel.trim() : "";
    if (trimmed) {
      next.imageGenModel = trimmed;
    } else {
      delete next.imageGenModel;
    }
  }
  if ("videoGenModel" in patch) {
    const trimmed = typeof patch.videoGenModel === "string" ? patch.videoGenModel.trim() : "";
    if (trimmed) {
      next.videoGenModel = trimmed;
    } else {
      delete next.videoGenModel;
    }
  }
  if ("musicGenModel" in patch) {
    const trimmed = typeof patch.musicGenModel === "string" ? patch.musicGenModel.trim() : "";
    if (trimmed) {
      next.musicGenModel = trimmed;
    } else {
      delete next.musicGenModel;
    }
  }
  return next;
}

export type GenerateDefaultSource = {
  slug: string;
  createdAt: Date | string | number;
  productModes?: ProductMode[] | string[] | null;
  config?: Record<string, unknown> | null;
};

function createdAtMs(value: Date | string | number): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sourceUnlocks(source: GenerateDefaultSource, mode: ProductMode): boolean {
  const modes = sanitizeProductModes(source.productModes);
  if (modes === undefined) {
    // Legacy agents predate Music, so an absent list unlocks only the two surfaces it could mean.
    return mode === "images" || mode === "videos";
  }
  return modes.includes(mode);
}

/**
 * Workspace studio picker default: first custom agent (by createdAt) that
 * unlocks the surface and has a pin, else Settings, else catalog preferred.
 */
export function resolveStudioGenerateDefault(options: {
  kind: GeneratePinKind;
  sources: GenerateDefaultSource[];
  settingsModel?: string;
  catalogPreferred: string;
}): string {
  const mode = MODE_FOR_KIND[options.kind];
  const pinned = options.sources
    .filter((source) => !isDefaultChatAgent(source) && sourceUnlocks(source, mode))
    .map((source) => ({
      at: createdAtMs(source.createdAt),
      pin: readGeneratePin(source.config ?? undefined, options.kind),
    }))
    .filter((item): item is { at: number; pin: string } => Boolean(item.pin))
    .sort((a, b) => a.at - b.at);
  if (pinned[0]?.pin) {
    return pinned[0].pin;
  }
  const fromSettings = options.settingsModel?.trim();
  if (fromSettings) {
    return fromSettings;
  }
  return options.catalogPreferred;
}
