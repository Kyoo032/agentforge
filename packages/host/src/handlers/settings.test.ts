import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GatewayGatePayload } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";

// Isolation: database, settings.enc and the gate state all live in the data dir.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-settings-handlers-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "b".repeat(64);
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.OPENAI_API_KEY;

const KEY = "sk-settings-handler-000000000";
const GATE_FILE = join(dataDir, "gateway-gate.json");
const MARKER_FILE = join(dataDir, "reset-pending.json");

type Dispatch = (request: HostRequest) => Promise<HostResult>;
let dispatch: Dispatch;
let store: typeof import("../settings-store");

const realFetch = globalThis.fetch;

function request(method: string, path: string, extra: Partial<HostRequest> = {}): HostRequest {
  return { method, path, query: {}, params: {}, headers: {}, ...extra };
}

type JsonResponse = { status: number; body: Record<string, unknown> };

async function json(method: string, path: string, body?: unknown): Promise<JsonResponse> {
  const result = await dispatch(request(method, path, { body }));
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return { status: result.status, body: (result.body ?? {}) as Record<string, unknown> };
}

/** Answers every outbound call with `status`, so no test touches a real gateway. */
function stubFetch(status: number): void {
  globalThis.fetch = (async () => new Response("{}", { status })) as unknown as typeof fetch;
}

function errorCode(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

function gatewayOf(body: unknown): GatewayGatePayload {
  return (body as { gateway: GatewayGatePayload }).gateway;
}

beforeAll(async () => {
  ({ dispatch } = await import("../router"));
  store = await import("../settings-store");
}, 60_000);

beforeEach(() => {
  process.env.AGENTFORGE_RUNTIME = "stub";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(GATE_FILE, { force: true });
  rmSync(MARKER_FILE, { force: true });
  store.saveSettings({ openaiApiKey: "" });
});

afterAll(async () => {
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("GET /api/v1/settings gateway gate", () => {
  it("reports stub and stays open in stub runtime", async () => {
    const response = await json("GET", "/api/v1/settings");
    expect(response.status).toBe(200);
    const gateway = gatewayOf(response.body);
    expect(gateway.status).toBe("stub");
    expect(gateway.allowed).toBe(true);
    expect(gateway.endpointLocked).toBe(true);
    expect(gateway.endpoint).toMatch(/^https:\/\//);
  });

  it("reports needs_key outside stub runtime with no key saved", async () => {
    delete process.env.AGENTFORGE_RUNTIME;
    const response = await json("GET", "/api/v1/settings");
    const gateway = gatewayOf(response.body);
    expect(gateway.status).toBe("needs_key");
    expect(gateway.allowed).toBe(false);
    expect(gateway.grace).toBe(false);
  });

  it("does not lock out a desk that has a key but no verdict yet", async () => {
    // The upgrade case: the key was saved by a build that had no gate, so nothing ever wrote a
    // verdict for it. The desk stays open on trust, flagged as grace, and a check runs in the
    // background — never the other way round.
    delete process.env.AGENTFORGE_RUNTIME;
    stubFetch(200);
    await json("POST", "/api/v1/settings", { openaiApiKey: KEY });
    // Throw the verdict away, keeping the key: exactly what an upgraded install looks like.
    rmSync(GATE_FILE, { force: true });
    // ...and the background re-check must not be what answers this request.
    globalThis.fetch = (() => new Promise(() => undefined)) as unknown as typeof fetch;

    const gateway = gatewayOf((await json("GET", "/api/v1/settings")).body);
    expect(gateway.allowed).toBe(true);
    expect(gateway.status).toBe("ok");
    expect(gateway.grace).toBe(true);
    expect(gateway.message).toBe("Not checked yet.");

    // The key was saved through the host, so it has to be cleared through the host: `saveSettings`
    // in afterEach writes the default slice, not this tenant's.
    stubFetch(200);
    await json("POST", "/api/v1/settings", { openaiApiKey: "" });
  });

  it("reports whether a wipe is queued", async () => {
    expect((await json("GET", "/api/v1/settings")).body.resetPending).toBe(false);

    await json("POST", "/api/v1/settings/reset", { scope: "all", confirm: "RESET" });
    expect((await json("GET", "/api/v1/settings")).body.resetPending).toBe(true);
  });
});

describe("DELETE /api/v1/settings/reset", () => {
  it("cancels a queued wipe", async () => {
    const queued = await json("POST", "/api/v1/settings/reset", { scope: "all", confirm: "RESET" });
    expect(queued.body.resetPending).toBe(true);
    expect(existsSync(MARKER_FILE)).toBe(true);

    const response = await json("DELETE", "/api/v1/settings/reset");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, resetPending: false });
    expect(existsSync(MARKER_FILE)).toBe(false);
    expect((await json("GET", "/api/v1/settings")).body.resetPending).toBe(false);
  });

  it("is a 200 when nothing was pending", async () => {
    const response = await json("DELETE", "/api/v1/settings/reset");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, resetPending: false });
  });

  it("still cancels when a directory sits where the marker should be", async () => {
    // A botched restore or a sync client can leave a directory at the marker path. Unlinking it
    // without `recursive` throws EISDIR, which would turn "call the wipe off" into a 500 the owner
    // has no way past — with a wipe still queued for the next boot.
    mkdirSync(MARKER_FILE, { recursive: true });
    try {
      const response = await json("DELETE", "/api/v1/settings/reset");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true, resetPending: false });
      expect(existsSync(MARKER_FILE)).toBe(false);
    } finally {
      rmSync(MARKER_FILE, { force: true, recursive: true });
    }
  });
});

