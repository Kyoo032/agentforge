import { createHash } from "node:crypto";
import { PINNED_GATEWAY_BASE_URL, PINNED_GATEWAY_BASE_URL_SHA256 } from "./pinned";

/**
 * Boot check for Node (host / tests). A patched binary that swapped the endpoint constant fails
 * loudly here instead of quietly shipping the owner's key to somebody else's server.
 *
 * Keep this file off the renderer graph — `node:crypto` is not available in the Vite client.
 */
export function assertPinnedGatewayIntegrity(): void {
  const actual = createHash("sha256").update(PINNED_GATEWAY_BASE_URL, "utf8").digest("hex");
  if (actual !== PINNED_GATEWAY_BASE_URL_SHA256) {
    throw new Error(
      `Gateway endpoint integrity check failed: expected sha256 ${PINNED_GATEWAY_BASE_URL_SHA256}, got ${actual}. This build has been tampered with.`,
    );
  }
}
