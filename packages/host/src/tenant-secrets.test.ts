/**
 * Phase 4 — per-tenant secrets, the hosted row backend, and the operator's own key.
 *
 * The phase's "done when" in `docs/internal/web-migration-plan.md` is "two tenants each paste their
 * own key and each gets their own gate verdict on the hosted server". Lane D proved that for two
 * FILES (`tenant-state.test.ts`, which still runs and must stay green). This proves it for the
 * backend that actually serves a hosted tenant: rows in `tenant_state`, with nothing on disk.
 *
 * The connection is a throwaway in-memory database registered directly, rather than
 * `@agentforge/db`'s, so this suite proves the backend without opening the process's real database
 * — the same reason `tenant-state-db.ts` exists at all.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, encryptJson, LOCAL_TENANT_ID, resolveProviderKeys, wrappingKeyFromSecret } from "@agentforge/core";
import { ensureSchema } from "@agentforge/db/ensure-schema";

const dataDir = mkdtempSync(path.join(tmpdir(), "agentforge-phase4-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
/** Server mode demands a real wrap key (`vault-key.ts`, row S1). Generated, not typed. */
const WRAP_KEY = "7b1d0c9e42a5f38614bd7c02e9f5a831d64c7fe20b93a15c8e7d4620fa31c95b";
process.env.AGENTFORGE_SECRETS_KEY = WRAP_KEY;
delete process.env.AGENTFORGE_SERVER;
delete process.env.AGENTFORGE_RUNTIME;
delete process.env.OPENAI_API_KEY;

const settingsStore = await import("./settings-store");
const gate = await import("./gateway-gate");
const stateStore = await import("./tenant-state-store");
const { TENANTS_DIR } = await import("./tenant-paths");

const A = { tenantId: "tenant-alpha", workspaceId: "desk-a", userId: "user-a1" };
const B = { tenantId: "tenant-beta", workspaceId: "desk-b", userId: "user-b1" };
const KEY_A = "sk-phase4-aaaaaaaaaaaaaaaaaaa";
const KEY_B = "sk-phase4-bbbbbbbbbbbbbbbbbbb";

let sqlite: Database.Database;

function seedTenant(tenantId: string): void {
  sqlite
    .prepare("INSERT OR IGNORE INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(tenantId, tenantId, tenantId, "active", Date.now());
}

/** Hosted mode with a live row backend: what a request on the server actually runs against. */
function hosted(): void {
  process.env.AGENTFORGE_SERVER = "1";
}

function stateRows(): Array<{ tenant_id: string; key: string }> {
  return sqlite.prepare("SELECT tenant_id, key FROM tenant_state ORDER BY tenant_id, key").all() as Array<{
    tenant_id: string;
    key: string;
  }>;
}

function filesUnder(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name);
  } catch {
    return [];
  }
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  ensureSchema(sqlite);
  for (const tenantId of [A.tenantId, B.tenantId, LOCAL_TENANT_ID]) {
    seedTenant(tenantId);
  }
  stateStore.registerTenantStateSql(sqlite as unknown as Parameters<typeof stateStore.registerTenantStateSql>[0]);
  stateStore.resetTenantStateAdoptionForTests();
  settingsStore.resetSettingsCacheForTests();
  gate.resetGatewayRefreshThrottle();
});

