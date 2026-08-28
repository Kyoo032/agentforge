export type ContextSource = "endpoint" | "registry" | "family" | "fallback";

export type ModelsDevRegistry = Record<string, { models?: Record<string, unknown> }>;

export const DEFAULT_FALLBACK_CONTEXT = 256_000;

const CONTEXT_LENGTH_KEYS = [
  "context_length",
  "context_window",
  "context_size",
  "max_context_length",
  "max_position_embeddings",
  "max_model_len",
  "max_input_tokens",
  "inputTokenLimit",
  "input_token_limit",
  "max_sequence_length",
  "max_seq_len",
  "n_ctx_train",
  "n_ctx",
  "ctx_size",
] as const;

/** Longest key first. Copied from Hermes family fallbacks for gateway-relevant ids. */
const FAMILY_CONTEXT: Array<[string, number]> = [
  ["gpt-5.6-luna", 1_050_000],
  ["gpt-5.6-terra", 1_050_000],
  ["gpt-5.6-sol", 1_050_000],
  ["gpt-5.3-codex-spark", 128_000],
  ["deepseek-v4-flash", 1_000_000],
  ["deepseek-v4-pro", 1_000_000],
  ["claude-sonnet-4-6", 1_000_000],
  ["claude-sonnet-5", 1_000_000],
  ["claude-opus-4-8", 1_000_000],
  ["claude-opus-5", 1_000_000],
  ["claude-haiku-4-5", 200_000],
  ["gpt-5.4-nano", 400_000],
  ["gpt-5.4-mini", 400_000],
  ["minimax-m3", 1_000_000],
  ["gpt-5.4", 1_050_000],
  ["gpt-5.6", 1_050_000],
  ["gpt-5.5", 1_050_000],
  ["kimi-k3", 1_048_576],
  ["glm-5.3", 1_048_576],
  ["glm-5.2", 1_048_576],
  ["gemma-4", 256_000],
  ["gpt-4.1", 1_047_576],
  ["grok-4.6", 500_000],
  ["grok-4.5", 500_000],
  ["deepseek", 128_000],
  ["minimax", 204_800],
  ["gpt-4o", 128_000],
  ["gemini", 1_048_576],
  ["claude", 200_000],
  ["gpt-5", 400_000],
  ["gpt-4", 128_000],
  ["doubao", 256_000],
  ["gemma", 8_192],
  ["grok-4", 256_000],
  ["kimi", 262_144],
  ["qwen", 131_072],
  ["grok", 131_072],
  ["glm", 202_752],
];
FAMILY_CONTEXT.sort((a, b) => b[0].length - a[0].length);

export function coerceContextLength(value: unknown): number | undefined {
  try {
    if (typeof value === "boolean") {
      return undefined;
    }
    const raw = typeof value === "string" ? value.trim().replace(/,/g, "") : value;
    const result = Number(raw);
    if (!Number.isInteger(result)) {
      return undefined;
    }
    if (result < 1024 || result > 10_000_000) {
      return undefined;
    }
    return result;
  } catch {
    return undefined;
  }
}