describe("host-side gateway enforcement", () => {
  // GET /api/v1/knowledge/context reaches the gateway (it embeds the query), so it is gated. With
  // no query it does no work at all, which makes it the cheapest proof that the guard is wired.
  const GATED = "/api/v1/knowledge/context";

  it("answers 403 gateway_blocked when the gate is closed", async () => {
    delete process.env.AGENTFORGE_RUNTIME;
    const response = await json("GET", GATED);

    expect(response.status).toBe(403);
    // Flat, not the usual { error: { code, message } } envelope: this is the shape the renderer's
    // `parseGatewayBlocked` reads (apps/web/lib/gateway-gate.ts).
    expect(response.body.error).toBe("gateway_blocked");
    expect(response.body.status).toBe("needs_key");
    expect(typeof response.body.message).toBe("string");
  });

  it("lets stub runtime through, so Playwright and Cloud are unaffected", async () => {
    const response = await json("GET", GATED);
    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
  });

  it("does not gate settings, usage or threads", async () => {
    delete process.env.AGENTFORGE_RUNTIME;
    for (const path of ["/api/v1/settings", "/api/v1/usage", "/api/v1/threads"]) {
      const response = await json("GET", path);
      expect(response.status).not.toBe(403);
    }
  });
});

describe("the job-model breaker follows the key", () => {
  const DOWN = "gpt-5.6-sol";

  it("is cleared by a settings save and by a key reset, like the embeddings breaker", async () => {
    const circuit = await import("../job-model-fallback");
    delete process.env.AGENTFORGE_RUNTIME;
    stubFetch(200);

    circuit.markJobModelDown(DOWN);
    expect(circuit.isJobModelDown(DOWN)).toBe(true);
    expect((await json("POST", "/api/v1/settings", { openaiApiKey: KEY })).status).toBe(200);
    expect(circuit.isJobModelDown(DOWN)).toBe(false);

    circuit.markJobModelDown(DOWN);
    expect(circuit.isJobModelDown(DOWN)).toBe(true);
    expect((await json("POST", "/api/v1/settings/reset", { scope: "key" })).status).toBe(200);
    expect(circuit.isJobModelDown(DOWN)).toBe(false);
  });
});

