const BEARER_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]{8,}/g;

const KEY_PATTERNS = [
  /\bsk-ant-[A-Za-z0-9\-_]{8,}/g,
  /\bsk-[A-Za-z0-9\-_]{8,}/g,
  /\btvly-[A-Za-z0-9\-_]{8,}/g,
  /\bAIza[A-Za-z0-9\-_]{10,}/g,
];

/** Min length for a standalone base64-like token to be treated as sensitive. */
const BASE64_RE = /\b[A-Za-z0-9+/]{32,}={0,2}\b/g;

export function redactSecrets(text: string): string {
  if (!text) {
    return text;
  }
  let result = text;
  result = result.replace(BEARER_RE, "Bearer [REDACTED]");
  for (const pattern of KEY_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  result = result.replace(BASE64_RE, "[REDACTED]");
  return result;
}
