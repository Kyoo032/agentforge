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

/**
 * A key that is the right LENGTH but plainly not random: `"a".repeat(64)`, `0000…`, `deadbeef`
 * repeated. Every one of those satisfies the hex rule below and measures as 32 bytes, so the length
 * check alone would wave them through, and `wrappingKeyFromSecret` is an unsalted SHA-256 — a
 * guessable input is a guessable AES key for every envelope on the install.
 */
export const SERVER_VAULT_KEY_NOT_RANDOM =
  "AGENTFORGE_SECRETS_KEY is the right length but is not random: its bytes repeat far more than a " +
  "generated key's ever would. Generate one with `openssl rand -hex 32` rather than typing a " +
  "pattern, and keep it — if it changes, settings.enc can no longer be decrypted.";

/** What an unreadable `.master-key` says. Never re-minted silently: that would orphan every envelope. */
export const MASTER_KEY_FILE_UNUSABLE =
  `${MASTER_KEY_FILE} exists but does not hold a usable wrapping key (it is empty, truncated, or not ` +
  "the hex a key generator writes). Encrypting under it would seal this install's secrets with a key " +
  "anyone can compute. Restore the file from a backup, or delete it to start over with fresh " +
  "settings — anything already sealed under the old key will not be readable.";

/**
 * How many DISTINCT byte values a generated key is expected to carry.
 *
 * 32 uniform random bytes hold about 31 distinct values; the chance of 11 or fewer is smaller than
 * any risk this check is guarding against, so the floor never fires on a real key. It does fire on
 * every hand-typed pattern of that length, which is the whole point. Deliberately a crude shape
 * test and not an entropy estimate — see the KNOWN LIMIT note on `isCanonical`.
 */
export const MIN_DISTINCT_KEY_BYTES = 12;

/** True when the decoded key bytes look generated rather than typed. */
export function hasKeyLikeVariety(bytes: Buffer): boolean {
  return new Set(bytes).size >= MIN_DISTINCT_KEY_BYTES;
}

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
  return decodeVaultKey(secret).length;
}

/**
 * The bytes a wrap key secret actually encodes, or an empty buffer when it is not one of the shapes
 * a key generator writes. Split out of `vaultKeyEntropyBytes` so the randomness check below can see
 * the bytes rather than only how many there are.
 */
export function decodeVaultKey(secret: string): Buffer {
  const trimmed = secret.trim();
  if (!trimmed) {
    return EMPTY;
  }
  if (HEX_SECRET.test(trimmed)) {
    // An odd number of digits is not hex: half a byte is missing, so this is some other string.
    return trimmed.length % 2 === 0 ? Buffer.from(trimmed, "hex") : EMPTY;
  }
  if (!BASE64_SECRET.test(trimmed)) {
    return EMPTY;
  }
  // `-` and `_` only exist in base64url; anything else is judged as standard base64.
  const encoding: Base64Encoding = /[-_]/.test(trimmed) ? "base64url" : "base64";
  return isCanonical(trimmed, encoding) ? Buffer.from(trimmed, encoding) : EMPTY;
}

const EMPTY = Buffer.alloc(0);

/**
 * The `.master-key` file, created on first use and then VALIDATED on every read.
 *
 * Only the file's existence used to be checked, never its contents. An empty or truncated one —
 * an interrupted first write, a half-restored backup, a sync client, anything with write access to
 * the data dir — made this return `""`, and `wrappingKeyFromSecret("")` is `SHA-256("")`, a fixed
 * value anyone can compute. Every envelope written afterwards would have been sealed under a
 * world-known AES key, silently.
 *
 * A bad file is a hard error rather than a silent re-mint: re-minting would encrypt new secrets
 * under a key the existing `settings.enc` was not sealed with, turning a recoverable problem into
 * an unreadable vault. The message says what to do instead.
 */
function readOrCreateMasterKeyFile(env: EnvLike): string {
  const file = resolve(localDataDir(env), MASTER_KEY_FILE);
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(MIN_VAULT_KEY_BYTES).toString("hex"), { encoding: "utf8", mode: 0o600 });
  }
  const secret = readFileSync(file, "utf8").trim();
  if (vaultKeyEntropyBytes(secret) < MIN_VAULT_KEY_BYTES) {
    throw new Error(MASTER_KEY_FILE_UNUSABLE);
  }
  return secret;
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
  // The length check above measures the ENCODING, so `"a".repeat(64)` and `0000…` both measure as
  // 32 bytes. This one looks at the bytes themselves and refuses a typed pattern.
  if (!hasKeyLikeVariety(decodeVaultKey(fromEnv))) {
    throw new Error(SERVER_VAULT_KEY_NOT_RANDOM);
  }
  return wrappingKeyFromSecret(fromEnv);
}