describe("POST /api/v1/settings", () => {
  it("checks a newly saved key and returns the fresh gate", async () => {
    delete process.env.AGENTFORGE_RUNTIME;
    stubFetch(200);

    const response = await json("POST", "/api/v1/settings", { openaiApiKey: KEY });
    expect(response.status).toBe(200);
    const gateway = gatewayOf(response.body);
    expect(gateway.status).toBe("ok");
    expect(gateway.allowed).toBe(true);
    expect(gateway.grace).toBe(false);
    expect(gateway.checkedAt).not.toBeNull();

    expect(existsSync(GATE_FILE)).toBe(true);
    const saved = readFileSync(GATE_FILE, "utf8");
    expect(saved).not.toContain(KEY);
    expect(JSON.parse(saved).status).toBe("ok");
  });

  it("reports invalid_key when the gateway rejects the key", async () => {
    delete process.env.AGENTFORGE_RUNTIME;
    stubFetch(401);

    const response = await json("POST", "/api/v1/settings", { openaiApiKey: KEY });
    const gateway = gatewayOf(response.body);
    expect(gateway.status).toBe("invalid_key");
    expect(gateway.allowed).toBe(false);
  });

  it("saves the key even when the verdict file cannot be written", async () => {
    // A directory standing where `gateway-gate.json` goes is this test's stand-in for EACCES or
    // ENOSPC: `saveGateState` renames its temp file onto that path and fails. The key itself is
    // already on disk at that point, so the owner must not be told the save failed — they would go
    // and paste a key that is in fact saved. The verdict is reported as `error`, and the desk stays
    // open, because an unwritable state file is not a rejected key.
    delete process.env.AGENTFORGE_RUNTIME;
    stubFetch(200);
    mkdirSync(GATE_FILE, { recursive: true });
    try {
      const response = await json("POST", "/api/v1/settings", { openaiApiKey: KEY });
      expect(response.status).toBe(200);
      expect(response.body.hasOpenai).toBe(true);

      const gateway = gatewayOf(response.body);
      expect(gateway.status).toBe("error");
      expect(gateway.allowed).toBe(true);
      expect(gateway.endpointLocked).toBe(true);
      expect(typeof gateway.message).toBe("string");
      expect(gateway.message).not.toContain(KEY);
    } finally {
      rmSync(GATE_FILE, { force: true, recursive: true });
    }

    // Saved through the host, so it has to be cleared through the host.
    stubFetch(200);
    await json("POST", "/api/v1/settings", { openaiApiKey: "" });
  });

  it("clears the saved verdict when the key is cleared", async () => {
    delete process.env.AGENTFORGE_RUNTIME;
    stubFetch(200);
    await json("POST", "/api/v1/settings", { openaiApiKey: KEY });
    expect(existsSync(GATE_FILE)).toBe(true);

    const response = await json("POST", "/api/v1/settings", { openaiApiKey: "" });
    expect(existsSync(GATE_FILE)).toBe(false);
    expect(gatewayOf(response.body).status).toBe("needs_key");
  });
});

/**
 * A01-3. The operator's shared settings on a hosted box, and the one narrow thing that had to
 * change about the provider keys.
 *
 * The first version of this fix refused key writes outright in server mode, which bricked the
 * hosted deploy: onboarding and Settings are the only ways to supply the gateway key, both post it
 * here, and `gateway-gate.ts` only falls back to `OPENAI_API_KEY` when `AGENTFORGE_RUNTIME=ai`,
 * which `webapp-deploy/compose.yml` does not set. The first test below is the one that would have
 * caught that.
 *
 * The switch is injected rather than set in the environment, like the reset suite below: flipping
 * `AGENTFORGE_SERVER` in this process would turn on the router's session gate and answer 401 to
 * everything, and would change every other test in the file.
 */
