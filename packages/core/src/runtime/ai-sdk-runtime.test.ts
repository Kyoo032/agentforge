import { describe, expect, it } from "vitest";
import { mergeOpenRouterZdr } from "./ai-sdk-runtime";

describe("mergeOpenRouterZdr", () => {
  it("adds provider.zdr for openrouter.ai base URL", () => {
    const body = { model: "openai/gpt-4o", messages: [] };
    const result = mergeOpenRouterZdr(body, "https://openrouter.ai/api/v1");
    expect(result).toEqual({
      model: "openai/gpt-4o",
      messages: [],
      provider: { zdr: true },
    });
  });

  it("does not overwrite existing provider keys when merging for openrouter.ai", () => {
    const body = { model: "x", provider: { route: "fallback" } };
    const result = mergeOpenRouterZdr(body, "https://openrouter.ai/api/v1");
    expect(result).toEqual({
      model: "x",
      provider: { route: "fallback", zdr: true },
    });
  });

  it("returns the body unchanged for Toko Token", () => {
    const body = { model: "gpt-4o", messages: [] };
    const result = mergeOpenRouterZdr(body, "https://api.tokotokenai.com/v1");
    expect(result).toEqual(body);
    expect(result).toBe(body);
  });

  it("returns the body unchanged for official openai.com", () => {
    const body = { model: "gpt-4o", messages: [] };
    const result = mergeOpenRouterZdr(body, "https://api.openai.com/v1");
    expect(result).toEqual(body);
    expect(result).toBe(body);
  });

  it("returns body unchanged when baseUrl is empty or undefined", () => {
    const body = { model: "x" };
    expect(mergeOpenRouterZdr(body, "")).toBe(body);
  });

  it("handles non-object bodies by returning them untouched", () => {
    expect(mergeOpenRouterZdr("raw-string", "https://openrouter.ai/api/v1")).toBe("raw-string");
    expect(mergeOpenRouterZdr(null, "https://openrouter.ai/api/v1")).toBe(null);
  });
});
