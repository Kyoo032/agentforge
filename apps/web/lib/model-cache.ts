import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ChatModel, ModelProvider } from "@agentforge/core";

export type ModelCache = {
  openai?: ChatModel[];
  anthropic?: ChatModel[];
  google?: ChatModel[];
  volcengine?: ChatModel[];
  openaiProbedAt?: string;
  anthropicProbedAt?: string;
  googleProbedAt?: string;
  volcengineProbedAt?: string;
  openaiError?: string;
  anthropicError?: string;
  googleError?: string;
  volcengineError?: string;
  detectedDialect?: ModelProvider;
};

function cachePath(): string {
  if (process.env.AGENTFORGE_MODELS_CACHE_PATH) {
    return process.env.AGENTFORGE_MODELS_CACHE_PATH;
  }
  return resolve(process.cwd(), "../../data/models-cache.json");
}

function asModels(value: unknown): ChatModel[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const models = value.filter((item): item is ChatModel => {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const model = item as ChatModel;
    if (typeof model.id !== "string" || typeof model.label !== "string" || !Array.isArray(model.inputModalities)) {
      return false;
    }
    if (model.contextLength !== undefined && (typeof model.contextLength !== "number" || model.contextLength < 1024)) {
      delete (model as { contextLength?: number }).contextLength;
      delete (model as { contextSource?: string }).contextSource;
    }
    return true;
  });
  return models.length > 0 ? models : undefined;
}

export function loadModelCache(): ModelCache {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8")) as ModelCache;
    return {
      openai: asModels(parsed.openai),
      anthropic: asModels(parsed.anthropic),
      google: asModels(parsed.google),
      volcengine: asModels(parsed.volcengine),
      openaiProbedAt: typeof parsed.openaiProbedAt === "string" ? parsed.openaiProbedAt : undefined,
      anthropicProbedAt: typeof parsed.anthropicProbedAt === "string" ? parsed.anthropicProbedAt : undefined,
      googleProbedAt: typeof parsed.googleProbedAt === "string" ? parsed.googleProbedAt : undefined,
      volcengineProbedAt: typeof parsed.volcengineProbedAt === "string" ? parsed.volcengineProbedAt : undefined,
      openaiError: typeof parsed.openaiError === "string" ? parsed.openaiError : undefined,
      anthropicError: typeof parsed.anthropicError === "string" ? parsed.anthropicError : undefined,
      googleError: typeof parsed.googleError === "string" ? parsed.googleError : undefined,
      volcengineError: typeof parsed.volcengineError === "string" ? parsed.volcengineError : undefined,
      detectedDialect: parsed.detectedDialect,
    };
  } catch {
    return {};
  }
}

export function saveModelCache(cache: ModelCache): ModelCache {
  const file = cachePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  return cache;
}

export function probeSummary(cache = loadModelCache()) {
  return {
    openaiCount: cache.openai?.length ?? 0,
    anthropicCount: cache.anthropic?.length ?? 0,
    googleCount: cache.google?.length ?? 0,
    volcengineCount: cache.volcengine?.length ?? 0,
    openaiError: cache.openaiError,
    anthropicError: cache.anthropicError,
    googleError: cache.googleError,
    volcengineError: cache.volcengineError,
    detectedDialect: cache.detectedDialect,
  };
}