describe("POST /api/v1/settings in server mode", () => {
  const HOSTED = { isServerMode: () => true };
  const DESK = { isServerMode: () => false };

  async function save(
    body: Record<string, unknown>,
    deps: { isServerMode: () => boolean },
  ): Promise<JsonResponse> {
    const { handlePostSettings } = await import("./settings");
    const result = await handlePostSettings(request("POST", "/api/v1/settings", { body }), deps);
    if (result.type !== "json") {
      throw new Error(`expected json, got ${result.type}`);
    }
    return { status: result.status, body: (result.body ?? {}) as Record<string, unknown> };
  }

  beforeEach(() => {
    delete process.env.AGENTFORGE_RUNTIME;
    stubFetch(200);
  });

  it("lets the operator save the gateway key, because nothing else can", async () => {
    const response = await save({ openaiApiKey: KEY }, HOSTED);
    expect(response.status).toBe(200);
    expect(response.body.hasOpenai).toBe(true);
  });

  it("ignores a blank key instead of deleting the one every tenant shares", async () => {
    await save({ openaiApiKey: KEY }, HOSTED);
    // Exactly what the Settings page posts when someone saves a spend cap without touching the key
    // field. Before this, `mergeSecrets` read the empty string as "forget my key".
    const response = await save({ openaiApiKey: "", editTurnCapUsd: 5 }, HOSTED);
    expect(response.status).toBe(200);
    expect(response.body.hasOpenai).toBe(true);
  });

  it("ignores a whitespace-only key too", async () => {
    await save({ openaiApiKey: KEY }, HOSTED);
    const response = await save({ openaiApiKey: "   " }, HOSTED);
    expect(response.body.hasOpenai).toBe(true);
  });

  it("still lets a desk owner clear their own key off server mode", async () => {
    await save({ openaiApiKey: KEY }, DESK);
    const response = await save({ openaiApiKey: "" }, DESK);
    expect(response.body.hasOpenai).toBe(false);
  });

  it("refuses tool credentials, tool backends and the injection-guard bypass", async () => {
    for (const body of [
      { toolKeys: { tavily: "tvly-whatever" } },
      { toolBackends: { search: "https://attacker.example" } },
      { injectionGuardBypass: true },
    ]) {
      const response = await save(body, HOSTED);
      expect(response.status, JSON.stringify(body)).toBe(403);
      expect(errorCode(response.body)).toBe("settings_operator_only");
    }
  });

  it("lets an empty tool map and a false bypass through, since neither changes anything", async () => {
    const response = await save({ toolKeys: {}, toolBackends: {}, injectionGuardBypass: false }, HOSTED);
    expect(response.status).toBe(200);
  });

  it("does not refuse any of it off server mode", async () => {
    const response = await save({ toolKeys: { tavily: "tvly-desk" } }, DESK);
    expect(response.status).toBe(200);
  });
});

describe("POST /api/v1/settings/gateway/check", () => {
  it("short-circuits in stub runtime without calling the gateway", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const response = await json("POST", "/api/v1/settings/gateway/check", {});
    expect(response.status).toBe(200);
    expect(gatewayOf(response.body).status).toBe("stub");
    expect(calls).toBe(0);
  });

  it("re-checks the saved key and answers with the gate only", async () => {
    delete process.env.AGENTFORGE_RUNTIME;
    stubFetch(200);
    await json("POST", "/api/v1/settings", { openaiApiKey: KEY });

    stubFetch(502);
    const response = await json("POST", "/api/v1/settings/gateway/check", {});
    expect(Object.keys(response.body)).toEqual(["gateway"]);
    const gateway = gatewayOf(response.body);
    // The key validated a moment ago, so a broken gateway keeps the app open on grace.
    expect(gateway.status).toBe("error");
    expect(gateway.allowed).toBe(true);
    expect(gateway.grace).toBe(true);
  });
});

