import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it("removes every occurrence of every secret", () => {
    const text = "auth failed for key sk-abc123456789 (retry with sk-abc123456789)";
    expect(redactSecrets(text, ["sk-abc123456789"])).toBe(`auth failed for key ${REDACTED} (retry with ${REDACTED})`);
  });

  it("removes the api key, the gateway key and the jwt from one body", () => {
    const body = "apiKey=weknora-key-1234 gateway=sk-gateway-9876 jwt=eyJhbGciOiJIUzI1NiJ9.payload";
    const out = redactSecrets(body, ["weknora-key-1234", "sk-gateway-9876", "eyJhbGciOiJIUzI1NiJ9.payload"]);
    expect(out).not.toContain("weknora-key-1234");
    expect(out).not.toContain("sk-gateway-9876");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("does not leave the tail of a secret that contains another", () => {
    const out = redactSecrets("token=prefix-secret-tail", ["prefix-secret", "prefix-secret-tail"]);
    expect(out).toBe(`token=${REDACTED}`);
  });

  it("treats regex metacharacters as literal text", () => {
    expect(redactSecrets("key=a+b(c)d.e*f", ["a+b(c)d.e*f"])).toBe(`key=${REDACTED}`);
  });

  it("ignores empty, null and implausibly short secrets", () => {
    // Blind-replacing a three-character secret would redact half of every log line.
    expect(redactSecrets("the cat sat on the mat", ["", null, undefined, "cat"])).toBe("the cat sat on the mat");
  });

  it("returns the text unchanged when there is nothing to remove", () => {
    expect(redactSecrets("plain text", [])).toBe("plain text");
  });
});
