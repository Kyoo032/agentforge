/**
 * Phase 3 lane D — the state half: the three per-install files that are now per tenant.
 *
 * The lane's "done when" in `docs/internal/web-phase3-tenancy-spec.md` §7 is exactly what this
 * asserts: two tenants hold different gateway keys and get different verdicts, and
 * `clearGatewayKeyEverywhere` clears one tenant. Desktop mode keeps its file paths.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