describe("POST /api/v1/settings/reset", () => {
  it("rejects an unknown scope", async () => {
    const response = await json("POST", "/api/v1/settings/reset", { scope: "everything" });
    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe("invalid_request");
  });

  it("rejects a missing scope", async () => {
    const response = await json("POST", "/api/v1/settings/reset", {});
    expect(response.status).toBe(400);
  });

  it("scope key clears the gateway key in every workspace slice", async () => {
    delete process.env.AGENTFORGE_RUNTIME;
    stubFetch(200);
    await json("POST", "/api/v1/settings", { openaiApiKey: KEY });
    store.saveSettings({ openaiApiKey: `${KEY}-other` }, "other-desk");
    expect(store.loadSettings("other-desk").openaiApiKey).toBe(`${KEY}-other`);

    const response = await json("POST", "/api/v1/settings/reset", { scope: "key" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, scope: "key", relaunch: false, resetPending: false });
    expect(gatewayOf(response.body).status).toBe("needs_key");

    expect(store.loadSettings().openaiApiKey).toBeUndefined();
    expect(store.loadSettings("other-desk").openaiApiKey).toBeUndefined();
    expect(existsSync(GATE_FILE)).toBe(false);
    expect(existsSync(MARKER_FILE)).toBe(false);
  });

  it("scope all needs the typed confirmation", async () => {
    const response = await json("POST", "/api/v1/settings/reset", { scope: "all" });
    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe("invalid_request");
    expect(existsSync(MARKER_FILE)).toBe(false);

    const wrong = await json("POST", "/api/v1/settings/reset", { scope: "all", confirm: "reset" });
    expect(wrong.status).toBe(400);
    expect(existsSync(MARKER_FILE)).toBe(false);
  });

  it("scope all queues the wipe for the next boot and asks for a relaunch", async () => {
    const response = await json("POST", "/api/v1/settings/reset", { scope: "all", confirm: "RESET" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, scope: "all", relaunch: true, resetPending: true });
    expect(gatewayOf(response.body).endpointLocked).toBe(true);

    expect(existsSync(MARKER_FILE)).toBe(true);
    const marker = JSON.parse(readFileSync(MARKER_FILE, "utf8")) as { version: number; entries: string[] };
    expect(marker.version).toBe(1);
    expect(marker.entries).toEqual([
      "settings.enc",
      "settings.json",
      ".master-key",
      "gateway-gate.json",
      "media",
      "workspace-id.txt",
      "desk-usage.json",
      // Phase 3 lane D: every non-local tenant's files.
      "tenants",
      "datasets",
      "edit",
      "legal",
      // Channel lists and stored conversations; the bot token itself is inside settings.enc.
      "channels",
      "models-cache.json",
      "models-dev-cache.json",
      // Downloaded native components and the installer's log: host-written and re-downloadable,
      // so a full "Start over" takes them too.
      "components",
      "logs",
    ]);
    // Chromium's profile and the desktop status file are not the host's to delete.
    expect(marker.entries).not.toContain("host-status.json");
    expect(marker.entries.some((entry) => entry.toLowerCase().includes("storage"))).toBe(false);
  });
});

