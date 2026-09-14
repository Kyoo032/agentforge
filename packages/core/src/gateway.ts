import { gatewayUrlOverrideAllowed, PINNED_GATEWAY_BASE_URL } from "./gateway/pinned";
import { assertAllowedEndpointUrl } from "./security/tls";

/** Toko Token OpenAI-compatible gateway. Public DPSBuddy’s home inference path. */
export const GATEWAY_NAME = "Toko Token";
export const GATEWAY_HOST = "api.tokotokenai.com";
/** Pinned: see `gateway/pinned.ts`. Settings cannot change it. */
export const GATEWAY_BASE_URL = PINNED_GATEWAY_BASE_URL;
export const DEFAULT_PRODUCT_NAME = "DPSBuddy";

function envTrim(name: string): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Packaged Kemenkeu AI / AIHub Metranet set these before host.cjs loads. Webdev leaves them unset. */
export function resolvedProductName(): string {
  return envTrim("AGENTFORGE_PRODUCT_NAME") || DEFAULT_PRODUCT_NAME;
}

export function resolvedGatewayName(): string {
  return envTrim("AGENTFORGE_GATEWAY_NAME") || GATEWAY_NAME;
}

/**
 * Always the pinned gateway. `AGENTFORGE_GATEWAY_URL` is a **dev/test hook only** (branded flavors,
 * a local mock): it is ignored in a packaged build and in production — see `gateway/pinned.ts`.
 */
export function resolvedGatewayBaseUrl(): string {
  if (!gatewayUrlOverrideAllowed()) {
    return PINNED_GATEWAY_BASE_URL;
  }
  const fromEnv = envTrim("AGENTFORGE_GATEWAY_URL");
  return fromEnv ? stripTrailingSlash(fromEnv) : PINNED_GATEWAY_BASE_URL;
}

export function resolvedGatewayHost(): string {
  try {
    return new URL(resolvedGatewayBaseUrl()).host;
  } catch {
    return GATEWAY_HOST;
  }
}

function matchesLockedGateway(trimmed: string, baseUrl: string, host: string): boolean {
  const locked = stripTrailingSlash(baseUrl).toLowerCase();
  const lockedHost = host.toLowerCase();
  return (
    trimmed === locked ||
    trimmed === `https://${lockedHost}` ||
    trimmed === `https://${lockedHost}/` ||
    trimmed === `https://${lockedHost}/v1`
  );
}

export function isGatewayBaseUrl(raw?: string | null): boolean {
  const trimmed = raw?.trim().replace(/\/+$/, "").toLowerCase() ?? "";
  if (!trimmed) {
    return true;
  }
  if (matchesLockedGateway(trimmed, GATEWAY_BASE_URL, GATEWAY_HOST)) {
    return true;
  }
  const resolved = resolvedGatewayBaseUrl();
  if (resolved.toLowerCase() === GATEWAY_BASE_URL.toLowerCase()) {
    return false;
  }
  return matchesLockedGateway(trimmed, resolved, resolvedGatewayHost());
}

/** Origin for NewAPI paths like `/api/usage/token` and `/api/pricing` (strip `/v1`). */
export function gatewayOriginFromBaseUrl(raw?: string | null): string {
  const trimmed = (raw?.trim() || resolvedGatewayBaseUrl()).replace(/\/+$/, "");
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

/** NewAPI quota units per US dollar (Toko Token / NewAPI default). */
export const QUOTA_PER_USD = 500_000;

/** Unknown group: do not guess Value (0.5) or Volc_intl (1.1). */
export const DEFAULT_GROUP_RATIO = 1;

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
