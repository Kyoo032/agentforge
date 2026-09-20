import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Isolation: the gate state file lives in the data dir, so point it at a temp folder first.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-gateway-gate-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.AGENTFORGE_RUNTIME;
delete process.env.OPENAI_API_KEY;

import { LOCAL_TENANT_ID } from "@agentforge/core";

type Mod = typeof import("./gateway-gate");
let gate: Mod;

type Saved = NonNullable<ReturnType<Mod["loadGateState"]>>;

const ENDPOINT = "https://gateway.example/v1";
const KEY = "sk-gate-test-000000000000";
const NOW = new Date("2026-09-15T12:00:00.000Z");
const DAY_MS = 86_400_000;

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

function state(patch: Partial<Saved> = {}): Saved {
  return {
    version: 1,
    fingerprint: "sha256:abcdef123456",
    status: "ok",
    checkedAt: iso(0),
    lastOkAt: iso(0),
    ...patch,
  };
}

function derive(overrides: Record<string, unknown> = {}) {
  return gate.deriveGatewayGate({
    envRuntime: undefined,
    hasKey: true,
    fingerprint: "sha256:abcdef123456",
    endpoint: ENDPOINT,
    state: null,
    now: NOW,
    ...overrides,
  } as Parameters<Mod["deriveGatewayGate"]>[0]);
}

function fakeFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return ((url: string, init: RequestInit) =>
    Promise.resolve(handler(String(url), init ?? {}))) as unknown as typeof fetch;
}

beforeAll(async () => {
  gate = await import("./gateway-gate");
});

