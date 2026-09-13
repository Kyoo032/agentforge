import { describe, expect, it } from "vitest";
import { applyCuration, curateModel, isEverydayModel } from "./curation";

describe("curateModel", () => {
  it("marks the routing-table everyday set", () => {
    const everydayIds = [
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "openai/gpt-5.6-luna",
      "claude-sonnet-5",
      "gemini-3.5-flash",
      "qwen3.7-plus",
      "MiniMax-M3",
      "minimax-m3",
      "doubao-seed-2-1-turbo-260628",
      "glm-5.3-flash",
    ];
    for (const id of everydayIds) {
      expect(curateModel(id).tier, id).toBe("everyday");
      expect(isEverydayModel(id), id).toBe(true);
    }
  });

  it("does not treat older or specialty brand cousins as everyday", () => {
    const advancedIds = [
      "gpt-4o-mini",
      "openai/gpt-4o-mini",
      "gpt-5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "claude-sonnet-4-6",
      "claude-opus-5",
      "claude-haiku-4-5",
      "gemini-2.5-flash",
      "gemini-3-pro",
      "gemini-embedding-001",
      "deepseek-v4-pro",
      "MiniMax-M2.1",
      "minimax-m2",
      "grok-3",
      "gpt-5.6-sol",
      "kimi-k3",
      "gemini-3-flash",
      "deepseek-v4-flash",
    ];
    for (const id of advancedIds) {
      expect(curateModel(id).tier, id).toBe("advanced");
      expect(isEverydayModel(id), id).toBe(false);
    }
  });

  it("marks obscure specialty ids as advanced", () => {
    const meta = curateModel("acme-quantum-embed-v9");
    expect(meta.tier).toBe("advanced");
    expect(isEverydayModel("acme-quantum-embed-v9")).toBe(false);
    expect(meta.bestFor).toBe("General chat");
  });

  it("strips vendor prefixes and dates from friendlyLabel", () => {
    expect(curateModel("openai/gpt-5.6-sol").friendlyLabel).toBe("GPT 5.6 Sol");
    expect(curateModel("claude-sonnet-5-20250514").friendlyLabel).toMatch(/Claude Sonnet 5/);
    expect(curateModel("deepseek-v4-flash").friendlyLabel).toBe("DeepSeek V4 Flash");
  });

  it("picks bestFor from the gateway catalog, not id keywords", () => {
    expect(curateModel("gpt-5.6-terra").bestFor).toBe("Everyday chat");
    expect(curateModel("gpt-5.6-sol").bestFor).toBe("Deep reasoning");
    expect(curateModel("gpt-5.6-luna").bestFor).toBe("Fast drafts");
    expect(curateModel("gemini-3.5-flash").bestFor).toBe("Everyday chat");
    expect(curateModel("MiniMax-M3").bestFor).toBe("Everyday chat");
    expect(curateModel("gpt-5.5-pro").bestFor).toBe("Deep reasoning");
    expect(curateModel("claude-haiku-4-5").bestFor).toBe("Fast drafts");
    expect(curateModel("unknown-lab-model").bestFor).toBe("General chat");
    // First Section 6 role can say Everyday chat without putting the id in the 1.1 set.
    expect(curateModel("claude-opus-5").bestFor).toBe("Everyday chat");
    expect(curateModel("claude-opus-5").tier).toBe("advanced");
  });
});

describe("applyCuration", () => {
  it("merges curation meta onto each model", () => {
    const curated = applyCuration([
      { id: "gpt-5.6-sol", provider: "openai" },
      { id: "weird-lab-model", provider: "custom" },
    ]);
    expect(curated).toHaveLength(2);
    expect(curated[0]).toMatchObject({
      id: "gpt-5.6-sol",
      provider: "openai",
      tier: "advanced",
      friendlyLabel: "GPT 5.6 Sol",
    });
    expect(curated[1]?.tier).toBe("advanced");
    expect(curated[1]?.id).toBe("weird-lab-model");
  });
});
