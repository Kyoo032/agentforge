import { describe, expect, it } from "vitest";
import {
  enhanceSystemPrompt,
  enhanceUserPrompt,
  isEnhanceSurface,
  stubEnhancePrompt,
  stripWrappingQuotes,
} from "./enhance-prompt";

describe("enhance-prompt", () => {
  it("accepts known surfaces", () => {
    expect(isEnhanceSurface("chat")).toBe(true);
    expect(isEnhanceSurface("finance")).toBe(true);
    expect(isEnhanceSurface("legal")).toBe(true);
    expect(isEnhanceSurface("agents")).toBe(false);
  });

  it("strips wrapping quotes and labels", () => {
    expect(stripWrappingQuotes('"hello"')).toBe("hello");
    expect(stripWrappingQuotes("Enhanced prompt: do the thing")).toBe("do the thing");
  });

  it("stub rewrite is non-empty, keeps language, and has no preface", () => {
    const out = stubEnhancePrompt("Summarize this memo.", "documents");
    expect(out.length).toBeGreaterThan("Summarize this memo".length);
    expect(out).not.toMatch(/Enhanced prompt/i);
    expect(out.startsWith("Summarize this memo")).toBe(true);
  });

  it("stub chat enhance follows Bahasa Indonesia when locale is id", () => {
    const out = stubEnhancePrompt("Ringkas memo ini", "chat", "id");
    expect(out).toMatch(/Anda/);
    expect(out).not.toMatch(/State the goal/);
  });

  it("stub documents enhance follows Bahasa Indonesia when locale is id", () => {
    const out = stubEnhancePrompt("Summarize this memo.", "documents", "id");
    expect(out).toMatch(/audiens/);
    expect(out).not.toMatch(/Name the audience/);
  });

  it("system and user enhance prompts instruct Bahasa Indonesia for every surface when locale is id", () => {
    expect(enhanceSystemPrompt("documents", "id")).toMatch(/Bahasa Indonesia/);
    expect(enhanceSystemPrompt("research", "en")).toMatch(/same language as the user's input/);
    expect(enhanceUserPrompt("Write a brief", "id")).toMatch(/Bahasa Indonesia/);
    expect(enhanceUserPrompt("请解释", "en")).toContain("请解释");
  });

  it("user template substitutes the draft", () => {
    expect(enhanceUserPrompt("请解释")).toContain("请解释");
  });
});
