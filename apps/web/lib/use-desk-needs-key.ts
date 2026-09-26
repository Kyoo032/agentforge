"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { parseGatewayGate, type GatewayGatePayload } from "@/lib/gateway-gate";

/**
 * The host already decided. Quiet Send and Generate only when `allowed` is
 * false. Stub reports `allowed: true` so Cloud and Playwright still send.
 * This does not look at status or key shape.
 */
export function hostWithholdsLiveModel(gate: GatewayGatePayload | null | undefined): boolean {
  if (!gate) return false;
  return gate.allowed === false;
}

/** Reads the host's gate once. Unknown (still loading, or no payload) does not block. */
export function useDeskNeedsKey(): boolean {
  const [needsKey, setNeedsKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/v1/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { gateway?: unknown } | null) => {
        if (cancelled || !payload) return;
        setNeedsKey(hostWithholdsLiveModel(parseGatewayGate(payload.gateway)));
      })
      .catch(() => {
        // Leave the controls as they are; a failed settings read is not a new decision.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return needsKey;
}