afterEach(() => {
  gate.clearGateState();
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("deriveGatewayGate", () => {
  it("keeps stub runtime open without looking at the key", () => {
    const payload = derive({ envRuntime: "stub", hasKey: false, fingerprint: null });
    expect(payload).toMatchObject({ status: "stub", allowed: true, grace: false, endpointLocked: true });
    expect(payload.endpoint).toBe(ENDPOINT);
  });

  it("reports needs_key with no key saved", () => {
    const payload = derive({ hasKey: false, fingerprint: null });
    expect(payload).toMatchObject({ status: "needs_key", allowed: false, grace: false });
    expect(payload.checkedAt).toBeNull();
    expect(payload.lastOkAt).toBeNull();
  });

  it("keeps a key that has never been checked open, on trust, and says so", () => {
    // Every install that upgraded into the gate looks like this. Locking them out is not an option;
    // `maybeRefreshGateway` is what turns the trust into a verdict.
    const payload = derive({ state: null });
    expect(payload).toMatchObject({ status: "ok", allowed: true, grace: true });
    expect(payload.message).toBe("Not checked yet.");
    expect(payload.checkedAt).toBeNull();
    expect(payload.lastOkAt).toBeNull();
  });

  it("treats a verdict that belongs to a different key as never checked", () => {
    const payload = derive({ state: state({ fingerprint: "sha256:999999999999" }) });
    expect(payload).toMatchObject({ status: "ok", allowed: true, grace: true });
    expect(payload.lastOkAt).toBeNull();
  });

  it("treats a persisted stub or needs_key verdict as never checked", () => {
    for (const status of ["stub", "needs_key"] as const) {
      const payload = derive({ state: state({ status }) });
      expect(payload).toMatchObject({ status: "ok", allowed: true, grace: true });
    }
  });

  it("puts an ok verdict older than the TTL on grace instead of standing on it", () => {
    const stale = derive({
      state: state({ status: "ok", checkedAt: iso(2 * DAY_MS), lastOkAt: iso(2 * DAY_MS) }),
    });
    expect(stale).toMatchObject({ status: "ok", allowed: true, grace: true });

    const expired = derive({
      state: state({ status: "ok", checkedAt: iso(8 * DAY_MS), lastOkAt: iso(8 * DAY_MS) }),
    });
    expect(expired).toMatchObject({ status: "ok", allowed: false, grace: true });
  });

  it("keeps grace when the clock moved backwards", () => {
    // An NTP correction, a DST fix, a restored VM: a future lastOkAt is a clock problem, not an
    // expired key, so the age is clamped to zero rather than read as negative.
    const payload = derive({
      state: state({ status: "unreachable", checkedAt: iso(0), lastOkAt: iso(-3 * DAY_MS) }),
    });
    expect(payload).toMatchObject({ status: "unreachable", allowed: true, grace: true });
  });

  it("allows a key that validated", () => {
    const payload = derive({ state: state() });
    expect(payload).toMatchObject({ status: "ok", allowed: true, grace: false });
    expect(payload.lastOkAt).toBe(iso(0));
  });

  it("gives an invalid key no grace even when it worked yesterday", () => {
    const payload = derive({
      state: state({ status: "invalid_key", checkedAt: iso(0), lastOkAt: iso(DAY_MS), message: "HTTP 401" }),
    });
    expect(payload).toMatchObject({ status: "invalid_key", allowed: false, grace: false });
  });

  it("grants grace to an unreachable gateway inside the window", () => {
    const payload = derive({
      state: state({ status: "unreachable", checkedAt: iso(0), lastOkAt: iso(DAY_MS) }),
    });
    expect(payload).toMatchObject({ status: "unreachable", allowed: true, grace: true });
  });

  it("grants grace at exactly 7 days and denies one millisecond later", () => {
    const atBoundary = derive({
      state: state({ status: "error", checkedAt: iso(0), lastOkAt: iso(7 * DAY_MS) }),
    });
    expect(atBoundary).toMatchObject({ allowed: true, grace: true });

    const pastBoundary = derive({
      state: state({ status: "error", checkedAt: iso(0), lastOkAt: iso(7 * DAY_MS + 1) }),
    });
    expect(pastBoundary).toMatchObject({ allowed: false, grace: false });
  });

  it("denies an unreachable gateway that never validated", () => {
    const payload = derive({
      state: state({ status: "unreachable", checkedAt: iso(0), lastOkAt: null }),
    });
    expect(payload).toMatchObject({ allowed: false, grace: false });
  });
});

describe("checkGatewayLive", () => {
  it("maps 2xx to ok", async () => {
    const result = await gate.checkGatewayLive({
      key: KEY,
      baseUrl: ENDPOINT,
      fetchImpl: fakeFetch(() => new Response("{}", { status: 200 })),
    });
    expect(result.status).toBe("ok");
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
  });

  it("sends the key as a bearer token to /models", async () => {
    let seenUrl = "";
    let seenAuth = "";
    await gate.checkGatewayLive({
      key: KEY,
      baseUrl: `${ENDPOINT}/`,
      fetchImpl: fakeFetch((url, init) => {
        seenUrl = url;
        seenAuth = String((init.headers as Record<string, string>).Authorization ?? "");
        return new Response("{}", { status: 200 });
      }),
    });
    expect(seenUrl).toBe(`${ENDPOINT}/models`);
    expect(seenAuth).toBe(`Bearer ${KEY}`);
  });

  it("maps 401 and 403 to invalid_key without echoing the key", async () => {
    for (const status of [401, 403]) {
      const result = await gate.checkGatewayLive({
        key: KEY,
        baseUrl: ENDPOINT,
        fetchImpl: fakeFetch(() => new Response("nope", { status })),
      });
      expect(result.status).toBe("invalid_key");
      expect(result.message ?? "").not.toContain(KEY);
    }
  });

  it("maps other HTTP failures to error with the status", async () => {
    const result = await gate.checkGatewayLive({
      key: KEY,
      baseUrl: ENDPOINT,
      fetchImpl: fakeFetch(() => new Response("boom", { status: 502 })),
    });
    expect(result.status).toBe("error");
    expect(result.message).toBe("HTTP 502");
  });

  it("maps a timeout or network failure to unreachable", async () => {
    const aborted = await gate.checkGatewayLive({
      key: KEY,
      baseUrl: ENDPOINT,
      fetchImpl: fakeFetch(() => {
        throw new DOMException("The operation was aborted.", "TimeoutError");
      }),
    });
    expect(aborted.status).toBe("unreachable");

    const offline = await gate.checkGatewayLive({
      key: KEY,
      baseUrl: ENDPOINT,
      fetchImpl: fakeFetch(() => {
        throw new TypeError("fetch failed");
      }),
    });
    expect(offline.status).toBe("unreachable");
  });

  it("refuses a plain-HTTP remote endpoint", async () => {
    await expect(
      gate.checkGatewayLive({
        key: KEY,
        baseUrl: "http://gateway.example/v1",
        fetchImpl: fakeFetch(() => new Response("{}", { status: 200 })),
      }),
    ).rejects.toThrow();
  });
});

describe("runGatewayCheck", () => {
  const settings = { openaiApiKey: KEY, openaiBaseUrl: ENDPOINT };

  it("persists a successful check and allows the app", async () => {
    const payload = await gate.runGatewayCheck(settings, {
      envRuntime: undefined,
      fetchImpl: fakeFetch(() => new Response("{}", { status: 200 })),
    });
    expect(payload).toMatchObject({ status: "ok", allowed: true, grace: false, endpointLocked: true });

    const file = join(dataDir, gate.GATEWAY_GATE_FILE);
    expect(existsSync(file)).toBe(true);
    const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(saved.status).toBe("ok");
    expect(saved.lastOkAt).toBe(saved.checkedAt);
    expect(JSON.stringify(saved)).not.toContain(KEY);
  });

  it("keeps lastOkAt across a failed check of the same key, so grace works offline", async () => {
    await gate.runGatewayCheck(settings, {
      envRuntime: undefined,
      fetchImpl: fakeFetch(() => new Response("{}", { status: 200 })),
    });
    const okAt = gate.loadGateState(LOCAL_TENANT_ID)?.lastOkAt;

    const payload = await gate.runGatewayCheck(settings, {
      envRuntime: undefined,
      fetchImpl: fakeFetch(() => {
        throw new TypeError("fetch failed");
      }),
    });
    expect(payload).toMatchObject({ status: "unreachable", allowed: true, grace: true });
    expect(gate.loadGateState(LOCAL_TENANT_ID)?.lastOkAt).toBe(okAt);
  });

  it("drops the old lastOkAt when the key changed", async () => {
    await gate.runGatewayCheck(settings, {
      envRuntime: undefined,
      fetchImpl: fakeFetch(() => new Response("{}", { status: 200 })),
    });

    const payload = await gate.runGatewayCheck(
      { openaiApiKey: "sk-gate-test-111111111111", openaiBaseUrl: ENDPOINT },
      {
        envRuntime: undefined,
        fetchImpl: fakeFetch(() => {
          throw new TypeError("fetch failed");
        }),
      },
    );
    expect(payload).toMatchObject({ status: "unreachable", allowed: false, grace: false });
    expect(gate.loadGateState(LOCAL_TENANT_ID)?.lastOkAt).toBeNull();
  });

  it("never touches the network in stub runtime or without a key", async () => {
    let calls = 0;
    const counting = fakeFetch(() => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });

    const stub = await gate.runGatewayCheck(settings, { envRuntime: "stub", fetchImpl: counting });
    expect(stub.status).toBe("stub");

    const empty = await gate.runGatewayCheck(
      { openaiBaseUrl: ENDPOINT },
      { envRuntime: undefined, fetchImpl: counting },
    );
    expect(empty.status).toBe("needs_key");
    expect(calls).toBe(0);
  });
});

describe("gate state file", () => {
  it("round-trips, clears, and treats a corrupt file as absent", () => {
    expect(gate.loadGateState(LOCAL_TENANT_ID)).toBeNull();
    gate.saveGateState(LOCAL_TENANT_ID, {
      version: 1,
      fingerprint: "sha256:abcdef123456",
      status: "ok",
      checkedAt: iso(0),
      lastOkAt: iso(0),
    });
    expect(gate.loadGateState(LOCAL_TENANT_ID)).toMatchObject({ status: "ok", fingerprint: "sha256:abcdef123456" });

    writeFileSync(join(dataDir, gate.GATEWAY_GATE_FILE), "{not json", "utf8");
    expect(gate.loadGateState(LOCAL_TENANT_ID)).toBeNull();

    gate.clearGateState();
    expect(existsSync(join(dataDir, gate.GATEWAY_GATE_FILE))).toBe(false);
    expect(() => gate.clearGateState()).not.toThrow();
  });
});

describe("gatewayEndpointFor", () => {
  it("checks the pinned endpoint, never a settings-supplied one", async () => {
    const { resolvedGatewayBaseUrl } = await import("@agentforge/core");
    const pinned = resolvedGatewayBaseUrl();
    expect(gate.gatewayEndpointFor({ openaiBaseUrl: "https://attacker.example/v1" })).toBe(pinned);
    expect(gate.gatewayEndpointFor({})).toBe(pinned);

    // And the live check goes there too: the gate must validate the URL the model calls use.
    let seen = "";
    await gate.runGatewayCheck(
      { openaiApiKey: KEY, openaiBaseUrl: "https://attacker.example/v1" },
      {
        envRuntime: undefined,
        fetchImpl: fakeFetch((url) => {
          seen = url;
          return new Response("{}", { status: 200 });
        }),
      },
    );
    expect(seen).toBe(`${pinned}/models`);
    expect(seen).not.toContain("attacker.example");
  });
});

describe("the key the gate judges", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("uses OPENAI_API_KEY only when the desk asked for the live runtime", () => {
    process.env.OPENAI_API_KEY = "sk-env-fallback-0000000000";

    // A dev box with a stray export, after "forget my key": no key is saved, so this is needs_key.
    expect(gate.reportGatewayGate({}, { envRuntime: undefined })).toMatchObject({
      status: "needs_key",
      allowed: false,
    });

    // AGENTFORGE_RUNTIME=ai is an explicit "use the env key", so the gate judges that key.
    expect(gate.reportGatewayGate({}, { envRuntime: "ai" }).status).not.toBe("needs_key");
  });

  it("prefers the saved key over the environment", () => {
    process.env.OPENAI_API_KEY = "sk-env-fallback-0000000000";
    let seenAuth = "";
    return gate
      .runGatewayCheck(
        { openaiApiKey: KEY },
        {
          envRuntime: "ai",
          fetchImpl: fakeFetch((_url, init) => {
            seenAuth = String((init.headers as Record<string, string>).Authorization ?? "");
            return new Response("{}", { status: 200 });
          }),
        },
      )
      .then(() => {
        expect(seenAuth).toBe(`Bearer ${KEY}`);
      });
  });
});

