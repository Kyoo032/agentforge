import { isNetworkUnreachableError } from "../models/probe";
import { redactSecrets } from "../security/redact";
import { pinnedGatewayBaseUrl } from "./pinned";

/** One key-validation request. Same budget as the model probe: the app must boot offline. */
export const GATEWAY_VALIDATE_TIMEOUT_MS = 5_000;

export type GatewayKeyValidation =
  | { status: "ok"; modelCount: number }
  | { status: "invalid_key"; httpStatus: number }
  | { status: "unreachable"; message: string }
  | { status: "error"; httpStatus?: number; message: string };

function modelCount(body: unknown): number {
  if (!body || typeof body !== "object") {
    return 0;
  }
  const data = (body as { data?: unknown; models?: unknown }).data ?? (body as { models?: unknown }).models;
  return Array.isArray(data) ? data.length : 0;
}

/** Redacted, English, and never the key itself — this string reaches the renderer. */
function safeMessage(detail: string, apiKey: string): string {
  const trimmed = apiKey.trim();
  const withoutKey = trimmed.length > 0 ? detail.split(trimmed).join("[REDACTED]") : detail;
  return redactSecrets(withoutKey);
}

/**
 * Ask the pinned gateway whether this key is live. `401`/`403` is a verdict (invalid key), a
 * network failure is not (the caller may fall back to offline grace).
 */
export async function validateGatewayKey(input: {
  apiKey: string;
  fetch?: typeof fetch;
}): Promise<GatewayKeyValidation> {
  const apiKey = input.apiKey?.trim() ?? "";
  if (apiKey.length === 0) {
    return { status: "invalid_key", httpStatus: 0 };
  }
  const fetchFn = input.fetch ?? fetch;
  const url = `${pinnedGatewayBaseUrl()}/models`;
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(GATEWAY_VALIDATE_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Gateway request failed";
    if (isNetworkUnreachableError(error)) {
      return { status: "unreachable", message: safeMessage(detail, apiKey) };
    }
    return { status: "error", message: safeMessage(detail, apiKey) };
  }
  if (response.status === 401 || response.status === 403) {
    return { status: "invalid_key", httpStatus: response.status };
  }
  if (!response.ok) {
    return {
      status: "error",
      httpStatus: response.status,
      message: safeMessage(`Gateway answered ${response.status}`, apiKey),
    };
  }
  try {
    const body: unknown = await response.json();
    return { status: "ok", modelCount: modelCount(body) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Gateway did not return JSON";
    return { status: "error", httpStatus: response.status, message: safeMessage(detail, apiKey) };
  }
}
