import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer sk-abc123-longerthantwentycharacters";
    const result = redactSecrets(input);
    expect(result).not.toContain("sk-abc123-longerthantwentycharacters");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts sk- style keys while preserving surrounding prompt text", () => {
    const input = "The key is sk-secret-key-value-here and the prompt says: answer me please";
    const result = redactSecrets(input);
    expect(result).not.toContain("sk-secret-key-value-here");
    expect(result).toContain("answer me please");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts sk-ant- Anthropic keys", () => {
    const input = "key=sk-ant-api03-verylongkeyvalue-AA";
    const result = redactSecrets(input);
    expect(result).not.toContain("sk-ant-api03-verylongkeyvalue-AA");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts tvly- Tavily API keys", () => {
    const input = "tvly-abc123xyz987-search-key";
    const result = redactSecrets(input);
    expect(result).not.toContain("tvly-abc123xyz987-search-key");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts AIza Google API keys", () => {
    const input = "google key: AIzaSyDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const result = redactSecrets(input);
    expect(result).not.toContain("AIzaSyDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts long base64-looking blobs (32+ chars)", () => {
    const blob = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";
    const input = `token=${blob} and normal text here`;
    const result = redactSecrets(input);
    expect(result).toContain("normal text here");
  });

  it("leaves normal text untouched", () => {
    const input = "Hello, world! This is a normal message without secrets.";
    const result = redactSecrets(input);
    expect(result).toBe(input);
  });

  it("handles empty string", () => {
    expect(redactSecrets("")).toBe("");
  });

  it("handles multiple secrets in one string", () => {
    const input = "openai=sk-key1-longvalue anthropic=sk-ant-key2-longvalue";
    const result = redactSecrets(input);
    expect(result).not.toContain("sk-key1-longvalue");
    expect(result).not.toContain("sk-ant-key2-longvalue");
  });
});
