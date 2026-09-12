import { describe, expect, it } from "vitest";
import { applyReasoningEffortToChatBody } from "../models/reasoning-effort";
import {
  applyAnthropicMessagesBody,
  applyGeminiGenerateContentBody,
  resolveChatWire,
} from "./chat-wire";
import { snapReasoningEffort } from "./effort-allowlist";

describe("snapReasoningEffort", () => {
  it("lifts GPT-6 Off to low", () => {
    expect(snapReasoningEffort("gpt-6-astra", "none")).toBe("low");
    expect(snapReasoningEffort("gpt-6", "none", { wire: "responses" })).toBe("low");
    expect(snapReasoningEffort("gpt-6-astra", "none", { wire: "chat_completions" })).toBe("low");
  });

  it("snaps Claude Ultra to max on Messages and keeps max", () => {
    expect(snapReasoningEffort("claude-sonnet-5", "ultra")).toBe("max");
    expect(snapReasoningEffort("claude-opus-5", "ultra", { wire: "anthropic_messages" })).toBe("max");
    expect(snapReasoningEffort("claude-sonnet-4-6", "max")).toBe("max");
    expect(snapReasoningEffort("claude-sonnet-5", "none")).toBe("none");
  });

  it("snaps official OpenAI Completions and Responses Ultra to max, not xhigh", () => {
    expect(snapReasoningEffort("gpt-5.6-sol", "ultra", { wire: "responses", officialOpenAI: true })).toBe("max");
    expect(snapReasoningEffort("gpt-5.6-luna", "ultra", { wire: "chat_completions", officialOpenAI: true })).toBe(
      "max",
    );
    expect(snapReasoningEffort("o3", "ultra", { wire: "responses", officialOpenAI: true })).toBe("max");
    expect(snapReasoningEffort("gpt-5.6-sol", "max", { wire: "responses", officialOpenAI: true })).toBe("max");
    expect(snapReasoningEffort("gpt-5.6-luna", "none", { wire: "responses", officialOpenAI: true })).toBe("none");
  });

  it("keeps Toko Completions Ultra as ultra", () => {
    expect(snapReasoningEffort("deepseek-v4-flash", "ultra")).toBe("ultra");
    expect(snapReasoningEffort("kimi-k3", "ultra", { wire: "chat_completions" })).toBe("ultra");
    expect(snapReasoningEffort("glm-5.3", "max", { wire: "chat_completions" })).toBe("max");
    expect(snapReasoningEffort("glm-5.3", "xhigh", { wire: "chat_completions" })).toBe("xhigh");
  });

  it("snaps Gemini Extra/Max/Ultra to Deep and keeps Off", () => {
    expect(snapReasoningEffort("gemini-3.5-flash", "none")).toBe("none");
    expect(snapReasoningEffort("gemini-3.5-flash", "high")).toBe("high");
    expect(snapReasoningEffort("gemini-3.6-flash", "ultra")).toBe("high");
    expect(snapReasoningEffort("gemini-2.5-pro", "max")).toBe("high");
  });

  it("does not re-snap after a 404 fallback to Completions", () => {
    const snapped = snapReasoningEffort("claude-sonnet-5", "ultra", { wire: "anthropic_messages" });
    expect(snapped).toBe("max");
    expect(applyReasoningEffortToChatBody({ model: "claude-sonnet-5" }, snapped)).toEqual({
      model: "claude-sonnet-5",
      reasoning_effort: "max",
    });
    expect(resolveChatWire("auto", "claude-sonnet-5")).toBe("anthropic_messages");
  });
});

describe("snap then wire bodies", () => {
  it("sends Messages Ultra as output_config.effort max", () => {
    const snapped = snapReasoningEffort("claude-sonnet-5", "ultra");
    const body = applyAnthropicMessagesBody({ model: "claude-sonnet-5", messages: [] }, snapped) as Record<
      string,
      unknown
    >;
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "max" });
  });

  it("sends Gemini Off vs Deep on thinkingConfig", () => {
    const off = applyGeminiGenerateContentBody({ model: "gemini-3.5-flash" }, "none") as Record<string, unknown>;
    expect(off.generationConfig).toEqual({
      thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
    });
    expect(JSON.stringify(off)).not.toContain("reasoning_effort");
    const deep = applyGeminiGenerateContentBody(
      { model: "gemini-3.5-flash" },
      snapReasoningEffort("gemini-3.5-flash", "high"),
    ) as Record<string, unknown>;
    expect(deep.generationConfig).toEqual({
      thinkingConfig: { thinkingBudget: 8192, includeThoughts: true },
    });
  });
});