describe("requireGatewayAllowed", () => {
  it("passes a gate that is open and throws 403 gateway_blocked when it is not", () => {
    expect(() => gate.requireGatewayAllowed({}, { envRuntime: "stub" })).not.toThrow();

    let thrown: unknown;
    try {
      gate.requireGatewayAllowed({}, { envRuntime: undefined });
    } catch (error) {
      thrown = error;
    }
    expect(gate.isGatewayBlockedError(thrown)).toBe(true);
    const blocked = thrown as InstanceType<Mod["GatewayBlockedError"]>;
    expect(blocked.code).toBe("gateway_blocked");
    expect(blocked.status).toBe(403);
    expect(blocked.gateStatus).toBe("needs_key");
    expect(blocked.message).toMatch(/no gateway key/i);
  });
});

describe("maybeRefreshGateway", () => {
  const settings = { openaiApiKey: KEY };

  function counting(): { calls: number; run: (s: unknown, o: unknown) => Promise<unknown> } {
    const box = { calls: 0, run: async () => ({}) };
    box.run = async () => {
      box.calls += 1;
      return {};
    };
    return box;
  }

  async function persistOk(checkedAt: string): Promise<void> {
    await gate.runGatewayCheck(settings, {
      envRuntime: undefined,
      fetchImpl: fakeFetch(() => new Response("{}", { status: 200 })),
    });
    const saved = gate.loadGateState(LOCAL_TENANT_ID);
    if (!saved) {
      throw new Error("expected a saved verdict");
    }
    gate.saveGateState(LOCAL_TENANT_ID, { ...saved, checkedAt, lastOkAt: checkedAt });
  }

  beforeEach(() => {
    gate.resetGatewayRefreshThrottle();
  });

  it("checks a key that has no verdict yet", () => {
    const box = counting();
    expect(gate.maybeRefreshGateway(settings, { envRuntime: undefined, runCheck: box.run, nowMs: () => 0 })).toBe(true);
    expect(box.calls).toBe(1);
  });

  it("re-checks an ok verdict that has aged past the TTL, and leaves a fresh one alone", async () => {
    await persistOk(iso(0));
    const fresh = counting();
    expect(
      gate.maybeRefreshGateway(settings, {
        envRuntime: undefined,
        runCheck: fresh.run,
        now: NOW,
        nowMs: () => 0,
      }),
    ).toBe(false);

    await persistOk(iso(2 * DAY_MS));
    const stale = counting();
    expect(
      gate.maybeRefreshGateway(settings, {
        envRuntime: undefined,
        runCheck: stale.run,
        now: NOW,
        nowMs: () => 0,
      }),
    ).toBe(true);
    expect(stale.calls).toBe(1);
  });

  it("checks at most once per ten minutes for the same key", () => {
    const box = counting();
    let clock = 1_000_000;
    const call = () =>
      gate.maybeRefreshGateway(settings, { envRuntime: undefined, runCheck: box.run, nowMs: () => clock });

    expect(call()).toBe(true);
    clock += 60_000;
    expect(call()).toBe(false);
    clock += 60_000;
    expect(call()).toBe(false);
    clock += 9 * 60_000;
    expect(call()).toBe(true);
    expect(box.calls).toBe(2);
  });

  it("never checks in stub runtime or without a key", () => {
    const box = counting();
    expect(gate.maybeRefreshGateway(settings, { envRuntime: "stub", runCheck: box.run })).toBe(false);
    expect(gate.maybeRefreshGateway({}, { envRuntime: undefined, runCheck: box.run })).toBe(false);
    expect(box.calls).toBe(0);
  });
});

