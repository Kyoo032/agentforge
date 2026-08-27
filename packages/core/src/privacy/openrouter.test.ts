import { describe, expect, it } from "vitest";
import { isOpenRouterBaseUrl, openRouterZdrBody } from "./openrouter";

describe("isOpenRouterBaseUrl", () => {
  it("returns true for openrouter.ai URLs", () => {
    expect(isOpenRouterBaseUrl("https://openrouter.ai/api/v1")).toBe(true);
    expect(isOpenRouterBaseUrl("https://openrouter.ai/api/v1/")).toBe(true);
    expect(isOpenRouterBaseUrl("https://openrouter.ai")).toBe(true);
  });

  it("returns false for Toko Token gateway", () => {
    expect(isOpenRouterBaseUrl("https://api.tokotokenai.com/v1")).toBe(false);
  });

  it("returns false for OpenAI", () => {
    expect(isOpenRouterBaseUrl("https://api.openai.com/v1")).toBe(false);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isOpenRouterBaseUrl(null)).toBe(false);
    expect(isOpenRouterBaseUrl(undefined)).toBe(false);
    expect(isOpenRouterBaseUrl("")).toBe(false);
  });

  it("returns false for loopback Ollama endpoint", () => {
    expect(isOpenRouterBaseUrl("http://127.0.0.1:11434/v1")).toBe(false);
  });
});

describe("openRouterZdrBody", () => {
  it("returns ZDR object for openrouter.ai", () => {
    const body = openRouterZdrBody("https://openrouter.ai/api/v1");
    expect(body).toEqual({ provider: { zdr: true } });
  });

  it("returns undefined for Toko Token", () => {
    expect(openRouterZdrBody("https://api.tokotokenai.com/v1")).toBeUndefined();
  });

  it("returns undefined for null/undefined", () => {
    expect(openRouterZdrBody(null)).toBeUndefined();
    expect(openRouterZdrBody(undefined)).toBeUndefined();
    expect(openRouterZdrBody("")).toBeUndefined();
  });

  it("returns undefined for official openai.com", () => {
    expect(openRouterZdrBody("https://api.openai.com/v1")).toBeUndefined();
  });
});
