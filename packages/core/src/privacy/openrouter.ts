/**
 * OpenRouter Zero Data Retention (ZDR) helpers.
 * ZDR instructs OpenRouter not to log or store request data.
 * Only inject for openrouter.ai endpoints — never for Toko Token or other providers.
 */

export function isOpenRouterBaseUrl(raw?: string | null): boolean {
  if (!raw || raw.trim().length === 0) {
    return false;
  }
  try {
    const parsed = new URL(raw.trim());
    return parsed.hostname.toLowerCase() === "openrouter.ai";
  } catch {
    return false;
  }
}

export function openRouterZdrBody(
  baseUrl?: string | null,
): { provider: { zdr: true } } | undefined {
  if (!isOpenRouterBaseUrl(baseUrl)) {
    return undefined;
  }
  return { provider: { zdr: true } };
}
