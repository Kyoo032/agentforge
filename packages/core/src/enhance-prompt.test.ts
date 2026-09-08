import { describe, expect, it } from "vitest";
import {
  isEnhanceSurface,
  stubEnhancePrompt,
  stripWrappingQuotes,
  enhanceUserPrompt,
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

  it("user template substitutes the draft", () => {
    expect(enhanceUserPrompt("请解释")).toContain("请解释");
  });
});
