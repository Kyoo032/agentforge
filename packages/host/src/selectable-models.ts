import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  applyCuration,
  chooseDefaultModel,
  detectCompatibleApi,
  isEmbeddingModelId,
  isMusicModelId,
  isSpeechModelId,
  mediaKind,
  mergeChatCatalog,
  probeAnthropicModels,
  probeGoogleModels,
  probeVolcengineModels,
  redactSecrets,
  resolveModeDefaults,
  resolveProviderKeys,
  resolvedGatewayBaseUrl,
  routeModelsByKind,
  sortChatModels,
  withContextLengths,
  type ChatModel,
  type CuratedModelMeta,
  type ModeModelDefaults,
  type ModelProvider,
  type RoutedModels,
  type StoredSecrets,
} from "@agentforge/core";
import { loadModelCache, modelCacheStamp, saveModelCache, type ModelCache } from "./model-cache";
import { loadModelsDevRegistry, modelsDevCacheStamp, refreshModelsDevRegistry } from "./models-dev-cache";

/** Catalog model with picker curation fields for API payloads. */
export type SelectableModel = ChatModel & CuratedModelMeta;

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

let catalogMemo: { key: string; models: ChatModel[] } | null = null;

/**
 * Merged catalog with context lengths. Building it costs ~230 ms of synchronous work (every model ×
 * the models.dev registry) and it was rebuilt on every Chat run and every knowledge lookup, which
 * serialised all requests. Memoized on the two cache files' mtime/size, so a probe or registry refresh
 * (both rewrite their file) invalidates it without any explicit hook.
 */
export function listCatalogModels(): ChatModel[] {
  const key = `${modelCacheStamp()}|${modelsDevCacheStamp()}`;
  if (catalogMemo && catalogMemo.key === key) {
    return catalogMemo.models;
  }
  const cache = loadModelCache();
  const models = withContextLengths(
    mergeChatCatalog({
      openai: cache.openai,
      anthropic: cache.anthropic,
      google: cache.google,
      volcengine: cache.volcengine,
    }),
    loadModelsDevRegistry(),
  );
  catalogMemo = { key, models };
  return models;
}

/** Test hook: drop the memoized catalog. */
export function resetCatalogMemo(): void {
  catalogMemo = null;
}

export function listRoutedModels(models: ChatModel[] = listCatalogModels()): RoutedModels<ChatModel> {
  return routeModelsByKind(models);
}

export function listSelectableModels(): SelectableModel[] {
  return applyCuration(listRoutedModels().chat);
}

export function listImageModels(): ChatModel[] {
  return listRoutedModels().image;
}

export function listVideoModels(): ChatModel[] {
  return listRoutedModels().video;
}

/**
 * The audio catalog, split by what each id can actually do. `routeModelsByKind` lumps music, lyrics,
 * TTS and ASR into one `audio` bucket, which is the right shape for the picker but the wrong shape
 * for a studio: a song request sent to a transcriber bills the desk and returns nothing.
 */
export function listAudioModels(): ChatModel[] {
  return listRoutedModels().audio;
}

export function listMusicModels(): ChatModel[] {
  return listAudioModels().filter((model) => isMusicModelId(model.id));
}

/** Non-realtime text-to-speech only; empty on this gateway today. */
export function listSpeechModels(): ChatModel[] {
  return listAudioModels().filter((model) => isSpeechModelId(model.id));
}

/** Embedding ids are never curated — PICKER_HIDE strips them from chat. */
export function listEmbeddingModels(models: ChatModel[] = listCatalogModels()): ChatModel[] {
  const embeddings = models.filter((model) => isEmbeddingModelId(model.id));
  if (embeddings.length > 0) {
    return embeddings;
  }
  return [
    {
      id: DEFAULT_EMBEDDING_MODEL,
      label: DEFAULT_EMBEDDING_MODEL,
      provider: "openai",
      inputModalities: ["text"],
    },
  ];
}

export function defaultSelectableModel(models: Array<{ id: string }> = listSelectableModels()): string {
  return chooseDefaultModel(models, liveModelIds(loadModelCache(), "chat"), DEFAULT_CHAT_MODEL);
}

function curateRouted(routed: RoutedModels<ChatModel>): RoutedModels<SelectableModel> {
  return {
    chat: applyCuration(sortChatModels(routed.chat)),
    image: applyCuration(routed.image),
    video: applyCuration(routed.video),
    audio: applyCuration(routed.audio),
    other: applyCuration(routed.other),
  };
}

export function modeCatalogPayload(models: ChatModel[] = listCatalogModels()): {
  modes: RoutedModels<SelectableModel> & {
    documents: SelectableModel[];
    research: SelectableModel[];
    presentations: SelectableModel[];
    finance: SelectableModel[];
    data: SelectableModel[];
    market: SelectableModel[];
    legal: SelectableModel[];
    music: SelectableModel[];
    embedding: ChatModel[];
  };
  defaults: ModeModelDefaults;
} {
  const routed = routeModelsByKind(models);
  const curated = curateRouted(routed);
  const embedding = listEmbeddingModels(models);
  const chatDefault = defaultSelectableModel(curated.chat);
  return {
    modes: {
      ...curated,
      documents: curated.chat,
      research: curated.chat,
      presentations: curated.chat,
      finance: curated.chat,
      data: curated.chat,
      market: curated.chat,
      legal: curated.chat,
      music: curated.audio.filter((model) => isMusicModelId(model.id)),
      embedding,
    },
    defaults: resolveModeDefaults({
      chatIds: curated.chat.map((model) => model.id),
      imageIds: curated.image.map((model) => model.id),
      videoIds: curated.video.map((model) => model.id),
      musicIds: curated.audio.map((model) => model.id),
      embeddingIds: embedding.map((model) => model.id),
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

export type RefreshModelCacheOptions = {
  /** Re-download the models.dev registry even if the weekly cache is fresh (user pressed Refresh). */
  forceRegistry?: boolean;
};

/**
 * A base URL other than the pinned gateway. Since the endpoint is pinned this is now always false;
 * it stays as the one place that would have to change if a second endpoint were ever allowed.
 */
function hasCustomGateway(settings: StoredSecrets): boolean {
  const base = resolveProviderKeys(settings).openaiBaseUrl?.trim();
  return Boolean(base) && base !== resolvedGatewayBaseUrl();
}

export async function refreshModelCache(
  settings: StoredSecrets,
  options: RefreshModelCacheOptions = {},
): Promise<ModelCache> {
  const current = loadModelCache();
  const next: ModelCache = { ...current };
  const now = new Date().toISOString();
  const registryPromise = refreshModelsDevRegistry(fetch, { force: options.forceRegistry === true });

  // Stub desks (no key, default gateway) never call out: there is nothing to list.
  if (settings.openaiApiKey || hasCustomGateway(settings)) {
    try {
      const detected = await detectCompatibleApi({
        url: resolveProviderKeys(settings).openaiBaseUrl || DEFAULT_OPENAI_BASE_URL,
        apiKey: settings.openaiApiKey,
      });
      putModels(next, detected.dialect, detected.models, now);
      next.detectedDialect = detected.dialect;
    } catch (error) {
      next.openaiError = redactSecrets(
        error instanceof Error ? error.message : "Could not list models from the gateway",
      );
    }
  } else {
    // Key cleared: a stale "unreachable" banner from the last live save must not survive into stub.
    delete next.openaiError;
    delete next.detectedDialect;
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
