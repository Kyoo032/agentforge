import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  chooseDefaultModel,
  detectCompatibleApi,
  mergeChatCatalog,
  probeAnthropicModels,
  probeGoogleModels,
  probeVolcengineModels,
  redactSecrets,
  type ChatModel,
  type ModelProvider,
  type StoredSecrets,
} from "@agentforge/core";
import { loadModelCache, saveModelCache, type ModelCache } from "./model-cache";

function liveModelIds(cache: ModelCache): string[] {
  return [
    ...(cache.openai ?? []),
    ...(cache.anthropic ?? []),
    ...(cache.google ?? []),
    ...(cache.volcengine ?? []),
  ].map((model) => model.id);
}

export function listSelectableModels(): ChatModel[] {
  const cache = loadModelCache();
  return mergeChatCatalog({
    openai: cache.openai,
    anthropic: cache.anthropic,
    google: cache.google,
    volcengine: cache.volcengine,
  });
}

export function defaultSelectableModel(models: ChatModel[] = listSelectableModels()): string {
  return chooseDefaultModel(models, liveModelIds(loadModelCache()), DEFAULT_CHAT_MODEL);
}

function putModels(next: ModelCache, dialect: ModelProvider, models: ChatModel[], now: string): void {
  next[dialect] = models;
  if (dialect === "openai") {
    next.openaiProbedAt = now;
    delete next.openaiError;
  }
  if (dialect === "anthropic") {
    next.anthropicProbedAt = now;
    delete next.anthropicError;
  }
  if (dialect === "google") {
    next.googleProbedAt = now;
    delete next.googleError;
  }
  if (dialect === "volcengine") {
    next.volcengineProbedAt = now;
    delete next.volcengineError;
  }
}

export async function refreshModelCache(settings: StoredSecrets): Promise<ModelCache> {
  const current = loadModelCache();
  const next: ModelCache = { ...current };
  const now = new Date().toISOString();

  if (settings.openaiApiKey || settings.openaiBaseUrl) {
    try {
      const detected = await detectCompatibleApi({
        url: settings.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL,
        apiKey: settings.openaiApiKey,
      });
      putModels(next, detected.dialect, detected.models, now);
      next.detectedDialect = detected.dialect;
    } catch (error) {
      next.openaiError = redactSecrets(
        error instanceof Error ? error.message : "Could not list models from the gateway",
      );
    }
  }

  if (settings.anthropicApiKey || settings.anthropicBaseUrl) {
    try {
      putModels(
        next,
        "anthropic",
        await probeAnthropicModels({
          baseURL: settings.anthropicBaseUrl,
          apiKey: settings.anthropicApiKey,
        }),
        now,
      );
    } catch (error) {
      next.anthropicError = redactSecrets(
        error instanceof Error ? error.message : "Could not list Anthropic models",
      );
    }
  }

  if (settings.googleApiKey) {
    try {
      putModels(
        next,
        "google",
        await probeGoogleModels({
          baseURL: settings.googleBaseUrl,
          apiKey: settings.googleApiKey,
        }),
        now,
      );
    } catch (error) {
      next.googleError = redactSecrets(error instanceof Error ? error.message : "Could not list Gemini models");
    }
  }

  if (settings.volcengineApiKey || settings.volcengineBaseUrl) {
    try {
      putModels(
        next,
        "volcengine",
        await probeVolcengineModels({
          baseURL: settings.volcengineBaseUrl,
          apiKey: settings.volcengineApiKey,
        }),
        now,
      );
    } catch (error) {
      next.volcengineError = redactSecrets(
        error instanceof Error ? error.message : "Could not list Volcengine models",
      );
    }
  }

  return saveModelCache(next);
}