afterEach(() => {
  delete process.env.AGENTFORGE_SERVER;
  stateStore.resetTenantStateSqlForTests();
  settingsStore.resetSettingsCacheForTests();
  sqlite.close();
  // Between cases the data directory must go back to "a server that has written no files".
  for (const name of filesUnder(dataDir)) {
    rmSync(path.join(dataDir, name), { recursive: true, force: true });
  }
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the hosted backend keeps a tenant's secrets in rows, not files", () => {
  it("gives two tenants their own key with nothing written to disk", () => {
    hosted();
    settingsStore.saveSettings({ openaiApiKey: KEY_A }, A);
    settingsStore.saveSettings({ openaiApiKey: KEY_B }, B);

    expect(settingsStore.loadSettings(A).openaiApiKey).toBe(KEY_A);
    expect(settingsStore.loadSettings(B).openaiApiKey).toBe(KEY_B);
    expect(stateRows()).toEqual([
      { tenant_id: A.tenantId, key: "settings" },
      { tenant_id: B.tenantId, key: "settings" },
    ]);
    // Lane D's files are what this replaces: nothing may appear where they used to be.
    expect(filesUnder(dataDir)).toEqual([]);
    expect(existsSync(path.join(dataDir, TENANTS_DIR, A.tenantId, "settings.enc"))).toBe(false);
  });

  it("seals the row, so a key is never readable from the database", () => {
    hosted();
    settingsStore.saveSettings({ openaiApiKey: KEY_A }, A);

    const row = sqlite.prepare("SELECT value FROM tenant_state WHERE tenant_id = ?").get(A.tenantId) as {
      value: string;
    };
    expect(row.value).not.toContain(KEY_A);
    expect(row.value).not.toContain("openaiApiKey");
    // The envelope is the one from `packages/core/src/crypto/envelope.ts`, unchanged by this phase.
    expect(JSON.parse(row.value)).toMatchObject({ v: 1, alg: "aes-256-gcm" });
  });

  it("gives two tenants their own gate verdict", async () => {
    hosted();
    const settingsA = { openaiApiKey: KEY_A, openaiBaseUrl: "https://gateway.example/v1" };
    const settingsB = { openaiApiKey: KEY_B, openaiBaseUrl: "https://gateway.example/v1" };
    const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const rejectFetch = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;

    expect(await gate.runGatewayCheck(settingsA, { tenant: A, envRuntime: undefined, fetchImpl: okFetch })).toMatchObject(
      { status: "ok", allowed: true },
    );
    expect(
      await gate.runGatewayCheck(settingsB, { tenant: B, envRuntime: undefined, fetchImpl: rejectFetch }),
    ).toMatchObject({ status: "invalid_key", allowed: false });

    expect(gate.loadGateState(A.tenantId)?.status).toBe("ok");
    expect(gate.loadGateState(B.tenantId)?.status).toBe("invalid_key");
    expect(stateRows().filter((row) => row.key === "gateway_gate").map((row) => row.tenant_id)).toEqual([
      A.tenantId,
      B.tenantId,
    ]);
    expect(filesUnder(dataDir)).toEqual([]);
  });

  it("clears one tenant's key and verdict without touching the other's", async () => {
    hosted();
    const okFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    settingsStore.saveSettings({ openaiApiKey: KEY_A }, A);
    settingsStore.saveSettings({ openaiApiKey: KEY_B }, B);
    await gate.runGatewayCheck({ openaiApiKey: KEY_A }, { tenant: A, envRuntime: undefined, fetchImpl: okFetch });
    await gate.runGatewayCheck({ openaiApiKey: KEY_B }, { tenant: B, envRuntime: undefined, fetchImpl: okFetch });

    expect(settingsStore.clearGatewayKeyEverywhere(A)).toEqual([A.workspaceId]);
    gate.clearGateState(A);

    expect(settingsStore.loadSettings(A).openaiApiKey).toBeFalsy();
    expect(gate.loadGateState(A.tenantId)).toBeNull();
    expect(settingsStore.loadSettings(B).openaiApiKey).toBe(KEY_B);
    expect(gate.loadGateState(B.tenantId)?.status).toBe("ok");
  });

  it("picks up a row another process rewrote, rather than serving its cache", () => {
    hosted();
    settingsStore.saveSettings({ openaiApiKey: KEY_A }, A);
    expect(settingsStore.loadSettings(A).openaiApiKey).toBe(KEY_A);

    // A second app process behind the proxy, writing the same row. The cache stamp is the row's
    // `updated_at`, so this must be seen without anyone clearing a cache.
    const envelope = encryptJson(
      { version: 2, workspaces: { [A.workspaceId]: { openaiApiKey: KEY_B } } },
      wrappingKeyFromSecret(WRAP_KEY),
    );
    sqlite
      .prepare("UPDATE tenant_state SET value = ?, updated_at = ? WHERE tenant_id = ? AND key = 'settings'")
      .run(`${JSON.stringify(envelope)}\n`, Date.now() + 1000, A.tenantId);

    expect(settingsStore.loadSettings(A).openaiApiKey).toBe(KEY_B);
  });

  it("refuses to read or write at all when nothing installed the backend", () => {
    hosted();
    stateStore.resetTenantStateSqlForTests();
    // Fail closed rather than silently reading the desktop's files, which nobody backs up.
    expect(() => settingsStore.loadSettings(A)).toThrow(ApiError);
    expect(() => settingsStore.saveSettings({ openaiApiKey: KEY_A }, A)).toThrow(/tenant_state_backend_missing|never installed/);
  });
});

