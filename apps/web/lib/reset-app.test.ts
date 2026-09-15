import { describe, expect, it } from "vitest";
import { parseCancelResetResult, parseResetResult, RESET_CONFIRM_WORD, RESET_SCOPES } from "./reset-app";

const gateway = {
  status: "needs_key",
  allowed: false,
  grace: false,
  endpoint: "https://api.tokotokenai.com/v1",
  endpointLocked: true,
  checkedAt: "2026-09-15T04:00:00.000Z",
  lastOkAt: null,
};

describe("parseResetResult", () => {
  it("reads a signed-out key reset", () => {
    expect(parseResetResult(200, { ok: true, scope: "key", relaunch: false, gateway }, "key")).toEqual({
      ok: true,
      scope: "key",
      relaunch: false,
      resetPending: false,
      gateway: {
        status: "needs_key",
        allowed: false,
        grace: false,
        endpoint: "https://api.tokotokenai.com/v1",
        endpointLocked: true,
        checkedAt: "2026-09-15T04:00:00.000Z",
        lastOkAt: null,
      },
    });
  });

  it("reads a fresh-install reset that needs a relaunch", () => {
    const result = parseResetResult(200, { ok: true, scope: "all", relaunch: true, gateway }, "all");
    expect(result.ok).toBe(true);
    expect(result.scope).toBe("all");
    expect(result.relaunch).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("reads a 400 invalid_request with its message", () => {
    expect(
      parseResetResult(400, { error: { code: "invalid_request", message: " confirm must be RESET " } }, "all"),
    ).toEqual({
      ok: false,
      scope: "all",
      relaunch: false,
      resetPending: false,
      gateway: null,
      error: "confirm must be RESET",
    });
  });

  it("keeps the requested scope when the host echoes none", () => {
    expect(parseResetResult(400, { error: { code: "invalid_request" } }, "all").scope).toBe("all");
    expect(parseResetResult(400, { error: { code: "invalid_request" } }).scope).toBe("key");
    expect(parseResetResult(200, { ok: true, scope: "banana" }, "all").scope).toBe("all");
  });

  it("reports a plain string error body", () => {
    expect(parseResetResult(400, { error: " nope " }, "key").error).toBe("nope");
  });

  it("never reports done for a malformed body", () => {
    for (const body of [null, undefined, "ok", 42, [], { ok: "true" }, {}]) {
      const result = parseResetResult(200, body, "all");
      expect(result.ok).toBe(false);
      expect(result.relaunch).toBe(false);
      expect(result.gateway).toBeNull();
      expect(result.scope).toBe("all");
    }
  });

  it("never reports done on a non-200 that still says ok", () => {
    const result = parseResetResult(500, { ok: true, scope: "all", relaunch: true }, "all");
    expect(result.ok).toBe(false);
    expect(result.relaunch).toBe(false);
  });

  it("never relaunches unless the host asked in so many words", () => {
    expect(parseResetResult(200, { ok: true, scope: "all", relaunch: "yes" }, "all").relaunch).toBe(false);
    expect(parseResetResult(200, { ok: true, scope: "all" }, "all").relaunch).toBe(false);
  });

  it("reads the queued wipe the host reports", () => {
    expect(
      parseResetResult(200, { ok: true, scope: "all", relaunch: true, resetPending: true }, "all").resetPending,
    ).toBe(true);
    expect(parseResetResult(200, { ok: true, scope: "all", relaunch: true }, "all").resetPending).toBe(false);
    expect(parseResetResult(200, { ok: true, scope: "all", resetPending: "yes" }, "all").resetPending).toBe(false);
    expect(parseResetResult(500, { resetPending: true }, "all").resetPending).toBe(true);
  });

  it("ships the literal confirm word and both scopes", () => {
    expect(RESET_CONFIRM_WORD).toBe("RESET");
    expect([...RESET_SCOPES]).toEqual(["key", "all"]);
  });
});

describe("parseCancelResetResult", () => {
  it("reads a cancelled wipe", () => {
    expect(parseCancelResetResult(200, { ok: true, resetPending: false })).toEqual({ ok: true, resetPending: false });
  });

  it("keeps the wipe queued for anything that is not an explicit success", () => {
    for (const [status, body] of [
      [500, { ok: true, resetPending: false }],
      [200, { ok: false }],
      [200, null],
      [200, "ok"],
      [404, { error: { code: "not_found", message: " nothing queued " } }],
    ] as const) {
      const result = parseCancelResetResult(status, body);
      expect(result.ok).toBe(false);
      expect(result.resetPending).toBe(true);
    }
  });

  it("carries the host's message for a refused cancel", () => {
    expect(parseCancelResetResult(409, { error: { message: " too late " } }).error).toBe("too late");
    expect(parseCancelResetResult(200, { ok: true, resetPending: false }).error).toBeUndefined();
  });

  it("believes the host when it says the wipe is still queued", () => {
    expect(parseCancelResetResult(200, { ok: true, resetPending: true })).toEqual({ ok: true, resetPending: true });
  });
});
