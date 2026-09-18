import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "crypto";
import { type EnvLike, isServerMode, wrappingKeyFromSecret } from "@agentforge/core";

export function localDataDir(env: EnvLike = process.env): string {
  const settingsPath = env.AGENTFORGE_SETTINGS_PATH?.trim();
  if (settingsPath) {
    if (/\.(json|enc)$/i.test(settingsPath)) {
      return dirname(settingsPath);
    }
    return settingsPath;
  }
  const dataDir = env.AGENTFORGE_DATA_DIR?.trim();
  if (dataDir) {
    return dataDir;
  }
  return resolve(process.cwd(), "../../data");
}

export function sqliteFilePath(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url?.startsWith("postgres://") || url?.startsWith("postgresql://")) {
    throw new Error(
      "Postgres is not supported. Unset DATABASE_URL (SQLite at data/agentforge.sqlite) or set DATABASE_URL=file:/path/to.sqlite.",
    );
  }
  if (url?.startsWith("file:")) {
    return url.slice("file:".length);
  }
  if (url) {
    return url;
  }
  return resolve(localDataDir(), "agentforge.sqlite");
}

export const MASTER_KEY_FILE = ".master-key";

/** AES-256 wraps every envelope in `packages/core/src/crypto/envelope.ts`, so 32 bytes is the floor. */
export const MIN_VAULT_KEY_BYTES = 32;

/**
 * Why the server refuses to run without a wrap key: an invented `.master-key` file on a container
 * layer is a key that disappears with the container and takes every sealed envelope with it.
 */
export const SERVER_VAULT_KEY_REQUIRED =
  "AGENTFORGE_SECRETS_KEY is required in server mode (AGENTFORGE_SERVER=1). " +
  "Set it to at least 32 random bytes, hex or base64 (`openssl rand -hex 32`). " +
  "The .master-key file fallback is disabled on the server.";

export const SERVER_VAULT_KEY_TOO_WEAK =
  "AGENTFORGE_SECRETS_KEY must be at least 32 random bytes, written as hex or base64 exactly as a " +
  "key generator produces them (`openssl rand -hex 32`). A passphrase, or anything else that is not " +
  "a canonical encoding of at least 32 bytes, is refused in server mode.";

const HEX_SECRET = /^[0-9a-fA-F]+$/;
const BASE64_SECRET = /^[A-Za-z0-9+/_-]+={0,2}$/;

type Base64Encoding = "base64" | "base64url";

/** Padding carries no bits, and a secrets manager may or may not keep it. */
function withoutPadding(value: string): string {
  return value.replace(/=+$/, "");
}

/**
 * True when `value` is what an encoder would actually have written for the bytes it decodes to.
 *
 * `Buffer.from(x, "base64")` decodes almost anything: it skips characters it does not recognise and
 * silently throws away bits that do not fill a byte. That is what let a typed passphrase measure as
 * "32 bytes of entropy" purely because of its length. Re-encoding the decoded bytes and demanding
 * the same string back refuses every one of those: a wrong alphabet, a bad length, or trailing bits
 * no encoder would have set.
 *
 * KNOWN LIMIT — this is a syntax check, not a randomness test. A 43-character alphanumeric string is
 * a valid base64 encoding of 32 bytes, so a passphrase of exactly that shape is indistinguishable
 * from a generated key and passes. Hex-only would be the airtight rule, at the cost of refusing the
 * base64 a secrets manager hands out.
 */
function isCanonical(value: string, encoding: Base64Encoding): boolean {
  return withoutPadding(Buffer.from(value, encoding).toString(encoding)) === withoutPadding(value);
}

/**
 * How many random bytes a wrap key secret carries, in the shapes a key generator produces: hex (what
 * `.master-key` holds) and canonical base64 / base64url (what a secrets manager hands out). Anything
 * else — a passphrase, a sentence, a truncated blob — is unmeasurable, so it counts as 0 and the
 * server refuses it. A desk is unaffected: `getLocalVaultKey` only measures in server mode.
 */
export function vaultKeyEntropyBytes(secret: string): number {
  const trimmed = secret.trim();
  if (!trimmed) {
    return 0;
  }
  if (HEX_SECRET.test(trimmed)) {
    // An odd number of digits is not hex: half a byte is missing, so this is some other string.
    return trimmed.length % 2 === 0 ? trimmed.length / 2 : 0;
  }
  if (!BASE64_SECRET.test(trimmed)) {
    return 0;
  }
  // `-` and `_` only exist in base64url; anything else is judged as standard base64.
  const encoding: Base64Encoding = /[-_]/.test(trimmed) ? "base64url" : "base64";
  return isCanonical(trimmed, encoding) ? Buffer.from(trimmed, encoding).length : 0;
}

function readOrCreateMasterKeyFile(env: EnvLike): string {
  const file = resolve(localDataDir(env), MASTER_KEY_FILE);
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(MIN_VAULT_KEY_BYTES).toString("hex"), { encoding: "utf8", mode: 0o600 });
  }
  return readFileSync(file, "utf8").trim();
}

/**
 * The wrap key for every envelope on this install.
 *
 * On a desk nothing changed: `AGENTFORGE_SECRETS_KEY` when set, else the `.master-key` file, created
 * on first use. In server mode the env key is mandatory and must be strong enough, and the file
 * fallback throws instead of self-creating (docs/internal/web-security-spec.md, row S1).
 */
export function getLocalVaultKey(env: EnvLike = process.env): Buffer {
  const fromEnv = env.AGENTFORGE_SECRETS_KEY?.trim();
  if (!isServerMode(env)) {
    return wrappingKeyFromSecret(fromEnv || readOrCreateMasterKeyFile(env));
  }
  if (!fromEnv) {
    throw new Error(SERVER_VAULT_KEY_REQUIRED);
  }
  if (vaultKeyEntropyBytes(fromEnv) < MIN_VAULT_KEY_BYTES) {
    throw new Error(SERVER_VAULT_KEY_TOO_WEAK);
  }
  return wrappingKeyFromSecret(fromEnv);
}
