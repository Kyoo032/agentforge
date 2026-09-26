import { describe, expect, it } from "vitest";
import type { GatewayGatePayload } from "./gateway-gate";
import { hostWithholdsLiveModel } from "./use-desk-needs-key";

function gate(patch: Partial<GatewayGatePayload>): GatewayGatePayload {
  return {
    status: "ok",
    allowed: true,
    grace: false,
    endpoint: "https://api.tokotokenai.com/v1",
    endpointLocked: true,
    checkedAt: null,
    lastOkAt: null,
    ...patch,
  };
}

describe("hostWithholdsLiveModel", () => {
  it("lets a stub desk send because the host left allowed true", () => {
    expect(hostWithholdsLiveModel(gate({ status: "stub", allowed: true }))).toBe(false);
  });

  it("quiets only when the host set allowed false", () => {
    expect(hostWithholdsLiveModel(gate({ status: "needs_key", allowed: false }))).toBe(true);
    expect(hostWithholdsLiveModel(gate({ status: "invalid_key", allowed: false }))).toBe(true);
    expect(hostWithholdsLiveModel(gate({ status: "unreachable", allowed: false }))).toBe(true);
  });

  it("does not invent a block from status when the host allowed the desk", () => {
    expect(hostWithholdsLiveModel(gate({ status: "ok", allowed: true }))).toBe(false);
    expect(hostWithholdsLiveModel(gate({ status: "error", allowed: true }))).toBe(false);
  });

  it("does not block when the gate has not arrived", () => {
    expect(hostWithholdsLiveModel(null)).toBe(false);
    expect(hostWithholdsLiveModel(undefined)).toBe(false);
  });
});
