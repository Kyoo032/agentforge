import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wrappingKeyFromSecret } from "@agentforge/core";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  getLocalVaultKey,
  MIN_VAULT_KEY_BYTES,
  SERVER_VAULT_KEY_TOO_WEAK,
  sqliteFilePath,
  vaultKeyEntropyBytes,
} from "./vault-key";

const original = process.env.DATABASE_URL;

const tempDirs: string[] = [];

/** A throwaway data dir per test, injected through `env` so `process.env` is never touched. */
function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentforge-vault-key-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (original === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = original;
  }
});

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("sqliteFilePath", () => {
  it("rejects leftover Postgres URLs", () => {
    process.env.DATABASE_URL = "postgres://agentforge:agentforge@127.0.0.1:5432/agentforge";
    expect(() => sqliteFilePath()).toThrow(/Postgres is not supported|no longer the product database/i);
  });

  it("reads file: URLs", () => {
    process.env.DATABASE_URL = "file:/tmp/agentforge-test.sqlite";
    expect(sqliteFilePath()).toBe("/tmp/agentforge-test.sqlite");
  });
});

describe("vaultKeyEntropyBytes", () => {
  it("measures the two formats this code has always accepted", () => {
    expect(vaultKeyEntropyBytes("a".repeat(64))).toBe(32);
    expect(vaultKeyEntropyBytes(Buffer.alloc(32, 7).toString("base64"))).toBe(32);
    expect(vaultKeyEntropyBytes(Buffer.alloc(48, 7).toString("base64url"))).toBe(48);
  });

  it("measures anything else as no entropy at all", () => {
    expect(vaultKeyEntropyBytes("")).toBe(0);
    expect(vaultKeyEntropyBytes("   ")).toBe(0);
    expect(vaultKeyEntropyBytes("correct horse battery staple")).toBe(0);
    expect(vaultKeyEntropyBytes("a".repeat(30))).toBeLessThan(MIN_VAULT_KEY_BYTES);
  });

  it("measures what `openssl rand` actually produces, in each of the three encodings", () => {
    const key = randomBytes(32);
    expect(vaultKeyEntropyBytes(key.toString("hex"))).toBe(32);
    expect(vaultKeyEntropyBytes(key.toString("hex").toUpperCase())).toBe(32);
    expect(vaultKeyEntropyBytes(key.toString("base64"))).toBe(32);
    expect(vaultKeyEntropyBytes(key.toString("base64url"))).toBe(32);
    expect(vaultKeyEntropyBytes(randomBytes(48).toString("base64"))).toBe(48);
  });

  it("measures a short key honestly, so 31 bytes cannot pass for 32", () => {
    const short = randomBytes(31);
    expect(vaultKeyEntropyBytes(short.toString("hex"))).toBe(31);
    expect(vaultKeyEntropyBytes(short.toString("base64"))).toBe(31);
    expect(vaultKeyEntropyBytes(short.toString("base64url"))).toBe(31);
  });

  it("refuses a passphrase that is not a canonical encoding of anything", () => {
    // The hole this closes: `Buffer.from(x, "base64")` will decode almost any string, so a typed
    // passphrase used to measure as "32 bytes of entropy" purely because of its length.
    for (const passphrase of [
      "ThisIsMyPassphraseForTheAgentForgeVaultKey1",
      "correcthorsebatterystaplecorrecthorsebatter",
      "MySuperSecretPassphraseThatIsNotAKeyAtAll12",
      "hunter2hunter2hunter2hunter2hunter2hunter2h",
      "correct horse battery staple correct horse!!",
    ]) {
      expect(passphrase.length).toBeGreaterThanOrEqual(43);
      expect(vaultKeyEntropyBytes(passphrase)).toBe(0);
    }
  });

  it("refuses base64 with trailing bits no encoder would have left set", () => {
    const canonical = randomBytes(32).toString("base64");
    expect(vaultKeyEntropyBytes(canonical)).toBe(32);
    // Same length, same alphabet, but the last character carries bits the decoder throws away.
    const mangled = `${canonical.slice(0, 42)}B=`;
    expect(vaultKeyEntropyBytes(mangled)).toBe(0);
  });

  it("refuses hex with an odd digit, which is not hex at all", () => {
    expect(vaultKeyEntropyBytes("a".repeat(65))).toBe(0);
  });

  it("reads a hex-shaped string as hex, so 44 hex digits is 22 bytes and far too few", () => {
    expect(vaultKeyEntropyBytes("a".repeat(44))).toBe(22);
    expect(vaultKeyEntropyBytes("a".repeat(44))).toBeLessThan(MIN_VAULT_KEY_BYTES);
  });

  it("KNOWN LIMIT: a passphrase that is canonical base64 of 32 bytes cannot be told from a key", () => {
    // Nothing syntactic separates these from a generator's output — they *are* valid encodings of
    // 32 and 33 random-looking bytes. Everything malformed is refused above; closing this last case
    // would mean hex only, at the cost of the base64 a secrets manager hands out.
    expect(vaultKeyEntropyBytes("ThisIsMyPassphraseForTheAgentForgeVaultKey0")).toBe(32);
    expect(vaultKeyEntropyBytes("ThisIsMyPassphraseForTheAgentForgeVaultKey01")).toBe(33);
  });
});

