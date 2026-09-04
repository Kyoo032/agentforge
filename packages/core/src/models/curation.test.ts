import { describe, expect, it } from "vitest";
import { applyCuration, curateModel, isEverydayModel } from "./curation";

describe("curateModel", () => {
  it("marks generation-locked chat families as everyday", () => {
    const everydayIds = [
      "gpt-5.6-sol",
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "openai/gpt-5.6-luna",
      "claude-sonnet-5",
      "gemini-3-flash",
      "gemini-3.5-flash",
      "gemini-3.6-flash",
      "gemini-3-lite",
      "deepseek-v4-flash",
      "kimi-k3",
      "grok-4",
      "grok-4.5",
      "grok-4.6",
      "MiniMax-M3",
      "minimax-m3",
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
      "o3",
      "kimi-k2.6",
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

  it("picks bestFor from simple id heuristics", () => {
    expect(curateModel("gpt-5.6-sol").bestFor).toBe("Everyday chat");
    expect(curateModel("deepseek-coder-v2").bestFor).toBe("Coding");
    expect(curateModel("claude-haiku-4").bestFor).toBe("Fast drafts");
    expect(curateModel("gemini-1.5-pro-long").bestFor).toBe("Long documents");
    expect(curateModel("o3").bestFor).toBe("Deep reasoning");
    expect(curateModel("minimax-m3").bestFor).toBe("Deep reasoning");
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
      tier: "everyday",
      friendlyLabel: "GPT 5.6 Sol",
    });
    expect(curated[1]?.tier).toBe("advanced");
    expect(curated[1]?.id).toBe("weird-lab-model");
  });
});
