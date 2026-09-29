"use client";

import { useEffect, useState } from "react";
import { readSettings } from "@/lib/settings-read";
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
    // Shared with the shell's gate read and the other Chat readers: one round trip per load.
    void readSettings()
      .then((answer) => {
        if (cancelled || !answer.ok || !answer.body) return;
        setNeedsKey(hostWithholdsLiveModel(parseGatewayGate(answer.body.gateway)));
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
