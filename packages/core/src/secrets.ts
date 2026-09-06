import { guessDialectFromKey, guessDialectFromUrl, DEFAULT_OPENAI_BASE_URL, isDefaultOpenAIBaseUrl, resolvedOpenAIBaseUrl } from "./models/probe";
import { keyFingerprintOrNull } from "./security/fingerprint";
import { maskToolKeys } from "./tools/credentials";

export type StoredSecrets = {
  openaiApiKey?: string;
  googleApiKey?: string;
  anthropicApiKey?: string;
  volcengineApiKey?: string;
  openaiBaseUrl?: string;
  googleBaseUrl?: string;
  anthropicBaseUrl?: string;
  volcengineBaseUrl?: string;
  toolKeys?: Record<string, string>;
  toolBackends?: Record<string, string>;
  /** Default model id for image_generate (not a secret). */
  imageGenModel?: string;
  /** Default model id for video_generate (not a secret). */
  videoGenModel?: string;
  /** Default chat model for Documents jobs. */
  documentGenModel?: string;
  /** Default chat model for Research jobs. */
  researchGenModel?: string;
  /** Default chat model for Presentation jobs. */
  presentationGenModel?: string;
  /** Tool keys disabled on this machine (e.g. "image_generate"). */
  disabledTools?: string[];
  /** Advanced-only: skip injection scans. Thinning still runs. Default absent = protected. */
  injectionGuardBypass?: boolean;
  /** Per-turn Edit spend cap in USD. Host defaults to 2 when absent. */
  editTurnCapUsd?: number;
};

export type SecretPatch = StoredSecrets;

export type MaskedSecrets = {
  hasOpenai: boolean;
  hasGoogle: boolean;
  hasAnthropic: boolean;
  hasVolcengine: boolean;
  /** SHA-256 prefix of the saved gateway key, or null when none. Never the raw secret. */
  openaiKeyFingerprint: string | null;
  googleKeyFingerprint: string | null;
  anthropicKeyFingerprint: string | null;
  volcengineKeyFingerprint: string | null;
  openaiBaseUrl?: string;
  googleBaseUrl?: string;
  anthropicBaseUrl?: string;
  volcengineBaseUrl?: string;
  hasToolKeys: Record<string, boolean>;
  toolBackends: Record<string, string>;
  imageGenModel?: string;
  videoGenModel?: string;
  documentGenModel?: string;
  researchGenModel?: string;
  presentationGenModel?: string;
  disabledTools: string[];
  injectionGuardBypass: boolean;
  editTurnCapUsd?: number;
};

const KEY_FIELDS = ["openaiApiKey", "googleApiKey", "anthropicApiKey", "volcengineApiKey"] as const;
const URL_FIELDS = ["openaiBaseUrl", "googleBaseUrl", "anthropicBaseUrl", "volcengineBaseUrl"] as const;
const MODEL_FIELDS = [
  "imageGenModel",
  "videoGenModel",
  "documentGenModel",
  "researchGenModel",
  "presentationGenModel",
] as const;

export function mergeSecrets(current: StoredSecrets, patch: SecretPatch): StoredSecrets {
  const next: StoredSecrets = { ...current };
  for (const field of KEY_FIELDS) {
    const value = patch[field];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      delete next[field];
    } else {
      next[field] = trimmed;
    }
  }
  for (const field of URL_FIELDS) {
    const value = patch[field];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      delete next[field];
    } else {
      next[field] = trimmed.replace(/\/+$/, "");
    }
  }
  if (patch.toolKeys !== undefined) {
    const toolKeys = { ...current.toolKeys };
    for (const [name, value] of Object.entries(patch.toolKeys)) {
      if (typeof value !== "string") {
        continue;
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        delete toolKeys[name];
      } else {
        toolKeys[name] = trimmed;
      }
    }
    if (Object.keys(toolKeys).length > 0) {
      next.toolKeys = toolKeys;
    } else {
      delete next.toolKeys;
    }
  }
  if (patch.toolBackends) {
    const toolBackends = { ...current.toolBackends };
    for (const [capability, backend] of Object.entries(patch.toolBackends)) {
      if (typeof backend !== "string") {
        continue;
      }
      const trimmed = backend.trim();
      if (trimmed.length === 0) {
        delete toolBackends[capability];
      } else {
        toolBackends[capability] = trimmed;
      }
    }
    if (Object.keys(toolBackends).length > 0) {
      next.toolBackends = toolBackends;
    } else {
      delete next.toolBackends;
    }
  }
  for (const field of MODEL_FIELDS) {
    const value = patch[field];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      delete next[field];
    } else {
      next[field] = trimmed;
    }
  }
  if (patch.disabledTools !== undefined) {
    next.disabledTools = Array.isArray(patch.disabledTools)
      ? patch.disabledTools.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
      : [];
  }
  if (typeof patch.injectionGuardBypass === "boolean") {
    if (patch.injectionGuardBypass) {
      next.injectionGuardBypass = true;
    } else {
      delete next.injectionGuardBypass;
    }
  }
  if (patch.editTurnCapUsd !== undefined) {
    const raw =
      typeof patch.editTurnCapUsd === "number"
        ? patch.editTurnCapUsd
        : typeof patch.editTurnCapUsd === "string"
          ? Number(patch.editTurnCapUsd)
          : Number.NaN;
    if (Number.isFinite(raw)) {
      next.editTurnCapUsd = Math.min(50, Math.max(0.5, raw));
    }
  }
  return next;
}

