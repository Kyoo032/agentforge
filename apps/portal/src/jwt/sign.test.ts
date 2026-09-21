import { describe, expect, it } from "vitest";
import { keyFromSeed, resolveKeyring } from "./keys";
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken, verifyAccessToken } from "./sign";

const ISSUER = "https://portal.test";
const NOW = Date.UTC(2026, 8, 21, 8, 0, 0);

const CLAIMS_INPUT = {
  issuer: ISSUER,
  userId: "usr-1",
  tenantId: "tnt-1",
  orgId: "org-1",
  deviceId: "dev-1",
  sessionId: "ses-1",
  scope: "v1.chat v1.models",
};

function ring(byte = 1) {
  return resolveKeyring({ production: false, signingKey: Buffer.alloc(32, byte) });
}

describe("signAccessToken", () => {
  it("writes the header the gateway expects, with the signing key's kid", () => {
    const keys = ring();
    const token = signAccessToken(keys.current, { ...CLAIMS_INPUT, now: NOW });
    const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));

    expect(header).toEqual({ alg: "EdDSA", typ: "JWT", kid: keys.current.kid });
  });

  it("carries exactly the claims device-code-login.md names", () => {
    const token = signAccessToken(ring().current, { ...CLAIMS_INPUT, now: NOW });
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));

    expect(claims).toEqual({
      iss: ISSUER,
      sub: "usr-1",
      tid: "tnt-1",
      oid: "org-1",
      did: "dev-1",
      sid: "ses-1",
      scope: "v1.chat v1.models",
      iat: NOW / 1000,
      exp: NOW / 1000 + ACCESS_TOKEN_TTL_SECONDS,
    });
  });

  it("expires in an hour", () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(3600);
  });
});

describe("verifyAccessToken", () => {
  it("accepts a token this keyring signed and hands back its claims", () => {
    const keys = ring();
    const token = signAccessToken(keys.current, { ...CLAIMS_INPUT, now: NOW });

    const result = verifyAccessToken(keys, token, { issuer: ISSUER, now: NOW + 60_000 });
    expect(result).toEqual({
      ok: true,
      claims: expect.objectContaining({ sub: "usr-1", sid: "ses-1", did: "dev-1" }),
    });
  });

  it("refuses a token whose payload was edited", () => {
    const keys = ring();
    const [header, payload, signature] = signAccessToken(keys.current, {
      ...CLAIMS_INPUT,
      now: NOW,
    }).split(".");
    const tampered = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    tampered.oid = "org-2";
    const forged = `${header}.${Buffer.from(JSON.stringify(tampered)).toString("base64url")}.${signature}`;

    expect(verifyAccessToken(keys, forged, { issuer: ISSUER, now: NOW })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses a token signed by a key this keyring does not hold", () => {
    const token = signAccessToken(keyFromSeed(Buffer.alloc(32, 99)), { ...CLAIMS_INPUT, now: NOW });

    expect(verifyAccessToken(ring(), token, { issuer: ISSUER, now: NOW })).toEqual({
      ok: false,
      reason: "unknown_kid",
    });
  });

  it("refuses an expired token, allowing 120 s of clock skew and no more", () => {
    const keys = ring();
    const token = signAccessToken(keys.current, { ...CLAIMS_INPUT, now: NOW });
    const expiresAt = NOW + ACCESS_TOKEN_TTL_SECONDS * 1000;

    expect(verifyAccessToken(keys, token, { issuer: ISSUER, now: expiresAt + 119_000 }).ok).toBe(true);
    expect(verifyAccessToken(keys, token, { issuer: ISSUER, now: expiresAt + 121_000 })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses a token minted for another issuer", () => {
    const keys = ring();
    const token = signAccessToken(keys.current, { ...CLAIMS_INPUT, issuer: "https://evil.test", now: NOW });

    expect(verifyAccessToken(keys, token, { issuer: ISSUER, now: NOW })).toEqual({
      ok: false,
      reason: "wrong_issuer",
    });
  });

  it("refuses an `alg: none` downgrade", () => {
    const keys = ring();
    const [, payload] = signAccessToken(keys.current, { ...CLAIMS_INPUT, now: NOW }).split(".");
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT", kid: keys.current.kid }))
      .toString("base64url");

    expect(verifyAccessToken(keys, `${header}.${payload}.`, { issuer: ISSUER, now: NOW })).toEqual({
      ok: false,
      reason: "bad_algorithm",
    });
  });

  it("refuses anything that is not three dotted segments", () => {
    for (const nonsense of ["", "a.b", "a.b.c.d", "not-a-token"]) {
      expect(verifyAccessToken(ring(), nonsense, { issuer: ISSUER, now: NOW })).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });
});
