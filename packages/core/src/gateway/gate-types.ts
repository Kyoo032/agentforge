/**
 * Shared host/renderer contract for the gateway key gate. The renderer only displays this;
 * enforcement lives in packages/host (`gateway-gate.ts` + `router.ts`).
 */
export type GatewayGateStatus = "stub" | "needs_key" | "ok" | "invalid_key" | "unreachable" | "error";

export type GatewayGatePayload = {
  status: GatewayGateStatus;
  /** The host's final decision, grace included. Gateway-calling routes answer 403 when false. */
  allowed: boolean;
  /** True only when the call is allowed solely because this key validated earlier. */
  grace: boolean;
  /** The pinned gateway URL. */
  endpoint: string;
  endpointLocked: true;
  /** ISO timestamp of the last live check, or null when none has run in this process. */
  checkedAt: string | null;
  /** ISO timestamp of the last successful validation of the current key. */
  lastOkAt: string | null;
  /** Redacted technical detail, English only. */
  message?: string;
};
