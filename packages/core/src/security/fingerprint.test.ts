import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { keyFingerprint, keyFingerprintOrNull } from "./fingerprint";

function expectedFingerprint(secret: string): string {
  const hex = createHash("sha256").update(secret, "utf8").digest("hex");
  return `sha256:${hex.slice(0, 12)}`;
}

describe("keyFingerprint", () => {
  it("is deterministic — same input, same output", () => {
    expect(keyFingerprint("sk-test-key")).toBe(keyFingerprint("sk-test-key"));
    expect(keyFingerprint("sk-test-key")).toBe(expectedFingerprint("sk-test-key"));
  });

  it("formats as sha256: plus the first 12 hex chars", () => {
    const fp = keyFingerprint("sk-test-key");
    expect(fp).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(fp.startsWith("sha256:")).toBe(true);
    expect(fp.slice("sha256:".length)).toHaveLength(12);
  });

  it("trims before hashing so surrounding whitespace does not change the digest", () => {
    expect(keyFingerprint("  sk-test-key  ")).toBe(keyFingerprint("sk-test-key"));
  });

  it("returns different prefixes for different keys", () => {
    expect(keyFingerprint("sk-alpha")).not.toBe(keyFingerprint("sk-beta"));
  });

  it("returns an empty string for empty or whitespace-only input", () => {
    expect(keyFingerprint("")).toBe("");
    expect(keyFingerprint("   ")).toBe("");
    expect(keyFingerprint("\n\t")).toBe("");
  });
});

describe("keyFingerprintOrNull", () => {
  it("returns null when the secret is missing or blank", () => {
    expect(keyFingerprintOrNull(undefined)).toBeNull();
    expect(keyFingerprintOrNull("")).toBeNull();
    expect(keyFingerprintOrNull("  ")).toBeNull();
  });

  it("returns the same prefix as keyFingerprint when a secret is present", () => {
    expect(keyFingerprintOrNull("sk-test-key")).toBe(keyFingerprint("sk-test-key"));
  });
});
