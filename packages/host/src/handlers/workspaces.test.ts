import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GatewayGatePayload } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";

// Isolation: database, settings.enc, workspace-id.txt and the gate verdict all live in the data dir.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-workspaces-handlers-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_SECRETS_KEY = "c".repeat(64);
delete process.env.AGENTFORGE_RUNTIME;
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.OPENAI_API_KEY;

const KEY = "sk-workspaces-handler-0000000";

type Dispatch = (request: HostRequest) => Promise<HostResult>;
let dispatch: Dispatch;

const realFetch = globalThis.fetch;

type JsonResponse = { status: number; body: Record<string, unknown> };

async function json(method: string, path: string, body?: unknown): Promise<JsonResponse> {
  const result = await dispatch({ method, path, query: {}, params: {}, headers: {}, body });
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return { status: result.status, body: (result.body ?? {}) as Record<string, unknown> };
}

/** Answers every outbound call with 200, so the key check never touches a real gateway. */
function stubFetchOk(): void {
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
}

type Desk = { id: string; name: string; slug: string };

async function listDesks(): Promise<{ workspaces: Desk[]; currentWorkspaceId: string }> {
  const response = await json("GET", "/api/v1/workspaces");
  expect(response.status).toBe(200);
  return response.body as unknown as { workspaces: Desk[]; currentWorkspaceId: string };
}

async function homeDesk(): Promise<Desk> {
  const { workspaces } = await listDesks();
  const home = workspaces.find((desk) => desk.slug === "home");
  if (!home) {
    throw new Error("no Default desk");
  }
  return home;
}

async function createDesk(name: string): Promise<Desk> {
  const response = await json("POST", "/api/v1/workspaces", { name, productModes: ["chat"] });
  expect(response.status).toBe(201);
  return (response.body as { workspace: Desk }).workspace;
}

async function deleteDesk(desk: Desk): Promise<void> {
  const response = await json("DELETE", `/api/v1/workspaces/${desk.id}`, { confirmName: desk.name });
  expect(response.status).toBe(200);
}

async function currentSettings(): Promise<{
  hasOpenai: boolean;
  fingerprint: string | null;
  gateway: GatewayGatePayload;
}> {
  const response = await json("GET", "/api/v1/settings");
  expect(response.status).toBe(200);
  const body = response.body as {
    hasOpenai: boolean;
    openaiKeyFingerprint: string | null;
    gateway: GatewayGatePayload;
  };
  return { hasOpenai: body.hasOpenai, fingerprint: body.openaiKeyFingerprint, gateway: body.gateway };
}

beforeAll(async () => {
  ({ dispatch } = await import("../router"));
}, 60_000);

beforeEach(async () => {
  // Outside stub runtime, which is what a Personal install runs: the gate is derived from the key.
  delete process.env.AGENTFORGE_RUNTIME;
  stubFetchOk();
  const home = await homeDesk();
  await json("POST", `/api/v1/workspaces/${home.id}/select`);
});

afterEach(async () => {
  stubFetchOk();
  const home = await homeDesk();
  await json("POST", `/api/v1/workspaces/${home.id}/select`);
  await json("POST", "/api/v1/settings", { openaiApiKey: "" });
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("POST /api/v1/workspaces on an install with a gateway key", () => {
  it("carries the key into the new desk, so creating a desk never closes the gate", async () => {
    const saved = await json("POST", "/api/v1/settings", { openaiApiKey: KEY });
    expect(saved.status).toBe(200);
    const before = await currentSettings();
    expect(before.hasOpenai).toBe(true);
    expect(before.gateway.allowed).toBe(true);

    const desk = await createDesk("verify-desk");
    expect((await listDesks()).currentWorkspaceId).toBe(desk.id);

    const after = await currentSettings();
    expect(after.hasOpenai).toBe(true);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.gateway.allowed).toBe(true);
    // The verdict is the tenant's and keyed by fingerprint, so the checked key stays checked.
    expect(after.gateway.status).toBe("ok");
    expect(after.gateway.grace).toBe(false);

    await deleteDesk(desk);
  });

  it("leaves the key on the desk it came from when the new desk changes its own", async () => {
    await json("POST", "/api/v1/settings", { openaiApiKey: KEY });
    const home = await homeDesk();
    const desk = await createDesk("verify-desk-own-key");

    // Keys stay per desk: clearing the copy on the new desk does not touch Default's.
    await json("POST", "/api/v1/settings", { openaiApiKey: "" });
    expect((await currentSettings()).hasOpenai).toBe(false);

    await json("POST", `/api/v1/workspaces/${home.id}/select`);
    expect((await currentSettings()).hasOpenai).toBe(true);

    await deleteDesk(desk);
  });
});

describe("POST /api/v1/workspaces on an install with no gateway key", () => {
  it("does not invent a key for the new desk", async () => {
    const desk = await createDesk("verify-desk-keyless");

    const after = await currentSettings();
    expect(after.hasOpenai).toBe(false);
    expect(after.gateway.status).toBe("needs_key");
    expect(after.gateway.allowed).toBe(false);

    await json("POST", `/api/v1/workspaces/${(await homeDesk()).id}/select`);
    await deleteDesk(desk);
  });
});
