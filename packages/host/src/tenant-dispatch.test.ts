/**
 * Phase 3 lane C at the `dispatch` seam (packages/host/src/router.ts): the verified session is put
 * in async-local storage around the handler, so a handler that still calls
 * `getTenant(request.workspaceId)` — all 102 of them until lane E sweeps the call sites — resolves
 * the session's tenant and not the local owner. And a workspace cookie naming a desk the session's
 * tenant does not own answers 404 **and** clears the cookie.
 *
 * `GET /api/v1/tools` stands in for any gated route; the stub calls `getTenant` the way a real
 * handler does, so what the router set up around it is visible without a real handler's payload.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-tenant-dispatch-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "f".repeat(64);
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;

import { WORKSPACE_COOKIE } from "@agentforge/core";
import { dispatch } from "./router";
import { jsonError } from "./errors";
import { getTenant } from "./tenant";
import type { HostJsonResult, HostRequest } from "./types";
import { createSession } from "./auth/session";
import { createMemorySessionStore } from "./auth/session-store";

const T0 = Date.UTC(2026, 8, 20, 9, 0, 0);

const { resolved } = vi.hoisted(() => ({ resolved: [] as unknown[] }));

vi.mock("./handlers/misc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./handlers/misc")>();
  return {
    ...actual,
    handleGetTools: async (request: { workspaceId?: string | null }) => {
      try {
        // Deliberately the PRE-lane-E call shape: a bare desk id, no request, no session.
        const tenant = await getTenant(request.workspaceId);
        resolved.push(tenant);
        return { type: "json", status: 200, body: { tenantId: tenant.tenantId, workspaceId: tenant.workspaceId } };
      } catch (error) {
        return jsonError(error);
      }
    },
  };
});

const TENANT_A = { tenantId: "d-tenant-a", orgId: "d-org-a", userId: "d-user-a" };
const TENANT_B = { tenantId: "d-tenant-b", orgId: "d-org-b", userId: "d-user-b" };

let store: ReturnType<typeof createMemorySessionStore>;
let sessionA: ReturnType<typeof createSession>;
let sessionB: ReturnType<typeof createSession>;
let deskA: string;
let deskB: string;

function request(overrides: Partial<HostRequest> = {}): HostRequest {
  return { method: "GET", path: "/api/v1/tools", query: {}, params: {}, headers: {}, ...overrides };
}

function asSession(id: string): Partial<HostRequest> {
  return { headers: { cookie: `agentforge_session=${id}` } };
}

describe("dispatch scopes a handler to the request's session", () => {
  beforeAll(async () => {
    const { db, ensurePortalOwner } = await import("@agentforge/db");
    deskA = (await ensurePortalOwner(db, TENANT_A)).workspaceId;
    deskB = (await ensurePortalOwner(db, TENANT_B)).workspaceId;
    store = createMemorySessionStore();
    sessionA = createSession({ ...TENANT_A, now: T0 });
    sessionB = createSession({ ...TENANT_B, now: T0 });
    await store.create(sessionA);
    await store.create(sessionB);
  }, 60_000);

  afterEach(() => {
    resolved.length = 0;
  });

  afterAll(async () => {
    const { sql } = await import("@agentforge/db");
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("resolves the session's tenant even though the handler passed only a desk id", async () => {
    const result = (await dispatch(request(asSession(sessionA.id)), {
      serverMode: true,
      sessionStore: store,
      now: () => T0,
    })) as HostJsonResult;

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ tenantId: "d-tenant-a", workspaceId: deskA });
  });

  it("gives two sessions on one server two different desks on the same route", async () => {
    const a = (await dispatch(request(asSession(sessionA.id)), {
      serverMode: true,
      sessionStore: store,
      now: () => T0,
    })) as HostJsonResult;
    const b = (await dispatch(request(asSession(sessionB.id)), {
      serverMode: true,
      sessionStore: store,
      now: () => T0,
    })) as HostJsonResult;

    expect((a.body as { workspaceId: string }).workspaceId).toBe(deskA);
    expect((b.body as { workspaceId: string }).workspaceId).toBe(deskB);
  });

  it("404s a workspace cookie naming another tenant's desk and clears that cookie", async () => {
    const result = (await dispatch(request({ ...asSession(sessionA.id), workspaceId: deskB }), {
      serverMode: true,
      sessionStore: store,
      now: () => T0,
    })) as HostJsonResult;

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: "workspace_not_found" } });
    expect(result.cookies).toContainEqual({ name: WORKSPACE_COOKIE, value: "", path: "/", maxAge: 0 });
  });

  it("leaves an ordinary 404 alone, so a missing thread never clears a desk selection", async () => {
    const result = (await dispatch(request({ ...asSession(sessionA.id), path: "/api/v1/nope" }), {
      serverMode: true,
      sessionStore: store,
      now: () => T0,
    })) as HostJsonResult;

    expect(result.status).toBe(404);
    expect(result.cookies).toBeUndefined();
  });

  it("never reaches the handler without a session in server mode", async () => {
    const result = (await dispatch(request(), {
      serverMode: true,
      sessionStore: store,
      now: () => T0,
    })) as HostJsonResult;

    expect(result.status).toBe(401);
    expect(resolved).toHaveLength(0);
  });

  it("off server mode still resolves the local owner, with no session anywhere", async () => {
    const result = (await dispatch(request(), { serverMode: false })) as HostJsonResult;

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ tenantId: "local-tenant" });
  });
});