function fromRecord(record: Record<string, unknown>): number | undefined {
  for (const key of CONTEXT_LENGTH_KEYS) {
    const found = coerceContextLength(record[key]);
    if (found) {
      return found;
    }
  }
  const limit = record.limit;
  if (limit && typeof limit === "object" && !Array.isArray(limit)) {
    const found = coerceContextLength((limit as Record<string, unknown>).context);
    if (found) {
      return found;
    }
  }
  const top = record.top_provider;
  if (top && typeof top === "object" && !Array.isArray(top)) {
    const found = coerceContextLength((top as Record<string, unknown>).context_length);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function extractContextLength(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  return fromRecord(payload as Record<string, unknown>);
}

export function parseModelsDevRegistry(body: unknown): ModelsDevRegistry | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const registry: ModelsDevRegistry = {};
  for (const [provider, value] of Object.entries(body as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const models = (value as { models?: unknown }).models;
    if (!models || typeof models !== "object" || Array.isArray(models)) {
      continue;
    }
    registry[provider] = { models: models as Record<string, unknown> };
  }
  return Object.keys(registry).length > 0 ? registry : undefined;
}

function contextFromEntry(entry: unknown): number | undefined {
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }
  return extractContextLength(entry);
}

function providerModels(registry: ModelsDevRegistry, provider: string): Record<string, unknown> | undefined {
  return registry[provider]?.models;
}

function lookupInProvider(models: Record<string, unknown>, modelId: string): number | undefined {
  const direct = contextFromEntry(models[modelId]);
  if (direct) {
    return direct;
  }
  const lower = modelId.toLowerCase();
  for (const [id, entry] of Object.entries(models)) {
    if (id.toLowerCase() === lower) {
      const found = contextFromEntry(entry);
      if (found) {
        return found;
      }
    }
  }
  for (const suffix of [":cloud", "-cloud"]) {
    const found = contextFromEntry(models[modelId + suffix]);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function lookupModelsDevContext(
  registry: ModelsDevRegistry | undefined,
  modelId: string,
  hintProvider?: string,
): number | undefined {
  if (!registry) {
    return undefined;
  }
  const id = modelId.startsWith("models/") ? modelId.slice("models/".length) : modelId;
  if (!id) {
    return undefined;
  }
  if (hintProvider) {
    const hinted = providerModels(registry, hintProvider);
    if (hinted) {
      const found = lookupInProvider(hinted, id);
      if (found) {
        return found;
      }
    }
  }
  const slash = id.indexOf("/");
  if (slash > 0) {
    const provider = id.slice(0, slash);
    const rest = id.slice(slash + 1);
    const models = providerModels(registry, provider);
    if (models) {
      const found = lookupInProvider(models, rest) ?? lookupInProvider(models, id);
      if (found) {
        return found;
      }
    }
  }
  for (const provider of Object.keys(registry)) {
    const models = providerModels(registry, provider);
    if (!models) {
      continue;
    }
    const found = lookupInProvider(models, id);
    if (found) {
      return found;
    }
  }
  const leaf = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  if (leaf !== id) {
    for (const provider of Object.keys(registry)) {
      const models = providerModels(registry, provider);
      if (!models) {
        continue;
      }
      const found = lookupInProvider(models, leaf);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

export function familyContextLength(modelId: string): number | undefined {
  const id = modelId.toLowerCase();
  const leaf = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  for (const [key, tokens] of FAMILY_CONTEXT) {
    if (id.includes(key) || leaf.includes(key)) {
      return tokens;
    }
  }
  return undefined;
}

export function resolveContextLength(input: {
  modelId: string;
  endpoint?: number;
  registry?: ModelsDevRegistry;
  hintProvider?: string;
}): { tokens: number; source: ContextSource } {
  if (input.endpoint) {
    return { tokens: input.endpoint, source: "endpoint" };
  }
  const fromRegistry = lookupModelsDevContext(input.registry, input.modelId, input.hintProvider);
  if (fromRegistry) {
    return { tokens: fromRegistry, source: "registry" };
  }
  const fromFamily = familyContextLength(input.modelId);
  if (fromFamily) {
    return { tokens: fromFamily, source: "family" };
  }
  return { tokens: DEFAULT_FALLBACK_CONTEXT, source: "fallback" };
}

export function withContextLengths<T extends { id: string; provider?: string; contextLength?: number; contextSource?: ContextSource }>(
  models: T[],
  registry?: ModelsDevRegistry,
): T[] {
  return models.map((model) => {
    const endpoint = model.contextSource === "endpoint" ? model.contextLength : undefined;
    const resolved = resolveContextLength({
      modelId: model.id,
      endpoint,
      registry,
      hintProvider: model.provider,
    });
    return { ...model, contextLength: resolved.tokens, contextSource: resolved.source };
  });
}

export function formatContextLength(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return Number.isInteger(millions) ? `${millions}M` : `${parseFloat(millions.toFixed(2))}M`;
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000;
    return Number.isInteger(thousands) ? `${thousands}K` : `${parseFloat(thousands.toFixed(1))}K`;
  }
  return String(tokens);
}
