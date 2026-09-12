import { describe, expect, it } from "vitest";
import {
  openaiCompatProviderOptions,
  preferredOpenAiWire,
  shouldFallbackFromResponses,
  shouldUpgradeToResponses,
  usesResponsesApi,
} from "./api-mode";

describe("usesResponsesApi", () => {
  it("matches Hermes/OpenCode: GPT-5+ except gpt-5-mini, plus o-series", () => {
    expect(usesResponsesApi("gpt-5.6-sol")).toBe(true);
    expect(usesResponsesApi("gpt-5.6-luna")).toBe(true);
    expect(usesResponsesApi("openai/gpt-5")).toBe(true);
    expect(usesResponsesApi("gpt-5-mini")).toBe(false);
    expect(usesResponsesApi("gpt-4o-mini")).toBe(false);
    expect(usesResponsesApi("o3")).toBe(true);
    expect(usesResponsesApi("deepseek-v4-pro")).toBe(false);
    expect(usesResponsesApi("claude-sonnet-5")).toBe(false);
  });
});

describe("preferredOpenAiWire", () => {
  it("sends GPT-5.6 on Responses even for a custom gateway", () => {
    expect(preferredOpenAiWire("gpt-5.6-sol")).toBe("responses");
    expect(preferredOpenAiWire("deepseek-v4-pro")).toBe("chat_completions");
  });
});

describe("wire fallbacks", () => {
  it("upgrades chat-completions tool errors to Responses", () => {
    expect(
      shouldUpgradeToResponses(
        "Function tools with reasoning_effort are not supported for gpt-5.6-sol in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
      ),
    ).toBe(true);
  });

  it("falls back when a gateway has no /responses route", () => {
    expect(shouldFallbackFromResponses("404 Not Found")).toBe(true);
    expect(shouldFallbackFromResponses("No available channel for model gpt-5.6-sol")).toBe(false);
  });

  it("falls back when Responses rejects a non-strict tool schema", () => {
    expect(
      shouldFallbackFromResponses(
        "Invalid schema for function 'datetime': In context=(), 'required' is required to be supplied and to be an array including every key in properties. Missing 'timezone'.",
      ),
    ).toBe(true);
  });
});

describe("openaiCompatProviderOptions", () => {
  it("matches Hermes: Responses tools are not strict", () => {
    expect(openaiCompatProviderOptions({ responses: true })).toEqual({
      openai: {
        strictSchemas: false,
        reasoningEffort: "medium",
        reasoningSummary: "auto",
      },
    });
  });

  it("sends the chosen effort on chat completions", () => {
    expect(openaiCompatProviderOptions({ reasoningEffort: "ultra" })).toEqual({
      openai: { reasoningEffort: "ultra" },
    });
    expect(openaiCompatProviderOptions({ reasoningEffort: "max" })).toEqual({
      openai: { reasoningEffort: "max" },
    });
    expect(openaiCompatProviderOptions({ reasoningEffort: "xhigh" })).toEqual({
      openai: { reasoningEffort: "xhigh" },
    });
  });

  it("keeps ultra and max on Toko Responses", () => {
    expect(openaiCompatProviderOptions({ responses: true, reasoningEffort: "ultra" })).toEqual({
      openai: {
        strictSchemas: false,
        reasoningEffort: "ultra",
        reasoningSummary: "auto",
      },
    });
    expect(openaiCompatProviderOptions({ responses: true, reasoningEffort: "max" })).toEqual({
      openai: {
        strictSchemas: false,
        reasoningEffort: "max",
        reasoningSummary: "auto",
      },
    });
  });

  it("maps ultra to xhigh only on official OpenAI Responses, not max", () => {
    expect(
      openaiCompatProviderOptions({
        responses: true,
        officialOpenAI: true,
        reasoningEffort: "ultra",
      }),
    ).toEqual({
      openai: {
        strictSchemas: false,
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
      },
    });
    expect(
      openaiCompatProviderOptions({
        responses: true,
        officialOpenAI: true,
        reasoningEffort: "max",
      }),
    ).toEqual({
      openai: {
        strictSchemas: false,
        reasoningEffort: "max",
        reasoningSummary: "auto",
      },
    });
  });

  it("forces none when thinking is off", () => {
    expect(openaiCompatProviderOptions({ forceReasoningNone: true, reasoningEffort: "high" })).toEqual({
      openai: { reasoningEffort: "none" },
    });
  });
});
