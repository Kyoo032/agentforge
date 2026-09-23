/**
 * The portal refresh token at rest (./session-secrets.ts).
 *
 * Owner decision, 2026-09-23: store the refresh token encrypted so a restart or a deploy signs
 * nobody out. What this file pins is what "encrypted" has to mean here:
 *   - the key is not the wrap key itself but one derived from it for this purpose alone
 *     (HKDF-SHA256, info `auth-session-refresh-v1`), so a leak of one purpose's key opens nothing
 *     else sealed under the wrap key;
 *   - the stored string never carries the token in the clear;
 *   - a blob opens only as the session it was sealed for, and only under the key it was sealed with;
 *   - anything that does not open is `null`, never an exception, so the caller can end the session
 *     cleanly instead of crashing a request.
 */
import { createHash, hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptJson, isEnvelope } from "@agentforge/core";
import {
  REFRESH_SEALING_INFO,
  createSessionSecrets,
  openRefresh,
  refreshSealingKey,
  sealRefresh,
} from "./session-secrets";
import { hashSessionId } from "./session";

/** Two wrap keys, shaped the way `getLocalVaultKey` hands them out: SHA-256 of the secret. */
const WRAP = createHash("sha256").update("wrap-key-one", "utf8").digest();
const OTHER_WRAP = createHash("sha256").update("wrap-key-two", "utf8").digest();

const SESSION = "cookie-id-of-this-browser";
const SESSION_HASH = hashSessionId(SESSION);
const TOKENS = { refreshToken: "refresh-token-secret-value", deviceId: "dev_1" } as const;

describe("refreshSealingKey", () => {
  it("is HKDF-SHA256 of the wrap key, info auth-session-refresh-v1, 32 bytes", () => {
    expect(REFRESH_SEALING_INFO).toBe("auth-session-refresh-v1");
    const expected = Buffer.from(hkdfSync("sha256", WRAP, Buffer.alloc(0), "auth-session-refresh-v1", 32));
    expect(refreshSealingKey(WRAP).equals(expected)).toBe(true);
    expect(refreshSealingKey(WRAP)).toHaveLength(32);
  });

  it("is neither the wrap key nor the key another purpose would derive from it", () => {
    const derived = refreshSealingKey(WRAP);
    expect(derived.equals(WRAP)).toBe(false);
    const sessionV1 = Buffer.from(hkdfSync("sha256", WRAP, Buffer.alloc(0), "session-v1", 32));
    expect(derived.equals(sessionV1)).toBe(false);
  });

  it("changes with the wrap key", () => {
    expect(refreshSealingKey(WRAP).equals(refreshSealingKey(OTHER_WRAP))).toBe(false);
  });
});

describe("sealRefresh / openRefresh", () => {
  it("round-trips the refresh token and the device id", () => {
    const sealed = sealRefresh(SESSION_HASH, TOKENS, WRAP);
    expect(openRefresh(SESSION_HASH, sealed, WRAP)).toEqual(TOKENS);
  });

  it("round-trips a session with no device id", () => {
    const sealed = sealRefresh(SESSION_HASH, { refreshToken: "r", deviceId: null }, WRAP);
    expect(openRefresh(SESSION_HASH, sealed, WRAP)).toEqual({ refreshToken: "r", deviceId: null });
  });

  it("stores an AES-256-GCM envelope and never the token in the clear", () => {
    const sealed = sealRefresh(SESSION_HASH, TOKENS, WRAP);
    expect(isEnvelope(JSON.parse(sealed))).toBe(true);
    expect(sealed).not.toContain(TOKENS.refreshToken);
    expect(sealed).not.toContain(TOKENS.deviceId);
  });

  it("seals the same token differently every time", () => {
    expect(sealRefresh(SESSION_HASH, TOKENS, WRAP)).not.toBe(sealRefresh(SESSION_HASH, TOKENS, WRAP));
  });

  it("does not open under another wrap key, which is what a key changed without a rotation leaves", () => {
    const sealed = sealRefresh(SESSION_HASH, TOKENS, WRAP);
    expect(openRefresh(SESSION_HASH, sealed, OTHER_WRAP)).toBeNull();
  });

  it("does not open as another session, so a blob moved to another row is useless", () => {
    const sealed = sealRefresh(SESSION_HASH, TOKENS, WRAP);
    expect(openRefresh(hashSessionId("somebody-elses-cookie"), sealed, WRAP)).toBeNull();
  });

  it("does not open when sealed straight under the wrap key rather than the derived one", () => {
    const direct = JSON.stringify(encryptJson({ v: 1, sid: SESSION_HASH, ...TOKENS }, WRAP));
    expect(openRefresh(SESSION_HASH, direct, WRAP)).toBeNull();
  });

  it.each([
    ["an empty string", ""],
    ["text that is not JSON", "not json at all"],
    ["JSON that is not an envelope", JSON.stringify({ refreshToken: "r" })],
    ["a truncated envelope", sealRefresh(SESSION_HASH, TOKENS, WRAP).slice(0, 40)],
  ])("answers null, never a throw, for %s", (_name, stored) => {
    expect(openRefresh(SESSION_HASH, stored, WRAP)).toBeNull();
  });

  it("answers null for an envelope whose payload is not a stored refresh token", () => {
    const key = refreshSealingKey(WRAP);
    for (const payload of [{ v: 1, sid: SESSION_HASH }, { v: 2, sid: SESSION_HASH, ...TOKENS }, "a string", null]) {
      expect(openRefresh(SESSION_HASH, JSON.stringify(encryptJson(payload, key)), WRAP)).toBeNull();
    }
  });
});

describe("createSessionSecrets", () => {
  it("seals and opens by the cookie's id, under whatever the wrap key is at that moment", () => {
    let current = WRAP;
    const secrets = createSessionSecrets(() => current);
    const sealed = secrets.seal(SESSION, TOKENS);
    expect(secrets.open(SESSION, sealed)).toEqual(TOKENS);
    // The same blob, read after the process started under another key.
    current = OTHER_WRAP;
    expect(secrets.open(SESSION, sealed)).toBeNull();
  });

  it("binds to the id digest, not the raw id, so the rotation can re-seal by row", () => {
    const secrets = createSessionSecrets(() => WRAP);
    const sealed = secrets.seal(SESSION, TOKENS);
    expect(openRefresh(SESSION_HASH, sealed, WRAP)).toEqual(TOKENS);
  });

  it("lets a missing wrap key surface as an error rather than as a token that did not open", () => {
    // A server with no key is a deployment fault, not a reason to end anybody's session.
    const secrets = createSessionSecrets(() => {
      throw new Error("AGENTFORGE_SECRETS_KEY is required in server mode");
    });
    expect(() => secrets.open(SESSION, "{}")).toThrow(/AGENTFORGE_SECRETS_KEY/);
    expect(() => secrets.seal(SESSION, TOKENS)).toThrow(/AGENTFORGE_SECRETS_KEY/);
  });
});