describe("deriveGatewayGate in server mode", () => {
  const SERVER = { AGENTFORGE_SERVER: "1" };
  const DESK = {};

  it("does not let the stub runtime open the gate on the server", () => {
    const payload = derive({ env: SERVER, envRuntime: "stub", hasKey: false, state: null });
    expect(payload).toMatchObject({ status: "needs_key", allowed: false, grace: false });
    expect(derive({ env: DESK, envRuntime: "stub", hasKey: false, state: null })).toMatchObject({
      status: "stub",
      allowed: true,
    });
  });

  it("refuses to take an unverified key on trust", () => {
    const payload = derive({ env: SERVER, state: null });
    expect(payload).toMatchObject({ status: "error", allowed: false, grace: false });
    expect(payload.message).toBe(gate.GATEWAY_UNVERIFIED_MESSAGE);
    expect(payload.checkedAt).toBeNull();
    expect(payload.lastOkAt).toBeNull();
  });

  it("refuses a verdict that belongs to a different key", () => {
    const payload = derive({ env: SERVER, state: state({ fingerprint: "sha256:someone-else" }) });
    expect(payload).toMatchObject({ status: "error", allowed: false, grace: false });
  });

  it("refuses a persisted stub or needs_key verdict, which is no verdict at all", () => {
    for (const status of ["stub", "needs_key"] as const) {
      expect(derive({ env: SERVER, state: state({ status }) })).toMatchObject({ status: "error", allowed: false });
    }
  });

  it("still opens on a verdict the gateway actually gave", () => {
    expect(derive({ env: SERVER, state: state() })).toMatchObject({ status: "ok", allowed: true, grace: false });
  });

  it("still grants the 7-day grace after a real ok, offline or past the TTL", () => {
    const offline = derive({
      env: SERVER,
      state: state({ status: "unreachable", checkedAt: iso(0), lastOkAt: iso(3 * DAY_MS) }),
    });
    expect(offline).toMatchObject({ status: "unreachable", allowed: true, grace: true });

    const stale = derive({ env: SERVER, state: state({ checkedAt: iso(2 * DAY_MS), lastOkAt: iso(2 * DAY_MS) }) });
    expect(stale).toMatchObject({ status: "ok", allowed: true, grace: true });
  });

  it("never grants grace from a cold state", () => {
    for (const status of ["unreachable", "error"] as const) {
      const cold = derive({ env: SERVER, state: state({ status, checkedAt: iso(0), lastOkAt: null }) });
      expect(cold).toMatchObject({ status, allowed: false, grace: false });
    }
    const expired = derive({
      env: SERVER,
      state: state({ status: "error", checkedAt: iso(0), lastOkAt: iso(8 * DAY_MS) }),
    });
    expect(expired).toMatchObject({ allowed: false, grace: false });
  });

  it("keeps needs_key and invalid_key exactly as they are, and closes the stub runtime", () => {
    expect(derive({ env: SERVER, hasKey: false, fingerprint: null })).toMatchObject({
      status: "needs_key",
      allowed: false,
    });
    expect(derive({ env: SERVER, state: state({ status: "invalid_key", lastOkAt: iso(0) }) })).toMatchObject({
      status: "invalid_key",
      allowed: false,
      grace: false,
    });
    // The stub runtime is a desk/CI convenience, never a hosted verdict: on the server it reads as
    // "no usable key" instead of opening the gate.
    expect(derive({ env: SERVER, envRuntime: "stub", hasKey: false })).toMatchObject({
      status: "needs_key",
      allowed: false,
    });
    expect(derive({ env: DESK, envRuntime: "stub", hasKey: false })).toMatchObject({ status: "stub", allowed: true });
  });

  it("closes the stub runtime on the server even when a key is saved", () => {
    expect(derive({ env: SERVER, envRuntime: "stub", hasKey: true })).toMatchObject({
      status: "needs_key",
      allowed: false,
    });
  });

  it("leaves trust-on-first-run untouched on a desk", () => {
    for (const env of [DESK, { AGENTFORGE_SERVER: "0" }, { AGENTFORGE_SERVER: "" }]) {
      expect(derive({ env, state: null })).toMatchObject({ status: "ok", allowed: true, grace: true });
    }
    expect(derive({ env: DESK, state: state({ fingerprint: "sha256:someone-else" }) })).toMatchObject({
      status: "ok",
      allowed: true,
    });
  });
});

describe("requireGatewayAllowed in server mode", () => {
  it("blocks an unverified key with 403 gateway_blocked instead of trusting it", () => {
    const settings = { openaiApiKey: KEY };
    expect(() => gate.requireGatewayAllowed(settings, { envRuntime: undefined })).not.toThrow();

    let thrown: unknown;
    try {
      gate.requireGatewayAllowed(settings, { envRuntime: undefined, env: { AGENTFORGE_SERVER: "true" } });
    } catch (error) {
      thrown = error;
    }
    expect(gate.isGatewayBlockedError(thrown)).toBe(true);
    const blocked = thrown as InstanceType<Mod["GatewayBlockedError"]>;
    expect(blocked.code).toBe("gateway_blocked");
    expect(blocked.status).toBe(403);
    expect(blocked.gateStatus).toBe("error");
    expect(blocked.message).toMatch(/could not be validated/i);
  });
});
