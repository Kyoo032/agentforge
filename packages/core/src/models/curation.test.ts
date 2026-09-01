import { describe, expect, it } from "vitest";
import { applyCuration, curateModel, isEverydayModel } from "./curation";

describe("curateModel", () => {
  it("marks well-known chat families as everyday", () => {
    const everydayIds = [
      "gpt-5.6-sol",
      "claude-sonnet-5",
      "gemini-2.5-flash",
      "deepseek-v4-flash",
      "kimi-k3",
      "grok-4.5",
      "MiniMax-M2.1",
      "openai/gpt-4o-mini",
    ];
    for (const id of everydayIds) {
      expect(curateModel(id).tier, id).toBe("everyday");
      expect(isEverydayModel(id), id).toBe(true);
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