export function maskSecrets(current: StoredSecrets): MaskedSecrets {
  return {
    hasOpenai: Boolean(current.openaiApiKey),
    hasGoogle: Boolean(current.googleApiKey),
    hasAnthropic: Boolean(current.anthropicApiKey),
    hasVolcengine: Boolean(current.volcengineApiKey),
    openaiKeyFingerprint: keyFingerprintOrNull(current.openaiApiKey),
    googleKeyFingerprint: keyFingerprintOrNull(current.googleApiKey),
    anthropicKeyFingerprint: keyFingerprintOrNull(current.anthropicApiKey),
    volcengineKeyFingerprint: keyFingerprintOrNull(current.volcengineApiKey),
    openaiBaseUrl: current.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL,
    googleBaseUrl: current.googleBaseUrl,
    anthropicBaseUrl: current.anthropicBaseUrl,
    volcengineBaseUrl: current.volcengineBaseUrl,
    hasToolKeys: maskToolKeys(current),
    toolBackends: current.toolBackends ?? {},
    imageGenModel: current.imageGenModel,
    videoGenModel: current.videoGenModel,
    documentGenModel: current.documentGenModel,
    researchGenModel: current.researchGenModel,
    presentationGenModel: current.presentationGenModel,
    disabledTools: current.disabledTools ?? [],
    injectionGuardBypass: current.injectionGuardBypass === true,
    editTurnCapUsd: current.editTurnCapUsd,
  };
}

export function hasLiveProvider(settings: StoredSecrets): boolean {
  return Boolean(
    settings.openaiApiKey ||
      settings.googleApiKey ||
      settings.anthropicApiKey ||
      settings.volcengineApiKey ||
      (settings.openaiBaseUrl && !isDefaultOpenAIBaseUrl(settings.openaiBaseUrl)) ||
      settings.anthropicBaseUrl ||
      settings.volcengineBaseUrl,
  );
}

export function resolveRuntimeMode(input: { settingsHasKey: boolean; envRuntime?: string }): "ai" | "stub" {
  if (input.settingsHasKey) {
    return "ai";
  }
  return input.envRuntime === "ai" ? "ai" : "stub";
}

export function resolveProviderKeys(
  settings: StoredSecrets,
  env: NodeJS.ProcessEnv = process.env,
): {
  openai?: string;
  google?: string;
  anthropic?: string;
  volcengine?: string;
  openaiBaseUrl?: string;
  googleBaseUrl?: string;
  anthropicBaseUrl?: string;
  volcengineBaseUrl?: string;
} {
  const openai = settings.openaiApiKey || env.OPENAI_API_KEY || undefined;
  const openaiBaseUrl = resolvedOpenAIBaseUrl(settings.openaiBaseUrl || env.OPENAI_BASE_URL);
  const openaiKeyDialect = openai ? guessDialectFromKey(openai) : undefined;
  const openaiUrlDialect = openaiBaseUrl ? guessDialectFromUrl(openaiBaseUrl) : undefined;
  const reuseOpenAI = (dialect: "anthropic" | "google" | "volcengine") =>
    openaiKeyDialect === dialect || openaiUrlDialect === dialect ? openai : undefined;
  const reuseOpenAIUrl = (dialect: "anthropic" | "google" | "volcengine") =>
    openaiUrlDialect === dialect ? openaiBaseUrl : undefined;

  return {
    openai,
    google: settings.googleApiKey || env.GOOGLE_GENERATIVE_AI_API_KEY || reuseOpenAI("google"),
    anthropic: settings.anthropicApiKey || env.ANTHROPIC_API_KEY || reuseOpenAI("anthropic"),
    volcengine:
      settings.volcengineApiKey || env.ARK_API_KEY || env.VOLCENGINE_API_KEY || reuseOpenAI("volcengine"),
    openaiBaseUrl,
    googleBaseUrl: settings.googleBaseUrl || env.GOOGLE_GENERATIVE_AI_BASE_URL || reuseOpenAIUrl("google"),
    anthropicBaseUrl: settings.anthropicBaseUrl || env.ANTHROPIC_BASE_URL || reuseOpenAIUrl("anthropic"),
    volcengineBaseUrl:
      settings.volcengineBaseUrl || env.ARK_BASE_URL || env.VOLCENGINE_BASE_URL || reuseOpenAIUrl("volcengine"),
  };
}
