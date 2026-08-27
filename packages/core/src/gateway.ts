/** Toko Token OpenAI-compatible gateway. This is Agentforge’s home inference path. */
export const GATEWAY_NAME = "Toko Token";
export const GATEWAY_HOST = "api.tokotokenai.com";
export const GATEWAY_BASE_URL = "https://api.tokotokenai.com/v1";

export function isGatewayBaseUrl(raw?: string | null): boolean {
  const trimmed = raw?.trim().replace(/\/+$/, "").toLowerCase() ?? "";
  if (!trimmed) {
    return true;
  }
  return (
    trimmed === GATEWAY_BASE_URL.toLowerCase() ||
    trimmed === `https://${GATEWAY_HOST}` ||
    trimmed === `https://${GATEWAY_HOST}/` ||
    trimmed === `https://${GATEWAY_HOST}/v1`
  );
}