describe("getLocalVaultKey in server mode", () => {
  const HEX_KEY = "b".repeat(64);

  function serverEnv(patch: Record<string, string | undefined> = {}): Record<string, string | undefined> {
    return { AGENTFORGE_SERVER: "1", AGENTFORGE_DATA_DIR: dataDir(), ...patch };
  }

  it("refuses to invent a .master-key file and names the variable to set", () => {
    const dir = dataDir();
    expect(() => getLocalVaultKey(serverEnv())).toThrow(/AGENTFORGE_SECRETS_KEY/);
    expect(existsSync(join(dir, ".master-key"))).toBe(false);
  });

  it("refuses a key with less than 32 bytes of entropy, and writes no file", () => {
    const dir = dataDir();
    expect(() => getLocalVaultKey(serverEnv({ AGENTFORGE_SECRETS_KEY: "hunter2" }))).toThrow(/32 bytes/);
    expect(() => getLocalVaultKey(serverEnv({ AGENTFORGE_SECRETS_KEY: "a".repeat(40) }))).toThrow(/32 bytes/);
    expect(existsSync(join(dir, ".master-key"))).toBe(false);
  });

  it("refuses a passphrase, however long, with the too-weak message", () => {
    const dir = dataDir();
    for (const passphrase of [
      "correct horse battery staple correct horse!!",
      "ThisIsMyPassphraseForTheAgentForgeVaultKey1",
      "hunter2hunter2hunter2hunter2hunter2hunter2h",
    ]) {
      expect(() => getLocalVaultKey(serverEnv({ AGENTFORGE_SECRETS_KEY: passphrase }))).toThrow(
        SERVER_VAULT_KEY_TOO_WEAK,
      );
    }
    expect(existsSync(join(dir, ".master-key"))).toBe(false);
  });

  it("refuses a real but short key in either encoding", () => {
    const short = randomBytes(31);
    for (const encoded of [short.toString("hex"), short.toString("base64"), short.toString("base64url")]) {
      expect(() => getLocalVaultKey(serverEnv({ AGENTFORGE_SECRETS_KEY: encoded }))).toThrow(SERVER_VAULT_KEY_TOO_WEAK);
    }
  });

  it("accepts what a secrets manager hands out: hex, base64 and base64url", () => {
    const key = randomBytes(32);
    for (const encoded of [key.toString("hex"), key.toString("base64"), key.toString("base64url")]) {
      expect(getLocalVaultKey(serverEnv({ AGENTFORGE_SECRETS_KEY: encoded }))).toEqual(wrappingKeyFromSecret(encoded));
    }
  });

  it("uses a long enough env key exactly as it always has, in hex or base64", () => {
    const dir = dataDir();
    expect(getLocalVaultKey(serverEnv({ AGENTFORGE_SECRETS_KEY: HEX_KEY }))).toEqual(wrappingKeyFromSecret(HEX_KEY));
    const b64 = Buffer.alloc(32, 9).toString("base64");
    expect(getLocalVaultKey(serverEnv({ AGENTFORGE_SECRETS_KEY: ` ${b64} ` }))).toEqual(wrappingKeyFromSecret(b64));
    expect(existsSync(join(dir, ".master-key"))).toBe(false);
  });
});

describe("getLocalVaultKey outside server mode", () => {
  it("still creates and reuses the .master-key file", () => {
    const dir = dataDir();
    const env = { AGENTFORGE_DATA_DIR: dir };
    const first = getLocalVaultKey(env);
    expect(existsSync(join(dir, ".master-key"))).toBe(true);
    expect(first).toHaveLength(32);
    expect(getLocalVaultKey(env)).toEqual(first);
  });

  it("still accepts a short env key on a desk", () => {
    const env = { AGENTFORGE_DATA_DIR: dataDir(), AGENTFORGE_SECRETS_KEY: "hunter2" };
    expect(getLocalVaultKey(env)).toEqual(wrappingKeyFromSecret("hunter2"));
  });
});
