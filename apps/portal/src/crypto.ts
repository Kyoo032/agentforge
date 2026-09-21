/**
 * The portal's one place for hashing, comparing and minting secret material.
 *
 * Two rules the rest of the app inherits from here:
 *   - a raw code or token is hashed the moment it is created and only the hash is passed on;
 *   - a comparison of two secrets is `timingSafeEqual`, never `===`.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** sha256 of a UTF-8 string, as the 32 raw bytes every `*_hash bytea` column expects. */
export function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Constant-time compare of two digests. Length is checked first because `timingSafeEqual`
 * throws on a length mismatch, and a thrown error is itself an oracle.
 */
export function hashEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when `raw` hashes to `digest`. The raw value is hashed here and discarded. */
export function matchesHash(raw: string, digest: Buffer): boolean {
  return hashEquals(sha256(raw), digest);
}

/** 32 random bytes, base64url — the shape `device-code-login.md` specifies for refresh tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no 0/O/1/I, because a user reads this off one screen and
 * types it into another.
 */
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 8 characters from the unambiguous alphabet, rendered `XXXX-XXXX`. */
export function randomUserCode(): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Upper-cases and re-inserts the dash, so `k7m4pq9t` and `K7M4-PQ9T` are the same code. */
export function normaliseUserCode(value: string): string {
  const bare = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return bare.length === 8 ? `${bare.slice(0, 4)}-${bare.slice(4)}` : bare;
}

/**
 * Six digits, uniform, leading zeros kept. `randomInt` rather than `Math.random` because for the
 * ten minutes it lives this value is password-equivalent.
 */
export function randomOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Addresses are compared case-insensitively; `citext` does the same on the Postgres side. */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}
