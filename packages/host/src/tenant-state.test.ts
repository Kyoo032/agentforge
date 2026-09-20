/**
 * Phase 3 lane D — the state half: the three per-install files that are now per tenant.
 *
 * The lane's "done when" in `docs/internal/web-phase3-tenancy-spec.md` §7 is exactly what this
 * asserts: two tenants hold different gateway keys and get different verdicts, and
 * `clearGatewayKeyEverywhere` clears one tenant. Desktop mode keeps its file paths.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, LOCAL_TENANT_ID } from "@agentforge/core";

const dataDir = mkdtempSync(path.join(tmpdir(), "agentforge-tenant-state-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
delete process.env.AGENTFORGE_SERVER;
delete process.env.AGENTFORGE_RUNTIME;
delete process.env.OPENAI_API_KEY;

const settingsStore = await import("./settings-store");
const gate = await import("./gateway-gate");
const deskUsage = await import("./desk-usage");
const { TENANTS_DIR } = await import("./tenant-paths");

const A = { tenantId: "tenant-alpha", workspaceId: "desk-a" };
const B = { tenantId: "tenant-beta", workspaceId: "desk-b" };
const KEY_A = "sk-lane-d-aaaaaaaaaaaaaaaa";
const KEY_B = "sk-lane-d-bbbbbbbbbbbbbbbb";

function tenantFile(tenantId: string, name: string): string {
  return tenantId === LOCAL_TENANT_ID ? path.join(dataDir, name) : path.join(dataDir, TENANTS_DIR, tenantId, name);
}

afterEach(() => {
  delete process.env.AGENTFORGE_SERVER;
  settingsStore.resetSettingsCacheForTests();
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("settings.enc is per tenant", () => {
  it("keeps two tenants' gateway keys in two files", () => {
    settingsStore.saveSettings({ openaiApiKey: KEY_A }, A);
    settingsStore.saveSettings({ openaiApiKey: KEY_B }, B);

    expect(settingsStore.loadSettings(A).openaiApiKey).toBe(KEY_A);
    expect(settingsStore.loadSettings(B).openaiApiKey).toBe(KEY_B);
    expect(existsSync(tenantFile(A.tenantId, "settings.enc"))).toBe(true);
    expect(existsSync(tenantFile(B.tenantId, "settings.enc"))).toBe(true);
  });

  it("puts the local tenant's file exactly where a desktop install already has it", () => {
    settingsStore.saveSettings(
      { openaiApiKey: "sk-lane-d-local-000000" },
      { tenantId: LOCAL_TENANT_ID, workspaceId: "home" },
    );
    expect(existsSync(path.join(dataDir, "settings.enc"))).toBe(true);
    expect(existsSync(path.join(dataDir, TENANTS_DIR, LOCAL_TENANT_ID))).toBe(false);
  });

  it("clears the gateway key for one tenant only", () => {
    settingsStore.saveSettings({ openaiApiKey: KEY_A }, A);
    settingsStore.saveSettings({ openaiApiKey: KEY_A }, { tenantId: A.tenantId, workspaceId: "desk-a2" });
    settingsStore.saveSettings({ openaiApiKey: KEY_B }, B);

    const touched = settingsStore.clearGatewayKeyEverywhere(A);

    // Every desk of tenant A, and no desk of tenant B.
    expect(touched.sort()).toEqual(["desk-a", "desk-a2"]);
    expect(settingsStore.loadSettings(A).openaiApiKey).toBeFalsy();
    expect(settingsStore.loadSettings({ tenantId: A.tenantId, workspaceId: "desk-a2" }).openaiApiKey).toBeFalsy();
    expect(settingsStore.loadSettings(B).openaiApiKey).toBe(KEY_B);
  });

  it("refuses a bare desk id in server mode rather than reading someone else's file", () => {
    process.env.AGENTFORGE_SERVER = "1";
    expect(() => settingsStore.loadSettings("desk-a")).toThrow(ApiError);
    expect(() => settingsStore.loadSettings()).toThrow(ApiError);
    // The tenant form resolves, which is what the handler sweep passes. Not `loadSettings` here:
    // server mode also demands AGENTFORGE_SECRETS_KEY for the vault key, and a decrypt failure
    // moves `settings.enc` aside (`quarantineUnreadableSettings`), which is a different rule.
    expect(settingsStore.resolveSettingsScope(A)).toEqual({ tenantId: A.tenantId, workspaceId: A.workspaceId });
  });

  it("still accepts a bare desk id on the desktop, where there is one tenant", () => {
    expect(() => settingsStore.loadSettings("desk-a")).not.toThrow();
    expect(settingsStore.resolveSettingsScope("desk-a").tenantId).toBe(LOCAL_TENANT_ID);
  });
});

describe("the gateway verdict is per tenant", () => {
  beforeEach(() => {
    gate.resetGatewayRefreshThrottle();
    for (const tenantId of [A.tenantId, B.tenantId, LOCAL_TENANT_ID]) {
      gate.clearGateState({ tenantId, workspaceId: "x" });
    }
  });

  it("gives two tenants different verdicts for their own keys", async () => {
    const settingsA = { openaiApiKey: KEY_A, openaiBaseUrl: "https://gateway.example/v1" };
    const settingsB = { openaiApiKey: KEY_B, openaiBaseUrl: "https://gateway.example/v1" };

    const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const rejectFetch = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;

    const verdictA = await gate.runGatewayCheck(settingsA, { tenant: A, envRuntime: undefined, fetchImpl: okFetch });
    const verdictB = await gate.runGatewayCheck(settingsB, {
      tenant: B,
      envRuntime: undefined,
      fetchImpl: rejectFetch,
    });

    expect(verdictA).toMatchObject({ status: "ok", allowed: true });
    expect(verdictB).toMatchObject({ status: "invalid_key", allowed: false });

    // Each verdict is in its own file, and neither overwrote the other.
    expect(existsSync(tenantFile(A.tenantId, gate.GATEWAY_GATE_FILE))).toBe(true);
    expect(existsSync(tenantFile(B.tenantId, gate.GATEWAY_GATE_FILE))).toBe(true);
    expect(gate.loadGateState(A.tenantId)?.status).toBe("ok");
    expect(gate.loadGateState(B.tenantId)?.status).toBe("invalid_key");
    expect(gate.reportGatewayGate(settingsA, { tenant: A })).toMatchObject({ status: "ok", allowed: true });
    expect(gate.reportGatewayGate(settingsB, { tenant: B })).toMatchObject({ status: "invalid_key", allowed: false });
  });

  it("clears one tenant's verdict without touching the other's", async () => {
    const settingsA = { openaiApiKey: KEY_A, openaiBaseUrl: "https://gateway.example/v1" };
    const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await gate.runGatewayCheck(settingsA, { tenant: A, envRuntime: undefined, fetchImpl: okFetch });
    await gate.runGatewayCheck(
      { ...settingsA, openaiApiKey: KEY_B },
      { tenant: B, envRuntime: undefined, fetchImpl: okFetch },
    );

    gate.clearGateState(A);

    expect(gate.loadGateState(A.tenantId)).toBeNull();
    expect(gate.loadGateState(B.tenantId)?.status).toBe("ok");
  });

  it("puts the local tenant's verdict where a desktop install already has it", async () => {
    const local = { tenantId: LOCAL_TENANT_ID, workspaceId: "home" };
    const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await gate.runGatewayCheck(
      { openaiApiKey: KEY_A, openaiBaseUrl: "https://gateway.example/v1" },
      { tenant: local, envRuntime: undefined, fetchImpl: okFetch },
    );
    expect(existsSync(path.join(dataDir, gate.GATEWAY_GATE_FILE))).toBe(true);
  });

  it("refreshes per tenant even when two tenants share a key", () => {
    const settings = { openaiApiKey: KEY_A, openaiBaseUrl: "https://gateway.example/v1" };
    let calls = 0;
    const runCheck = async () => {
      calls += 1;
      return {} as never;
    };
    expect(gate.maybeRefreshGateway(settings, { tenant: A, envRuntime: undefined, runCheck, nowMs: () => 0 })).toBe(
      true,
    );
    // Same key, same instant, different tenant: still a check, because the verdict files differ.
    expect(gate.maybeRefreshGateway(settings, { tenant: B, envRuntime: undefined, runCheck, nowMs: () => 0 })).toBe(
      true,
    );
    // Same tenant again inside the throttle window: no second check.
    expect(gate.maybeRefreshGateway(settings, { tenant: A, envRuntime: undefined, runCheck, nowMs: () => 0 })).toBe(
      false,
    );
    expect(calls).toBe(2);
  });
});

describe("desk usage is per tenant", () => {
  it("does not show one tenant's spend to another", () => {
    deskUsage.appendDeskUsage(A.tenantId, { model: "model-a", inputTokens: 10, outputTokens: 4 });
    deskUsage.appendDeskUsage(B.tenantId, { model: "model-b", inputTokens: 7, outputTokens: 1 });

    expect(deskUsage.listDeskUsage(A.tenantId)).toEqual([{ model: "model-a", inputTokens: 10, outputTokens: 4 }]);
    expect(deskUsage.listDeskUsage(B.tenantId)).toEqual([{ model: "model-b", inputTokens: 7, outputTokens: 1 }]);
    expect(existsSync(tenantFile(A.tenantId, "desk-usage.json"))).toBe(true);
    expect(existsSync(tenantFile(B.tenantId, "desk-usage.json"))).toBe(true);
  });

  it("keeps the local tenant's file where a desktop install already has it", () => {
    deskUsage.appendDeskUsage(LOCAL_TENANT_ID, { model: "model-local", inputTokens: 2, outputTokens: 2 });
    expect(existsSync(path.join(dataDir, "desk-usage.json"))).toBe(true);
    expect(deskUsage.deskUsageFileExists(LOCAL_TENANT_ID)).toBe(true);
  });
});

/**
 * The guard that would have caught verifier findings F1 and F2 on PR #80.
 *
 * Twice over, a mode landed on `main` while this lane was open (Meeting, then Telegram) calling the
 * settings store with `tenant.workspaceId`. On the desktop that silently reads the local tenant, so
 * every test stayed green; on a hosted server `resolveSettingsScope` throws `tenant_required` and
 * the route 500s. A sweep is the only thing that holds against the *next* mode, so this asserts the
 * shape of the call rather than the behaviour of any one route.
 *
 * Same idea as lane A's `edit-scope.test.ts` guard: a rule the compiler cannot express, tested.
 */
