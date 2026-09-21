/**
 * The portal's Ed25519 signing keys.
 *
 * `node:crypto` only, no new dependency: an Ed25519 private key is a 32-byte seed wrapped in a
 * fixed 16-byte PKCS#8 prefix, and the public half is the last 32 bytes of the SPKI export. That
 * is the whole of it -- a JOSE library here would buy a JWK parser we do not need and a second
 * place for a key to be logged.
 *
 * Two rules:
 *   - **Production requires `PORTAL_SIGNING_KEY`.** `loadConfig` already refuses to start without
 *     it (`src/config.ts`), and this refuses again rather than quietly minting one: an ephemeral
 *     key on a restart signs tokens the previous process's JWKS never published.
 *   - **Development may mint one, loudly.** A `warn` line naming the `kid` and nothing else, so a
 *     reviewer who sees a token stop verifying after a restart knows why in one grep.
 *
 * The seed never leaves this file. `PortalKey` exposes `sign`, a `KeyObject` and the raw public
 * bytes; it deliberately has no accessor for the private material, so nothing downstream can log
 * it even by accident.
 */
import { createPrivateKey, createPublicKey, type KeyObject, randomBytes, sign as signBytes } from "node:crypto";
import { sha256 } from "../crypto";
import { log as defaultLog, type Logger } from "../log";

/** `jwks_keys_kid_chk` in `docs/internal/portal/migrations/0002_core_tables.sql`. */
export const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{4,64}$/;

const SEED_BYTES = 32;
/** PKCS#8 header for an Ed25519 private key holding a raw 32-byte seed. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
/** Enough of sha256(public key) to be collision-free across the handful of keys a portal holds. */
const KEY_ID_CHARS = 16;

export interface PortalKey {
  /** The JWT header `kid`, derived from the public key so it is stable across restarts. */
  readonly kid: string;
  readonly publicKey: KeyObject;
  /** The 32 raw bytes that become the JWK `x` member. */
  readonly publicRaw: Buffer;
  /** Exposed for `createPublicKey` round-trips and for `node:crypto`'s own `sign`. */
  readonly privateKey: KeyObject;
  sign(message: Buffer): Buffer;
}

export interface Keyring {
  readonly current: PortalKey;
  /** Current first. A rotation window would add the next and previous keys here. */
  readonly all: readonly PortalKey[];
  /** True when the key was minted at boot and dies with the process. */
  readonly ephemeral: boolean;
  byKid(kid: string): PortalKey | null;
}

export interface Jwk {
  readonly kty: "OKP";
  readonly crv: "Ed25519";
  readonly kid: string;
  readonly x: string;
  readonly use: "sig";
  readonly alg: "EdDSA";
}

export function keyFromSeed(seed: Buffer): PortalKey {
  if (seed.length !== SEED_BYTES) {
    throw new Error(`an Ed25519 seed is ${SEED_BYTES} bytes (got ${seed.length})`);
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ format: "der", type: "spki" });
  const publicRaw = Buffer.from(spki.subarray(spki.length - SEED_BYTES));

  return Object.freeze({
    kid: sha256(publicRaw.toString("base64url")).toString("base64url").slice(0, KEY_ID_CHARS),
    publicKey,
    publicRaw,
    privateKey,
    sign(message: Buffer): Buffer {
      // `null` is the algorithm argument Ed25519 takes: the curve fixes the digest.
      return signBytes(null, message, privateKey);
    },
  });
}

export interface KeyringSource {
  readonly production: boolean;
  readonly signingKey: Buffer | null;
}

export function resolveKeyring(source: KeyringSource, logger: Logger = defaultLog): Keyring {
  if (source.signingKey) {
    return keyring([keyFromSeed(source.signingKey)], false);
  }
  if (source.production) {
    throw new Error(
      "PORTAL_SIGNING_KEY is required in production: an ephemeral key would sign access tokens " +
        "that the JWKS document published before the restart does not contain.",
    );
  }
  const key = keyFromSeed(randomBytes(SEED_BYTES));
  // The kid only. Never the seed, and never a field name the redactor would have to catch.
  logger.warn("portal_signing_key_ephemeral", { kid: key.kid });
  return keyring([key], true);
}

function keyring(keys: readonly PortalKey[], ephemeral: boolean): Keyring {
  const byKid = new Map(keys.map((key) => [key.kid, key]));
  return Object.freeze({
    current: keys[0],
    all: Object.freeze([...keys]),
    ephemeral,
    byKid: (kid: string) => byKid.get(kid) ?? null,
  });
}

/**
 * The `/.well-known/jwks.json` document.
 *
 * Today that is exactly the in-process keyring. `jwks_keys` (`0002_core_tables.sql`) is the
 * backend team's rotation table and `0004_rls.sql` grants `portal_app` **SELECT only** on it, so
 * this process cannot publish its own key through that table -- see the map page's Gotchas.
 */
export function publishedJwks(ring: Keyring): { readonly keys: readonly Jwk[] } {
  return Object.freeze({
    keys: Object.freeze(
      ring.all.map(
        (key): Jwk =>
          Object.freeze({
            kty: "OKP" as const,
            crv: "Ed25519" as const,
            kid: key.kid,
            x: key.publicRaw.toString("base64url"),
            use: "sig" as const,
            alg: "EdDSA" as const,
          }),
      ),
    ),
  });
}
