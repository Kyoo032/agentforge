import { createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLogger } from "../log";
import { KEY_ID_PATTERN, keyFromSeed, publishedJwks, resolveKeyring } from "./keys";

function seed(byte: number): Buffer {
  return Buffer.alloc(32, byte);
}

describe("keyFromSeed", () => {
  it("derives the same key id from the same seed and a different one from another", () => {
    expect(keyFromSeed(seed(1)).kid).toBe(keyFromSeed(seed(1)).kid);
    expect(keyFromSeed(seed(1)).kid).not.toBe(keyFromSeed(seed(2)).kid);
  });

  it("produces a kid the jwks_keys CHECK accepts", () => {
    for (let i = 0; i < 16; i += 1) {
      expect(keyFromSeed(randomBytes(32)).kid).toMatch(KEY_ID_PATTERN);
    }
  });

  it("produces a 32-byte raw public key that verifies its own signature", () => {
    const key = keyFromSeed(seed(7));
    expect(key.publicRaw).toHaveLength(32);

    const message = Buffer.from("portal");
    const signature = key.sign(message);
    expect(verifySignature(null, message, key.publicKey, signature)).toBe(true);
  });

  it("refuses a seed that is not 32 bytes", () => {
    expect(() => keyFromSeed(Buffer.alloc(31, 1))).toThrow(/32 bytes/);
  });

  it("agrees with node's own SPKI export for the same seed", () => {
    const key = keyFromSeed(seed(3));
    const spki = createPublicKey(key.privateKey).export({ format: "der", type: "spki" });
    expect(key.publicRaw.equals(spki.subarray(spki.length - 32))).toBe(true);
  });
});

describe("resolveKeyring", () => {
  it("uses PORTAL_SIGNING_KEY when it is configured", () => {
    const ring = resolveKeyring({ production: false, signingKey: seed(9) });
    expect(ring.current.kid).toBe(keyFromSeed(seed(9)).kid);
    expect(ring.ephemeral).toBe(false);
  });

  it("mints an ephemeral key in development and says so loudly", () => {
    const lines: string[] = [];
    const ring = resolveKeyring(
      { production: false, signingKey: null },
      createLogger({ sink: (_level, line) => lines.push(line), env: {} }),
    );
    expect(ring.ephemeral).toBe(true);
    expect(lines.join("\n")).toContain("portal_signing_key_ephemeral");
  });

  it("refuses to mint an ephemeral key in production", () => {
    expect(() => resolveKeyring({ production: true, signingKey: null })).toThrow(
      /PORTAL_SIGNING_KEY/,
    );
  });

  it("never lets a key's seed or private half reach the log line", () => {
    const lines: string[] = [];
    resolveKeyring(
      { production: false, signingKey: null },
      createLogger({ sink: (_level, line) => lines.push(line), env: {} }),
    );
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(Object.keys(record)).toEqual(["ts", "level", "event", "kid"]);
  });
});

describe("publishedJwks", () => {
  it("publishes one OKP key per keyring entry, with the base64url public half", () => {
    const ring = resolveKeyring({ production: false, signingKey: seed(5) });
    const document = publishedJwks(ring);

    expect(document.keys).toEqual([
      {
        kty: "OKP",
        crv: "Ed25519",
        kid: ring.current.kid,
        x: ring.current.publicRaw.toString("base64url"),
        use: "sig",
        alg: "EdDSA",
      },
    ]);
  });

  it("carries no private material of any kind", () => {
    const ring = resolveKeyring({ production: false, signingKey: seed(6) });
    const serialised = JSON.stringify(publishedJwks(ring));
    expect(serialised).not.toContain(seed(6).toString("base64url"));
    expect(serialised).not.toContain(seed(6).toString("hex"));
    expect(serialised).not.toContain('"d"');
  });
});