describe("no host source passes a bare desk id to the settings store", () => {
  /** Owns the contract itself, so it is the one place allowed to speak in bare ids. */
  const OWNERS = new Set(["settings-store.ts", "gateway-gate.ts", "tenant-state-store.ts"]);

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...sourceFiles(full));
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !OWNERS.has(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  const SRC = path.join(__dirname);

  /** Comments talk about `requireGatewayAllowed()` a lot; only real calls count. */
  function withoutComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("never hands a settings-store entry point a workspace id", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = withoutComments(readFileSync(file, "utf8"));
      // Phase 4 added `loadUserLocale` / `saveUserLocale`, which take a tenant AND a user. Both are
      // swept here for the same reason as the other two: a bare desk id compiles and then 500s on a
      // hosted request, and on a desk it silently reads the local tenant so nothing goes red.
      for (const match of text.matchAll(
        /\b(loadSettings|saveSettings|loadUserLocale|saveUserLocale)\(([^()]*)\)/g,
      )) {
        if (/workspaceId/.test(match[2] ?? "")) {
          offenders.push(`${path.relative(SRC, file)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Phase 4 — the desktop's file layout has exactly one owner.
   *
   * Lane D froze `settings.enc` and `gateway-gate.json` at the paths a desktop install already has,
   * and Phase 4 made them one backend of two. A second module spelling either name is how a desk
   * ends up half on the files and half on the rows, so the names live in `TENANT_STATE_FILENAMES`
   * and nowhere else. `handlers/settings.ts` is the one exception — "Start over" has to name the
   * entries it deletes — and the case below pins its list to the backend's so the two cannot drift.
   */
  it("lets only the state store name the desktop's files", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (path.relative(SRC, file) === path.join("handlers", "settings.ts")) {
        continue;
      }
      const text = withoutComments(readFileSync(file, "utf8"));
      for (const match of text.matchAll(/"(settings\.enc|gateway-gate\.json)"/g)) {
        offenders.push(`${path.relative(SRC, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the Start over list and the backend's filenames in step", async () => {
    const { HOST_RESET_ENTRIES } = await import("./handlers/settings");
    const { TENANT_STATE_FILENAMES } = await import("./tenant-state-store");
    for (const filename of Object.values(TENANT_STATE_FILENAMES)) {
      expect(HOST_RESET_ENTRIES).toContain(filename);
    }
  });

  it("never calls the gateway gate without a tenant", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = withoutComments(readFileSync(file, "utf8"));
      for (const match of text.matchAll(/\brequireGatewayAllowed\(([^();]*)\)/g)) {
        if (!/\btenant\b/.test(match[1] ?? "")) {
          offenders.push(`${path.relative(SRC, file)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
