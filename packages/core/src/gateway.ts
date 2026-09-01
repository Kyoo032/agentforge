import { assertAllowedEndpointUrl } from "./security/tls";

/** Toko Token OpenAI-compatible gateway. This is Agentforge’s home inference path. */
export const GATEWAY_NAME = "Toko Token";
export const GATEWAY_HOST = "api.tokotokenai.com";
export const GATEWAY_BASE_URL = "https://api.tokotokenai.com/v1";

/** NewAPI quota units per US dollar (Toko Token / NewAPI default). */
export const QUOTA_PER_USD = 500_000;

/** Unknown group: do not guess Value (0.5) or Volc_intl (1.1). */
export const DEFAULT_GROUP_RATIO = 1;

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

/** Origin for NewAPI paths like `/api/usage/token` and `/api/pricing` (strip `/v1`). */
export function gatewayOriginFromBaseUrl(raw?: string | null): string {
  const trimmed = (raw?.trim() || GATEWAY_BASE_URL).replace(/\/+$/, "");
  assertAllowedEndpointUrl(trimmed);
  const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  let path = parsed.pathname.replace(/\/+$/, "");
  if (/\/v1beta$/i.test(path)) {
    path = path.slice(0, -"/v1beta".length);
  } else if (/\/v1$/i.test(path)) {
    path = path.slice(0, -"/v1".length);
  }
  parsed.pathname = path.length > 0 ? path : "/";
  parsed.search = "";
  parsed.hash = "";
  if (parsed.pathname === "/") {
    return `${parsed.protocol}//${parsed.host}`;
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
}

export function quotaToUsd(quota: number, quotaPerUsd = QUOTA_PER_USD): number {
  if (!Number.isFinite(quota) || quotaPerUsd <= 0) {
    return 0;
  }
  return quota / quotaPerUsd;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const abs = Math.abs(value);
  if (abs !== 0 && abs < 0.01) {
    const digits = abs < 0.0001 ? 6 : 4;
    return `${value < 0 ? "-" : ""}$${abs.toFixed(digits)}`.replace(/0+$/, "").replace(/\.$/, "");
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
