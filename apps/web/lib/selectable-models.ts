import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  chooseDefaultModel,
  detectCompatibleApi,
  mediaKind,
  mergeChatCatalog,
  probeAnthropicModels,
  probeGoogleModels,
  probeVolcengineModels,
  redactSecrets,
  resolveModeDefaults,
  routeModelsByKind,
  withContextLengths,
  type ChatModel,
  type ModeModelDefaults,
  type ModelProvider,
  type RoutedModels,
  type StoredSecrets,
} from "@agentforge/core";
import { loadModelCache, saveModelCache, type ModelCache } from "./model-cache";
import { loadModelsDevRegistry, refreshModelsDevRegistry } from "./models-dev-cache";

function liveModelIds(cache: ModelCache, kind?: "chat"): string[] {
  const ids = [
    ...(cache.openai ?? []),
    ...(cache.anthropic ?? []),
    ...(cache.google ?? []),
    ...(cache.volcengine ?? []),
  ].map((model) => model.id);
  if (kind === "chat") {
    return ids.filter((id) => mediaKind(id) === "chat");
  }
  return ids;
}

export function listCatalogModels(): ChatModel[] {
  const cache = loadModelCache();
  return withContextLengths(
    mergeChatCatalog({
      openai: cache.openai,
      anthropic: cache.anthropic,
      google: cache.google,
      volcengine: cache.volcengine,
    }),
    loadModelsDevRegistry(),
  );
}

export function listRoutedModels(models: ChatModel[] = listCatalogModels()): RoutedModels<ChatModel> {
  return routeModelsByKind(models);
}

export function listSelectableModels(): ChatModel[] {
  return listRoutedModels().chat;
}

export function listImageModels(): ChatModel[] {
  return listRoutedModels().image;
}

export function listVideoModels(): ChatModel[] {
  return listRoutedModels().video;
}

export function defaultSelectableModel(models: ChatModel[] = listSelectableModels()): string {
  return chooseDefaultModel(models, liveModelIds(loadModelCache(), "chat"), DEFAULT_CHAT_MODEL);
}

export function modeCatalogPayload(models: ChatModel[] = listCatalogModels()): {
  modes: RoutedModels<ChatModel> & {
    documents: ChatModel[];
    research: ChatModel[];
    presentations: ChatModel[];
  };
  defaults: ModeModelDefaults;
} {
  const routed = routeModelsByKind(models);
  const chatDefault = defaultSelectableModel(routed.chat);
  return {
    modes: {
      ...routed,
      documents: routed.chat,
      research: routed.chat,
      presentations: routed.chat,
    },
    defaults: resolveModeDefaults({
      chatIds: routed.chat.map((model) => model.id),
      imageIds: routed.image.map((model) => model.id),
      videoIds: routed.video.map((model) => model.id),
      chatDefault,
    }),
  };
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
  const registryPromise = refreshModelsDevRegistry();

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
      next.googleError = redactSecrets(
        error instanceof Error ? error.message : "Could not list Gemini models",
      );
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

  const registry = await registryPromise;
  for (const dialect of ["openai", "anthropic", "google", "volcengine"] as const) {
    if (next[dialect]) {
      next[dialect] = withContextLengths(next[dialect], registry);
    }
  }

  return saveModelCache(next);
}