describe("a Phase 3 file is adopted onto its row", () => {
  it("imports the tenant's settings.enc once and moves it aside", () => {
    // What a server that upgraded into this phase actually has: lane D's per-tenant file.
    const tenantDir = path.join(dataDir, TENANTS_DIR, A.tenantId);
    mkdirSync(tenantDir, { recursive: true });
    const envelope = encryptJson(
      { version: 2, workspaces: { [A.workspaceId]: { openaiApiKey: KEY_A } } },
      wrappingKeyFromSecret(WRAP_KEY),
    );
    const file = path.join(tenantDir, "settings.enc");
    writeFileSync(file, `${JSON.stringify(envelope)}\n`, "utf8");

    hosted();
    expect(settingsStore.loadSettings(A).openaiApiKey).toBe(KEY_A);

    expect(stateRows()).toEqual([{ tenant_id: A.tenantId, key: "settings" }]);
    expect(existsSync(file)).toBe(false);
    // Moved, never deleted: this is somebody's only copy of their key until the row is trusted.
    expect(existsSync(`${file}${stateStore.ADOPTED_SUFFIX}`)).toBe(true);
    expect(readFileSync(`${file}${stateStore.ADOPTED_SUFFIX}`, "utf8")).not.toContain(KEY_A);
  });

  it("does not adopt another tenant's file, and does not invent one", () => {
    hosted();
    expect(settingsStore.loadSettings(B).openaiApiKey).toBeUndefined();
    expect(stateRows()).toEqual([]);
  });
});

describe("the desktop is untouched by any of it", () => {
  it("keeps writing the exact files lane D placed, and no rows", () => {
    settingsStore.saveSettings({ openaiApiKey: "sk-desktop-key-000000" }, { tenantId: LOCAL_TENANT_ID, workspaceId: "home" });

    expect(existsSync(path.join(dataDir, "settings.enc"))).toBe(true);
    expect(existsSync(path.join(dataDir, TENANTS_DIR, LOCAL_TENANT_ID))).toBe(false);
    expect(stateRows()).toEqual([]);
  });

  it("still accepts a bare desk id, and still refuses one in server mode", () => {
    expect(() => settingsStore.loadSettings("desk-a")).not.toThrow();
    hosted();
    expect(() => settingsStore.loadSettings("desk-a")).toThrow(ApiError);
  });
});