describe("POST /api/v1/settings/reset in server mode", () => {
  // The switch is injected, never read from the environment here: a stray AGENTFORGE_SERVER in this
  // process would change every other test in the file.
  const HOSTED = { isServerMode: () => true };

  async function reset(body: Record<string, unknown>, deps?: { isServerMode: () => boolean }): Promise<JsonResponse> {
    const { handleResetApp } = await import("./settings");
    const result = await handleResetApp(request("POST", "/api/v1/settings/reset", { body }), deps);
    if (result.type !== "json") {
      throw new Error(`expected json, got ${result.type}`);
    }
    return { status: result.status, body: (result.body ?? {}) as Record<string, unknown> };
  }

  async function cancel(deps: { isServerMode: () => boolean }): Promise<JsonResponse> {
    const { handleCancelReset } = await import("./settings");
    const result = await handleCancelReset(request("POST", "/api/v1/settings/reset/cancel"), deps);
    if (result.type !== "json") {
      throw new Error(`expected json, got ${result.type}`);
    }
    return { status: result.status, body: (result.body ?? {}) as Record<string, unknown> };
  }

  /**
   * A01-4. Arming a wipe was already refused in server mode before this branch; the CANCEL path is
   * what was open. The marker is machine-wide, so a marker that arrives another way — a restored
   * data dir, a desk volume mounted on the server — must not be callable off by one tenant.
   */
  it("refuses the cancel path too, so one tenant cannot call off the operator's wipe", async () => {
    const response = await cancel(HOSTED);
    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe("reset_disabled");
  });

  it("still cancels off server mode, where the owner armed it themselves", async () => {
    const response = await cancel({ isServerMode: () => false });
    expect(response.status).toBe(200);
    expect(response.body.resetPending).toBe(false);
  });

  it("refuses scope all with reset_disabled and queues nothing", async () => {
    const response = await reset({ scope: "all", confirm: "RESET" }, HOSTED);
    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe("reset_disabled");
    // Nothing was queued: the refusal happens before the wipe is written, not after.
    expect(existsSync(MARKER_FILE)).toBe(false);
    expect((await json("GET", "/api/v1/settings")).body.resetPending).toBe(false);
  });

  it("refuses scope all even with the confirmation word missing or wrong", async () => {
    for (const body of [{ scope: "all" }, { scope: "all", confirm: "reset" }]) {
      const response = await reset(body, HOSTED);
      expect(response.status).toBe(403);
      expect(errorCode(response.body)).toBe("reset_disabled");
    }
    expect(existsSync(MARKER_FILE)).toBe(false);
  });

  /**
   * Phase 4 turned this one around, and the reason it used to be refused is worth keeping in view:
   * `clearGatewayKeyEverywhere` and `clearGateState` were not scoped to a tenant, so one workspace
   * asking to forget the key logged every tenant on the box out of the gateway. Lane D scoped both
   * and Phase 4 moved both payloads into the caller's own `tenant_state` rows, so this now clears
   * the caller's key and nobody else's. "Start over" (`scope: "all"`) stays refused above — that one
   * really does still wipe a shared data directory.
   */
  it("allows scope key, because the key it forgets is the caller's own", async () => {
    stubFetch(200);
    await json("POST", "/api/v1/settings", { openaiApiKey: KEY });
    expect((await json("GET", "/api/v1/settings")).body.hasOpenai).toBe(true);

    const response = await reset({ scope: "key" }, HOSTED);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, scope: "key", relaunch: false });
    expect((await json("GET", "/api/v1/settings")).body.hasOpenai).toBe(false);
  });

  it("is the only way a hosted tenant can clear its key, because a blank save is dropped", async () => {
    stubFetch(200);
    const { handlePostSettings } = await import("./settings");
    const hostedSave = (body: Record<string, unknown>) =>
      handlePostSettings(request("POST", "/api/v1/settings", { body }), HOSTED);

    await hostedSave({ openaiApiKey: KEY });
    // The SPA posts `openaiApiKey` from state on every save; in server mode a blank is dropped
    // rather than forwarded (`keyFieldValue`), so this must NOT be a way to wipe the key.
    await hostedSave({ openaiApiKey: "", editTurnCapUsd: 5 });
    expect((await json("GET", "/api/v1/settings")).body.hasOpenai).toBe(true);

    await reset({ scope: "key" }, HOSTED);
    expect((await json("GET", "/api/v1/settings")).body.hasOpenai).toBe(false);
  });

  it("keeps scope key working when server mode is off", async () => {
    stubFetch(200);
    await json("POST", "/api/v1/settings", { openaiApiKey: KEY });
    const response = await reset({ scope: "key" }, { isServerMode: () => false });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, scope: "key", relaunch: false });
    expect((await json("GET", "/api/v1/settings")).body.hasOpenai).toBe(false);
  });

  it("keeps scope all working when server mode is off", async () => {
    const response = await reset({ scope: "all", confirm: "RESET" }, { isServerMode: () => false });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, scope: "all", relaunch: true, resetPending: true });
    expect(existsSync(MARKER_FILE)).toBe(true);
  });

  it("defaults to the real switch, which is off for the desktop and webdev", async () => {
    const response = await reset({ scope: "all", confirm: "RESET" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, scope: "all" });
  });
});
