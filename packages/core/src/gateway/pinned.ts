/**
 * The one gateway this product talks to. Pinned: the owner cannot change it from Settings, and a
 * stored `openaiBaseUrl` from an older build is tolerated on read but never honoured.
 *
 * Do not import `node:crypto` here. The renderer loads this module through `@agentforge/core/gateway`.
 * Integrity of the URL string is checked in `pinned-integrity.ts` (Node/tests only).
 */
export const PINNED_GATEWAY_BASE_URL = "https://api.tokotokenai.com/v1";

/** SHA-256 (hex) of the exact `PINNED_GATEWAY_BASE_URL` string. `pinned.test.ts` recomputes it. */
export const PINNED_GATEWAY_BASE_URL_SHA256 =
  "d4721f3504d309efe1e70b32e84600c85f213156c7ff5b2720353d993d006c52";

export function pinnedGatewayBaseUrl(): string {
  return PINNED_GATEWAY_BASE_URL;
}

/** Origin for NewAPI paths like `/api/usage/token` (the pinned base without `/v1`). */
export function pinnedGatewayOrigin(): string {
  const parsed = new URL(PINNED_GATEWAY_BASE_URL);
  return `${parsed.protocol}//${parsed.host}`;
}

/** True inside the packaged Electron app: `main.cjs` sets this before `host.cjs` loads. */
export function isPackagedRuntime(): boolean {
  return process.env.AGENTFORGE_PACKAGED?.trim() === "1";
}

/**
 * Dev/test hook only. `AGENTFORGE_GATEWAY_URL` may re-point the gateway on a developer machine
 * (branded flavors, a local mock) but never in a packaged build and never in production, so the
 * shipped product always resolves to `PINNED_GATEWAY_BASE_URL`.
 */
export function gatewayUrlOverrideAllowed(): boolean {
  return !isPackagedRuntime() && process.env.NODE_ENV !== "production";
}