describe("the operator's key is not a tenant's key", () => {
  it("is refused as a fallback in server mode and honoured off it", () => {
    const env = { OPENAI_API_KEY: "sk-operator-key-do-not-share" } as NodeJS.ProcessEnv;
    // A desk, or webdev: the documented headless fallback, unchanged.
    expect(resolveProviderKeys({}, env).openai).toBe("sk-operator-key-do-not-share");
    // A hosted server: the operator's credential is not handed to a tenant who saved none.
    expect(resolveProviderKeys({}, { ...env, AGENTFORGE_SERVER: "1" }).openai).toBeUndefined();
    // A tenant's own key still wins in both.
    expect(resolveProviderKeys({ openaiApiKey: KEY_A }, { ...env, AGENTFORGE_SERVER: "1" }).openai).toBe(KEY_A);
  });

  it("refuses the operator's endpoints in server mode too", () => {
    const env = { ANTHROPIC_BASE_URL: "https://operator.example/v1", AGENTFORGE_SERVER: "1" } as NodeJS.ProcessEnv;
    expect(resolveProviderKeys({}, env).anthropicBaseUrl).toBeUndefined();
    expect(resolveProviderKeys({}, { ANTHROPIC_BASE_URL: "https://operator.example/v1" } as NodeJS.ProcessEnv)
      .anthropicBaseUrl).toBe("https://operator.example/v1");
  });

  /**
   * The live hole, and the reason the sweep in `packages/core/src/provider-env-sweep.test.ts`
   * exists: `resolveProviderKeys` was not the only door.
   *
   * Edit's auto-captions run on the timeline worker, after the request that enqueued them has gone.
   * Nothing re-checks the gate there — it cannot, there is no request to answer 403 to — so the
   * `process.env.OPENAI_API_KEY` fallback this used to carry meant a hosted tenant could enqueue a
   * job while keyed, sign out, and have the transcription billed to the OPERATOR. The route is
   * asserted by its side effect: whether the gateway is called at all.
   */
  it("does not transcribe an Edit job on the operator's key after the tenant's is gone", async () => {
    const asr = await import("./edit/asr");
    process.env.AGENTFORGE_EDIT_ASR_MODEL = "mimo-v2.5-asr";
    process.env.OPENAI_API_KEY = "sk-operator-key-do-not-share";
    const chunk = path.join(dataDir, "chunk.mp3");
    writeFileSync(chunk, "not really audio");
    const calls: Array<string | undefined> = [];
    const spy: typeof fetch = async (_url, init) => {
      calls.push(new Headers(init?.headers).get("authorization") ?? undefined);
      return new Response(JSON.stringify({ text: "transcribed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      hosted();
      // The tenant has saved no key of its own — it signed out, or never pasted one.
      expect(await asr.transcribeAudioChunks([chunk], undefined, spy, A)).toEqual({ text: "" });
      expect(calls).toEqual([]);

      // Its own key still pays for its own job.
      settingsStore.saveSettings({ openaiApiKey: KEY_A }, A);
      expect(await asr.transcribeAudioChunks([chunk], undefined, spy, A)).toEqual({ text: "transcribed" });
      expect(calls).toEqual([`Bearer ${KEY_A}`]);

      // And a desk still honours the documented env fallback, unchanged by any of this.
      delete process.env.AGENTFORGE_SERVER;
      settingsStore.resetSettingsCacheForTests();
      const local = { tenantId: LOCAL_TENANT_ID, workspaceId: "home", userId: "owner" };
      expect(await asr.transcribeAudioChunks([chunk], undefined, spy, local)).toEqual({ text: "transcribed" });
      expect(calls.at(-1)).toBe("Bearer sk-operator-key-do-not-share");
    } finally {
      delete process.env.AGENTFORGE_EDIT_ASR_MODEL;
      delete process.env.OPENAI_API_KEY;
    }
  });

  /**
   * The fifth door, and the one both earlier sweeps were blind to.
   *
   * `getSecret(name)` fell back to `process.env[name]` — a dynamic index, invisible to a sweep that
   * matches spellings — so a hosted tenant's run picked up the operator's `TAVILY_API_KEY`,
   * `BRAVE_SEARCH_API_KEY` or `FAL_KEY` through the tool scope. Unlike the gateway half, which
   * route checks and the stub runtime kept out of reach, this one was live for any hosted tenant
   * with web search bound. Driven here through the scope a run actually executes in, not by calling
   * the helper directly.
   */
  it("does not lend a hosted tenant the operator's tool keys through the run scope", async () => {
    const { buildToolSecretScope, listToolRoutes, runWithToolSecrets, getSecret } = await import("@agentforge/core");
    process.env.TAVILY_API_KEY = "tvly-operator-key-do-not-share";
    process.env.OPENAI_API_KEY = "sk-operator-key-do-not-share";
    try {
      hosted();
      settingsStore.saveSettings({ openaiApiKey: KEY_A }, A);
      const settings = settingsStore.loadSettings(A);

      // The scope a run is executed with carries the tenant's own key and nothing of the operator's.
      const scope = buildToolSecretScope(settings);
      expect(scope.secrets.OPENAI_API_KEY).toBe(KEY_A);
      expect(scope.secrets.TAVILY_API_KEY).toBeUndefined();

      // And the fallback under it is empty, so a tool asking by name gets nothing either.
      runWithToolSecrets(scope, () => {
        expect(getSecret("TAVILY_API_KEY")).toBeUndefined();
        expect(getSecret("BRAVE_SEARCH_API_KEY")).toBeUndefined();
        expect(getSecret("FAL_KEY")).toBeUndefined();
        expect(getSecret("OPENAI_API_KEY")).toBe(KEY_A);
      });

      // Which is why the route is honestly not ready rather than ready on somebody else's key.
      expect(listToolRoutes(settings)).toMatchObject({ web: { ready: false } });

      // A desk is unchanged: autodetecting a tool key from the environment is the documented
      // BYOK path there, and this must not have taken it away.
      delete process.env.AGENTFORGE_SERVER;
      const deskScope = buildToolSecretScope(settings);
      expect(deskScope.secrets.TAVILY_API_KEY).toBe("tvly-operator-key-do-not-share");
      runWithToolSecrets(deskScope, () => {
        expect(getSecret("TAVILY_API_KEY")).toBe("tvly-operator-key-do-not-share");
      });
      expect(listToolRoutes(settings)).toMatchObject({ web: { ready: true, backend: "tavily", envVar: "TAVILY_API_KEY" } });
    } finally {
      delete process.env.TAVILY_API_KEY;
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("leaves the hosted gate reporting needs_key rather than opening on the operator's key", () => {
    const hostedEnv = { AGENTFORGE_SERVER: "1" } as NodeJS.ProcessEnv;
    process.env.OPENAI_API_KEY = "sk-operator-key-do-not-share";
    try {
      hosted();
      // `AGENTFORGE_RUNTIME=ai` is the only setting that ever let the env key through, and it does
      // not on a server: a tenant with no key of its own is sent to onboarding.
      const payload = gate.reportGatewayGate({}, { tenant: A, envRuntime: "ai", env: hostedEnv });
      expect(payload).toMatchObject({ status: "needs_key", allowed: false });
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });
});

describe("the UI locale belongs to the person, not the install", () => {
  it("gives two users on one tenant and one desk their own language", () => {
    hosted();
    const second = { ...A, userId: "user-a2" };
    settingsStore.saveUserLocale(A, "id");
    settingsStore.saveUserLocale(second, "en");

    expect(settingsStore.loadUserLocale(A)).toBe("id");
    expect(settingsStore.loadUserLocale(second)).toBe("en");
    // And not into anybody else's tenant.
    expect(settingsStore.loadUserLocale(B)).toBe("en");
  });

  it("does not let a hosted user set the language the process booted in", () => {
    hosted();
    settingsStore.saveUserLocale(A, "id");
    // `loadOwnerLocale` is the install's value, which `getBootLocale()` freezes for every tenant.
    expect(settingsStore.loadOwnerLocale()).toBe("en");
  });

  it("still moves the install's locale on a desk, so Restart keeps working", () => {
    const local = { tenantId: LOCAL_TENANT_ID, workspaceId: "home", userId: "owner" };
    settingsStore.saveUserLocale(local, "id");
    expect(settingsStore.loadOwnerLocale()).toBe("id");
    expect(settingsStore.loadUserLocale(local)).toBe("id");
  });

  it("falls back to the tenant's own locale for a user who never chose one", () => {
    const local = { tenantId: LOCAL_TENANT_ID, workspaceId: "home", userId: "owner" };
    settingsStore.saveUserLocale(local, "id");
    // A desktop owner who set Indonesian before this phase must not be reset to English by it.
    expect(settingsStore.loadUserLocale({ ...local, userId: "someone-else" })).toBe("id");
  });

  it("keeps the locale out of the key slice, exactly as before", () => {
    const local = { tenantId: LOCAL_TENANT_ID, workspaceId: "home", userId: "owner" };
    settingsStore.saveUserLocale(local, "id");
    settingsStore.saveSettings({ openaiApiKey: "sk-desktop-key-000000" }, local);
    expect(settingsStore.loadSettings(local)).not.toHaveProperty("locale");
    expect(settingsStore.loadUserLocale(local)).toBe("id");
  });
});

describe("a payload that will not decrypt is not thrown away on the server", () => {
  it("refuses instead of quarantining every tenant's row", () => {
    hosted();
    settingsStore.saveSettings({ openaiApiKey: KEY_A }, A);
    settingsStore.resetSettingsCacheForTests();
    process.env.AGENTFORGE_SECRETS_KEY = `${"c".repeat(63)}d`;

    try {
      // The bytes are every key this tenant ever saved and they come back with the right wrap key,
      // so "cannot open it" must never mean "delete it". One wrong environment variable would
      // otherwise sweep every tenant's vault aside on the next boot.
      expect(() => settingsStore.loadSettings(A)).toThrow(/settings_unreadable|could not be decrypted/);
      expect(stateRows()).toEqual([{ tenant_id: A.tenantId, key: "settings" }]);
    } finally {
      process.env.AGENTFORGE_SECRETS_KEY = WRAP_KEY;
    }

    settingsStore.resetSettingsCacheForTests();
    expect(settingsStore.loadSettings(A).openaiApiKey).toBe(KEY_A);
  });
});
