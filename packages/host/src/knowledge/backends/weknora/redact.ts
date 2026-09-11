/**
 * Secret removal for text that is about to be logged.
 *
 * The sidecar's error bodies are the reason this exists: they are third-party text that has had our
 * API key, our JWT and the gateway key handed to it, and upstream is under no obligation to keep
 * them out of an error message. The body is still worth logging — it is how a 401 gets diagnosed —
 * but only after every secret we know we gave it has been taken back out.
 */

/** What replaces a secret. Fixed-width so a log line's shape does not leak a key's length. */
export const REDACTED = "[redacted]";

/** Short strings are too likely to be ordinary substrings for blind replacement to be safe. */
const MIN_SECRET_LENGTH = 8;

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `text` with every occurrence of every secret replaced. Longest first, so a key that contains
 * another secret as a prefix cannot leave its tail behind. Null, empty and implausibly short
 * secrets are ignored rather than turning the whole line into `[redacted]`.
 */
export function redactSecrets(text: string, secrets: Array<string | null | undefined>): string {
  const usable = [...new Set(secrets.filter((secret): secret is string => typeof secret === "string"))]
    .map((secret) => secret.trim())
    .filter((secret) => secret.length >= MIN_SECRET_LENGTH)
    .sort((left, right) => right.length - left.length);
  let out = text;
  for (const secret of usable) {
    out = out.replace(new RegExp(escapeForRegex(secret), "g"), REDACTED);
  }
  return out;
}
