import { describe, expect, it } from "vitest";
import {
  announceGate,
  formatGateTimestamp,
  gatewayReasonKey,
  gatewayStatusKey,
  GATE_EVENT,
  GATEWAY_GATE_STATUSES,
  MISSING_GATEWAY_GATE,
  parseGatewayBlocked,
  parseGatewayGate,
  readGateEvent,
  resolveGate,
  type GatewayGatePayload,
  type GatewayGateStatus,
} from "./gateway-gate";

function gate(patch: Partial<GatewayGatePayload> = {}): GatewayGatePayload {
  return {
    status: "ok",
    allowed: true,
    grace: false,
    endpoint: "https://api.tokotokenai.com/v1",
    endpointLocked: true,
    checkedAt: "2026-09-14T04:00:00.000Z",
    lastOkAt: "2026-09-14T04:00:00.000Z",
    ...patch,
  };
}

describe("resolveGate", () => {
  const openers: Array<[GatewayGateStatus, boolean]> = [
    ["ok", true],
    ["stub", true],
  ];

  for (const [status, allowed] of openers) {
    it(`opens the app on ${status} when the host allows it`, () => {
      expect(resolveGate(gate({ status, allowed }), true)).toBe("app");
      expect(resolveGate(gate({ status, allowed }), false)).toBe("app");
    });
  }

  const blockers: GatewayGateStatus[] = ["needs_key", "invalid_key", "unreachable", "error"];

  for (const status of blockers) {
    it(`shows onboarding on ${status}`, () => {
      expect(resolveGate(gate({ status, allowed: false }), true)).toBe("onboarding");
      expect(resolveGate(gate({ status, allowed: false }), false)).toBe("onboarding");
    });
  }

  it("follows the host, not the status name, when the host says allowed", () => {
    // Offline grace can arrive with a non-ok status; the host still decides.
    expect(resolveGate(gate({ status: "unreachable", allowed: true, grace: true }), true)).toBe("app");
  });

  it("never opens on a status the host marked as not allowed", () => {
    for (const status of GATEWAY_GATE_STATUSES) {
      expect(resolveGate(gate({ status, allowed: false }), true)).toBe("onboarding");
    }
  });

  it("fails closed in Electron when the host reports no gate", () => {
    expect(resolveGate(undefined, true)).toBe("onboarding");
    expect(resolveGate(null, true)).toBe("onboarding");
    expect(resolveGate({}, true)).toBe("onboarding");
    expect(resolveGate({ status: "ok" }, true)).toBe("onboarding");
    expect(resolveGate({ allowed: true }, true)).toBe("onboarding");
    expect(resolveGate({ status: "yes", allowed: true }, true)).toBe("onboarding");
    expect(resolveGate("ok", true)).toBe("onboarding");
  });

  it("keeps webdev working when the host reports no gate", () => {
    expect(resolveGate(undefined, false)).toBe("app");
    expect(resolveGate(null, false)).toBe("app");
    expect(resolveGate({}, false)).toBe("app");
    expect(resolveGate({ status: "yes", allowed: true }, false)).toBe("app");
  });

  it("has no bypass for a truthy-looking extra field", () => {
    expect(resolveGate({ status: "invalid_key", allowed: false, bypass: true }, true)).toBe("onboarding");
  });
});

describe("parseGatewayGate", () => {
  it("keeps the reported gate and pins endpointLocked", () => {
    const parsed = parseGatewayGate({
      status: "invalid_key",
      allowed: false,
      grace: false,
      endpoint: "https://api.tokotokenai.com/v1 ",
      endpointLocked: true,
      checkedAt: "2026-09-14T04:00:00.000Z",
      lastOkAt: null,
      message: " 401 from gateway ",
    });
    expect(parsed).toEqual({
      status: "invalid_key",
      allowed: false,
      grace: false,
      endpoint: "https://api.tokotokenai.com/v1",
      endpointLocked: true,
      checkedAt: "2026-09-14T04:00:00.000Z",
      lastOkAt: null,
      message: "401 from gateway",
    });
  });

  it("reads grace only when the host set it", () => {
    expect(parseGatewayGate(gate({ grace: true }))?.grace).toBe(true);
    expect(parseGatewayGate({ ...gate(), grace: "yes" })?.grace).toBe(false);
    expect(parseGatewayGate(gate())?.grace).toBe(false);
  });

  it("falls back to the pinned endpoint and drops an empty message", () => {
    const parsed = parseGatewayGate({ status: "needs_key", allowed: false, endpoint: "  ", message: "  " });
    expect(parsed?.endpoint).toBe(MISSING_GATEWAY_GATE.endpoint);
    expect(parsed?.message).toBeUndefined();
    expect(parsed?.checkedAt).toBeNull();
    expect(parsed?.lastOkAt).toBeNull();
  });

  it("returns null for anything that is not a gate", () => {
    expect(parseGatewayGate(undefined)).toBeNull();
    expect(parseGatewayGate(null)).toBeNull();
    expect(parseGatewayGate("ok")).toBeNull();
    expect(parseGatewayGate({ status: "ok", allowed: "true" })).toBeNull();
  });

  it("ships a fail-closed fallback", () => {
    expect(MISSING_GATEWAY_GATE.allowed).toBe(false);
    expect(MISSING_GATEWAY_GATE.status).toBe("error");
    expect(resolveGate(MISSING_GATEWAY_GATE, true)).toBe("onboarding");
  });
});

