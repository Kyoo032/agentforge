import { createHash } from "crypto";

/**
 * Short, non-secret handle for a saved key. SHA-256 of the trimmed secret,
 * then `sha256:` plus the first 12 hex chars. Empty / whitespace → "".
 * Hashing stays server-side; the UI only displays the returned string.
 */
export function keyFingerprint(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) {
    return "";
  }
  const hex = createHash("sha256").update(trimmed, "utf8").digest("hex");
  return `sha256:${hex.slice(0, 12)}`;
}

/** `keyFingerprint` or `null` when the secret is missing or blank. */
export function keyFingerprintOrNull(secret: string | undefined): string | null {
  if (typeof secret !== "string") {
    return null;
  }
  return keyFingerprint(secret) || null;
}
