import { describe, expect, it } from "vitest";
import {
  wrappingKeyFromSecret,
  encryptJson,
  decryptJson,
  isEnvelope,
  sealPayload,
  openPayload,
  type EncryptedEnvelope,
} from "./envelope";

describe("wrappingKeyFromSecret", () => {
  it("returns a 32-byte Buffer", () => {
    const key = wrappingKeyFromSecret("my-secret");
    expect(key).toBeInstanceOf(Buffer);
    expect(key.byteLength).toBe(32);
  });

  it("is deterministic — same input, same key", () => {
    const a = wrappingKeyFromSecret("stable-secret");
    const b = wrappingKeyFromSecret("stable-secret");
    expect(a.equals(b)).toBe(true);
  });

  it("different secrets produce different keys", () => {
    const a = wrappingKeyFromSecret("secret-a");
    const b = wrappingKeyFromSecret("secret-b");
    expect(a.equals(b)).toBe(false);
  });
});

describe("encryptJson / decryptJson", () => {
  const key = wrappingKeyFromSecret("test-key");

  it("round-trips a plain object", () => {
    const value = { hello: 1, nested: { arr: [1, 2, 3] } };
    const envelope = encryptJson(value, key);
    const result = decryptJson<typeof value>(envelope, key);
    expect(result).toEqual(value);
  });

  it("produces an envelope with the correct shape", () => {
    const envelope = encryptJson({ x: 1 }, key);
    expect(envelope.v).toBe(1);
    expect(envelope.alg).toBe("aes-256-gcm");
    expect(typeof envelope.n).toBe("string");
    expect(typeof envelope.ct).toBe("string");
    expect(typeof envelope.tag).toBe("string");
  });

  it("n is 16 chars (12-byte IV as base64)", () => {
    const envelope = encryptJson({ x: 1 }, key);
    const ivBytes = Buffer.from(envelope.n, "base64");
    expect(ivBytes.byteLength).toBe(12);
  });

  it("throws on tampered ciphertext", () => {
    const envelope = encryptJson({ secret: "value" }, key);
    const tampered: EncryptedEnvelope = { ...envelope, ct: "AAAA" + envelope.ct.slice(4) };
    expect(() => decryptJson(tampered, key)).toThrow();
  });

  it("throws on tampered auth tag", () => {
    const envelope = encryptJson({ secret: "value" }, key);
    const flipped = envelope.tag.split("").reverse().join("");
    const tampered: EncryptedEnvelope = { ...envelope, tag: flipped };
    expect(() => decryptJson(tampered, key)).toThrow();
  });

  it("throws when wrong key is used", () => {
    const wrongKey = wrappingKeyFromSecret("wrong-key");
    const envelope = encryptJson({ data: "sensitive" }, key);
    expect(() => decryptJson(envelope, wrongKey)).toThrow();
  });

  it("each encryption produces a unique nonce (fresh IV)", () => {
    const value = { x: 1 };
    const a = encryptJson(value, key);
    const b = encryptJson(value, key);
    expect(a.n).not.toBe(b.n);
  });
});

describe("isEnvelope", () => {
  const key = wrappingKeyFromSecret("test-key");

  it("returns true for a valid envelope", () => {
    const env = encryptJson({ a: 1 }, key);
    expect(isEnvelope(env)).toBe(true);
  });

  it("returns false for plain objects", () => {
    expect(isEnvelope({ hello: 1 })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope("string")).toBe(false);
    expect(isEnvelope(42)).toBe(false);
    expect(isEnvelope(undefined)).toBe(false);
  });

  it("returns false for objects missing required fields", () => {
    expect(isEnvelope({ v: 1 })).toBe(false);
    expect(isEnvelope({ v: 1, alg: "aes-256-gcm" })).toBe(false);
    expect(isEnvelope({ v: 2, alg: "aes-256-gcm", n: "x", ct: "y", tag: "z" })).toBe(false);
  });
});

describe("sealPayload / openPayload", () => {
  const key = wrappingKeyFromSecret("seal-key");

  it("round-trips through seal/open", () => {
    const value = { prompt: "Hello world", model: "gpt-4o" };
    const sealed = sealPayload(value, key);
    expect(isEnvelope(sealed)).toBe(true);
    const opened = openPayload<typeof value>(sealed, key);
    expect(opened).toEqual(value);
  });

  it("openPayload reads plaintext value as backward-compat", () => {
    const plaintext = { hello: 1 };
    const result = openPayload<typeof plaintext>(plaintext, key);
    expect(result).toEqual(plaintext);
  });

  it("openPayload handles a primitive plaintext string", () => {
    const result = openPayload<string>("plain text", key);
    expect(result).toBe("plain text");
  });
});
