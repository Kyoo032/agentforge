import { describe, expect, it } from "vitest";
import {
  DEFAULT_FALLBACK_CONTEXT,
  extractContextLength,
  familyContextLength,
  formatContextLength,
  lookupModelsDevContext,
  parseModelsDevRegistry,
  resolveContextLength,
  withContextLengths,
} from "./context-length";

describe("extractContextLength", () => {
  it("reads OpenAI-compat and Anthropic window fields, not max_tokens", () => {
    expect(extractContextLength({ id: "x", context_length: 131072 })).toBe(131072);
    expect(extractContextLength({ id: "x", max_model_len: 32768 })).toBe(32768);
    expect(extractContextLength({ id: "x", max_input_tokens: 1_000_000 })).toBe(1_000_000);
    expect(extractContextLength({ id: "x", inputTokenLimit: 1048576 })).toBe(1048576);
    expect(extractContextLength({ id: "x", max_tokens: 8192 })).toBeUndefined();
    expect(extractContextLength({ id: "x", context_length: 12 })).toBeUndefined();
  });

  it("reads models.dev limit.context and OpenRouter top_provider", () => {
    expect(extractContextLength({ limit: { context: 200000, output: 64000 } })).toBe(200000);
    expect(extractContextLength({ top_provider: { context_length: 262144 } })).toBe(262144);
  });
});

describe("familyContextLength", () => {
  it("matches longest family key", () => {
    expect(familyContextLength("deepseek-v4-pro")).toBe(1_000_000);
    expect(familyContextLength("openai/gpt-5.6-sol")).toBe(1_050_000);
    expect(familyContextLength("claude-sonnet-5")).toBe(1_000_000);
    expect(familyContextLength("unknown-model")).toBeUndefined();
  });
});

describe("models.dev lookup", () => {
  const registry = parseModelsDevRegistry({
    anthropic: {
      models: {
        "claude-sonnet-4": { limit: { context: 200000 } },
      },
    },
    deepseek: {
      models: {
        "deepseek-v4-pro": { limit: { context: 1000000 } },
      },
    },
  });

  it("parses a registry and finds by id or provider prefix", () => {
    expect(lookupModelsDevContext(registry, "deepseek-v4-pro")).toBe(1_000_000);
    expect(lookupModelsDevContext(registry, "anthropic/claude-sonnet-4")).toBe(200000);
    expect(lookupModelsDevContext(undefined, "deepseek-v4-pro")).toBeUndefined();
  });
});

describe("resolveContextLength", () => {
  it("prefers endpoint, then registry, then family, then 256k", () => {
    expect(resolveContextLength({ modelId: "x", endpoint: 64000 })).toEqual({ tokens: 64000, source: "endpoint" });
    expect(
      resolveContextLength({
        modelId: "claude-sonnet-4",
        registry: parseModelsDevRegistry({
          anthropic: { models: { "claude-sonnet-4": { limit: { context: 200000 } } } },
        }),
      }),
    ).toEqual({ tokens: 200000, source: "registry" });
    expect(resolveContextLength({ modelId: "kimi-k3" })).toEqual({ tokens: 1_048_576, source: "family" });
    expect(resolveContextLength({ modelId: "mystery-llm" })).toEqual({
      tokens: DEFAULT_FALLBACK_CONTEXT,
      source: "fallback",
    });
  });
});

describe("withContextLengths", () => {
  it("keeps an endpoint window and fills the rest", () => {
    const models = withContextLengths(
      [
        { id: "local-qwen", provider: "openai", contextLength: 64000, contextSource: "endpoint" as const },
        { id: "deepseek-v4-flash", provider: "openai" },
      ],
      parseModelsDevRegistry({
        deepseek: { models: { "deepseek-v4-flash": { limit: { context: 999999 } } } },
      }),
    );
    expect(models[0]).toMatchObject({ contextLength: 64000, contextSource: "endpoint" });
    expect(models[1]).toMatchObject({ contextLength: 999999, contextSource: "registry" });
  });
});

describe("formatContextLength", () => {
  it("renders compact window labels", () => {
    expect(formatContextLength(128000)).toBe("128K");
    expect(formatContextLength(1_000_000)).toBe("1M");
    expect(formatContextLength(1_050_000)).toBe("1.05M");
    expect(formatContextLength(256000)).toBe("256K");
  });
});