describe("copy keys", () => {
  it("explains only the statuses that need a reason", () => {
    expect(gatewayReasonKey("invalid_key")).toBe("onboarding.gate.invalidKey");
    expect(gatewayReasonKey("unreachable")).toBe("onboarding.gate.unreachable");
    expect(gatewayReasonKey("error")).toBe("onboarding.gate.error");
    expect(gatewayReasonKey("needs_key")).toBeNull();
    expect(gatewayReasonKey("ok")).toBeNull();
    expect(gatewayReasonKey("stub")).toBeNull();
    expect(gatewayReasonKey(null)).toBeNull();
  });

  it("names a settings status key for every status", () => {
    for (const status of GATEWAY_GATE_STATUSES) {
      expect(gatewayStatusKey(status)).toBe(`settings.gateway.status.${status}`);
    }
  });
});

describe("parseGatewayBlocked", () => {
  it("reads a 403 gateway_blocked body", () => {
    expect(parseGatewayBlocked({ error: "gateway_blocked", status: "invalid_key", message: " key rejected " })).toEqual(
      { status: "invalid_key", message: "key rejected" },
    );
  });

  it("falls back to error for an unknown status and a missing message", () => {
    expect(parseGatewayBlocked({ error: "gateway_blocked", status: "banana" })).toEqual({
      status: "error",
      message: null,
    });
    expect(parseGatewayBlocked({ error: "gateway_blocked" })).toEqual({ status: "error", message: null });
  });

  it("ignores any other error body", () => {
    expect(parseGatewayBlocked({ error: "runtime_stub" })).toBeNull();
    expect(parseGatewayBlocked({ error: { message: "nope" } })).toBeNull();
    expect(parseGatewayBlocked(null)).toBeNull();
    expect(parseGatewayBlocked("gateway_blocked")).toBeNull();
  });
});

describe("formatGateTimestamp", () => {
  it("formats an ISO date per locale", () => {
    expect(formatGateTimestamp("2026-09-14T04:00:00.000Z", "en")).toMatch(/2026/);
    expect(formatGateTimestamp("2026-09-14T04:00:00.000Z", "id")).toMatch(/2026/);
  });

  it("returns null when there is nothing to show", () => {
    expect(formatGateTimestamp(null, "en")).toBeNull();
    expect(formatGateTimestamp(undefined, "en")).toBeNull();
    expect(formatGateTimestamp("not-a-date", "en")).toBeNull();
  });

  it("adds a time only when asked", () => {
    const dateOnly = formatGateTimestamp("2026-09-14T04:00:00.000Z", "en");
    const withTime = formatGateTimestamp("2026-09-14T04:00:00.000Z", "en", true);
    expect(withTime).not.toBe(dateOnly);
    expect(withTime?.length).toBeGreaterThan((dateOnly ?? "").length);
  });
});

describe("gate events", () => {
  it("names one event for the whole renderer", () => {
    expect(GATE_EVENT).toBe("agentforge-gate");
  });

  it("reads a gate back out of an event detail", () => {
    const event = { type: GATE_EVENT, detail: gate({ status: "needs_key", allowed: false }) } as unknown as Event;
    expect(readGateEvent(event)).toEqual(gate({ status: "needs_key", allowed: false }));
  });

  it("returns null when the detail is not a gate", () => {
    for (const detail of [null, undefined, "needs_key", {}, { status: "ok" }, { status: "yes", allowed: true }]) {
      expect(readGateEvent({ type: GATE_EVENT, detail } as unknown as Event)).toBeNull();
    }
    expect(readGateEvent({ type: GATE_EVENT } as unknown as Event)).toBeNull();
  });

  it("re-parses the detail rather than trusting it", () => {
    const event = {
      type: GATE_EVENT,
      detail: { status: "ok", allowed: true, endpoint: "  ", grace: "yes", bypass: true },
    } as unknown as Event;
    const read = readGateEvent(event);
    expect(read?.grace).toBe(false);
    expect(read?.endpointLocked).toBe(true);
    expect(read).not.toHaveProperty("bypass");
  });

  it("does nothing when there is no window to announce on", () => {
    expect(typeof window).toBe("undefined");
    expect(() => announceGate(gate())).not.toThrow();
    expect(() => announceGate(null)).not.toThrow();
  });
});
