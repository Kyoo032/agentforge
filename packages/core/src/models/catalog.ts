import { ApiError } from "../errors";
import type { InputModality } from "../tenancy/types";
import { INPUT_MODALITIES } from "../tenancy/types";
import { getModelModalities } from "./capabilities";
import { sortChatModels } from "./preferred";

export type ModelProvider = "openai" | "anthropic" | "google" | "volcengine";

export type ChatModel = {
  id: string;
  label: string;
  provider: ModelProvider;
  inputModalities: InputModality[];
};

function modalitiesFor(id: string): InputModality[] {
  const caps = getModelModalities(id);
  return INPUT_MODALITIES.filter((modality) => caps[modality]);
}

export function chatModelFromId(id: string, label: string, provider: ModelProvider): ChatModel {
  return { id, label, provider, inputModalities: modalitiesFor(id) };
}

function defineModel(id: string, label: string, provider: ModelProvider): ChatModel {
  return chatModelFromId(id, label, provider);
}

const OPENAI_MODELS: Array<[id: string, label: string]> = [
  ["deepseek-v4-pro", "DeepSeek V4 Pro"],
  ["deepseek-v4-flash", "DeepSeek V4 Flash"],
  ["kimi-k3", "Kimi K3"],
  ["glm-5.3", "GLM 5.3"],
  ["gpt-5.6-sol", "GPT-5.6 Sol"],
  ["gpt-5.6-terra", "GPT-5.6 Terra"],
  ["gpt-5.6-luna", "GPT-5.6 Luna"],
  ["gpt-5.5", "GPT-5.5"],
  ["gpt-5.5-pro", "GPT-5.5 Pro"],
  ["gpt-5.4", "GPT-5.4"],
  ["gpt-5.4-pro", "GPT-5.4 Pro"],
  ["gpt-5.4-mini", "GPT-5.4 mini"],
  ["gpt-5.4-nano", "GPT-5.4 nano"],
  ["gpt-5.3-codex", "GPT-5.3 Codex"],
  ["gpt-5.2", "GPT-5.2"],
  ["gpt-5.2-pro", "GPT-5.2 Pro"],
  ["gpt-5.1", "GPT-5.1"],
  ["gpt-5", "GPT-5"],
  ["gpt-5-pro", "GPT-5 Pro"],
  ["gpt-5-mini", "GPT-5 mini"],
  ["gpt-5-nano", "GPT-5 nano"],
  ["gpt-4.1", "GPT-4.1"],
  ["gpt-4.1-mini", "GPT-4.1 mini"],
  ["gpt-4.1-nano", "GPT-4.1 nano"],
  ["o3-pro", "o3-pro"],
  ["o3", "o3"],
  ["gpt-4o", "GPT-4o"],
  ["gpt-4o-mini", "GPT-4o mini"],
];

const GOOGLE_MODELS: Array<[id: string, label: string]> = [
  ["gemini-3.6-flash", "Gemini 3.6 Flash"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash"],
  ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"],
  ["gemini-3.1-pro-preview", "Gemini 3.1 Pro"],
  ["gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite"],
  ["gemini-3-flash-preview", "Gemini 3 Flash"],
  ["gemini-2.5-pro", "Gemini 2.5 Pro"],
  ["gemini-2.5-flash", "Gemini 2.5 Flash"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite"],
  ["gemini-2.0-flash", "Gemini 2.0 Flash"],
  ["gemma-4-31b-it", "Gemma 4 31B"],
  ["gemma-4-26b-a4b-it", "Gemma 4 26B"],
];

const ANTHROPIC_MODELS: Array<[id: string, label: string]> = [
  ["claude-sonnet-5", "Claude Sonnet 5"],
  ["claude-opus-5", "Claude Opus 5"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"],
  ["claude-sonnet-4-6", "Claude Sonnet 4.6"],
  ["claude-opus-4-8", "Claude Opus 4.8"],
];

const VOLCENGINE_MODELS: Array<[id: string, label: string]> = [
  ["doubao-seed-1-6-thinking", "Doubao Seed 1.6 Thinking"],
  ["doubao-seed-1-6-250615", "Doubao Seed 1.6"],
  ["doubao-seedance-2-0-260128", "Seedance 2.0 (video)"],
  ["doubao-seedance-2-0-fast-260128", "Seedance 2.0 Fast (video)"],
];

export const CHAT_MODELS: ChatModel[] = [
  ...OPENAI_MODELS.map(([id, label]) => defineModel(id, label, "openai")),
  ...ANTHROPIC_MODELS.map(([id, label]) => defineModel(id, label, "anthropic")),
  ...GOOGLE_MODELS.map(([id, label]) => defineModel(id, label, "google")),
  ...VOLCENGINE_MODELS.map(([id, label]) => defineModel(id, label, "volcengine")),
];

export function listChatModels(): ChatModel[] {
  return sortChatModels(CHAT_MODELS);
}

export function getChatModel(id: string, catalog: ChatModel[] = CHAT_MODELS): ChatModel | undefined {
  return catalog.find((model) => model.id === id);
}

function dedupeById(models: ChatModel[]): ChatModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) {
      return false;
    }
    seen.add(model.id);
    return true;
  });
}

export function mergeChatCatalog(live: Partial<Record<ModelProvider, ChatModel[]>>): ChatModel[] {
  const providers: ModelProvider[] = ["openai", "anthropic", "google", "volcengine"];
  return sortChatModels(
    dedupeById(
      providers.flatMap((provider) => {
        const probed = live[provider];
        if (probed && probed.length > 0) {
          return probed;
        }
        return CHAT_MODELS.filter((model) => model.provider === provider);
      }),
    ),
  );
}

export function resolveModelProvider(modelId: string, catalog: ChatModel[] = CHAT_MODELS): ModelProvider {
  const known = getChatModel(modelId, catalog);
  if (known) {
    return known.provider;
  }
  const id = modelId.toLowerCase();
  if (id.startsWith("claude")) {
    return "anthropic";
  }
  if (id.startsWith("gemini") || id.startsWith("gemma")) {
    return "google";
  }
  if (id.startsWith("doubao") || id.startsWith("seedance") || id.startsWith("ep-")) {
    return "volcengine";
  }
  return "openai";
}

export function isGoogleChatModel(modelId: string, catalog: ChatModel[] = CHAT_MODELS): boolean {
  return resolveModelProvider(modelId, catalog) === "google";
}

export function resolveChatModel(
  requested: string | undefined,
  fallback: string,
  catalog: ChatModel[] = CHAT_MODELS,
): string {
  if (!requested) {
    return fallback;
  }
  const model = getChatModel(requested, catalog);
  if (!model) {
    throw new ApiError("unknown_model", `Model '${requested}' is not available`, 400);
  }
  return model.id;
}

export function readOptionalModel(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const model = (body as { model?: unknown }).model;
  if (model === undefined) {
    return undefined;
  }
  if (typeof model !== "string" || model.trim().length === 0) {
    throw new ApiError("unknown_model", "model must be a non-empty string", 400);
  }
  return model;
}

export function intersectModalities(agent: InputModality[], model: InputModality[]): InputModality[] {
  return INPUT_MODALITIES.filter((modality) => agent.includes(modality) && model.includes(modality));
}
