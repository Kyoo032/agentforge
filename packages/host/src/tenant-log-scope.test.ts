/**
 * Phase 3 lane E, security spec row L1: every log line written under a hosted handler carries the
 * tenant it was written for.
 *
 * `log.ts` proves the mechanism in isolation; this proves the wiring — that `dispatch`
 * (`./router.ts`) actually opens the scope, with the **verified session's** tenant id rather than
 * the client-supplied workspace cookie, and that off server mode it opens nothing so the desktop's
 * and webdev's lines are byte-identical to what they were.
 *
 * `GET /api/v1/tools` stands in for any gated route, the same stand-in `tenant-dispatch.test.ts`
 * uses; the stub reads the ambient context instead of writing a line, so the assertion does not
 * depend on which events a real handler happens to log.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-tenant-log-scope-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "3f8a1c05d97e26b4084fa3c1e5d7290b6c48af13e02d95b7ca6318fd4e7092a5";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;

import { dispatch } from "./router";
import { currentLogContext } from "./log";
import type { HostRequest } from "./types";
import { createSession } from "./auth/session";
import { createMemorySessionStore } from "./auth/session-store";

const T0 = Date.UTC(2026, 8, 20, 9, 0, 0);

const { seen } = vi.hoisted(() => ({ seen: [] as Record<string, unknown>[] }));

vi.mock("./handlers/misc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./handlers/misc")>();
  const { currentLogContext: read } = await import("./log");
  return {
    ...actual,
    handleGetTools: async () => {
      // Across an await, because that is where an async-local store either holds or does not.
      await Promise.resolve();
      seen.push({ ...read() });
      return { type: "json", status: 200, body: { ok: true } };
    },
  };
});

const TENANT_A = { tenantId: "log-tenant-a", orgId: "log-org-a", userId: "log-user-a" };
const TENANT_B = { tenantId: "log-tenant-b", orgId: "log-org-b", userId: "log-user-b" };

let store: ReturnType<typeof createMemorySessionStore>;
let sessionA: ReturnType<typeof createSession>;
let sessionB: ReturnType<typeof createSession>;

function request(overrides: Partial<HostRequest> = {}): HostRequest {
  return { method: "GET", path: "/api/v1/tools", query: {}, params: {}, headers: {}, ...overrides };
}

function asSession(id: string): Partial<HostRequest> {
  return { headers: { cookie: `agentforge_session=${id}` } };
}

describe("dispatch names the tenant on every log line a handler writes", () => {
  beforeAll(async () => {
    const { db, ensurePortalOwner } = await import("@agentforge/db");
    await ensurePortalOwner(db, TENANT_A);
    await ensurePortalOwner(db, TENANT_B);
    store = createMemorySessionStore();
    sessionA = createSession({ ...TENANT_A, now: T0 });
    sessionB = createSession({ ...TENANT_B, now: T0 });
    await store.create(sessionA);
    await store.create(sessionB);
  }, 60_000);

  afterEach(() => {
    seen.length = 0;
  });

  afterAll(async () => {
    const { sql } = await import("@agentforge/db");
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("carries the session's tenant id and the route into the handler", async () => {
    await dispatch(request(asSession(sessionA.id)), { serverMode: true, sessionStore: store, now: () => T0 });
    expect(seen[0]).toEqual({ tenantId: "log-tenant-a", route: "/api/v1/tools" });
  });

  it("gives two sessions two different tenant ids on the same route", async () => {
    await dispatch(request(asSession(sessionA.id)), { serverMode: true, sessionStore: store, now: () => T0 });
    await dispatch(request(asSession(sessionB.id)), { serverMode: true, sessionStore: store, now: () => T0 });
    expect(seen.map((fields) => fields.tenantId)).toEqual(["log-tenant-a", "log-tenant-b"]);
  });

  it("ignores the workspace cookie: the id logged is the session's, not the client's", async () => {
    // A cookie naming a desk of A's own org, presented by A. The point is that the logged tenant id
    // comes from the verified session either way — a client-supplied value can never name a tenant.
    await dispatch(request({ ...asSession(sessionA.id), workspaceId: "whatever-the-client-said" }), {
      serverMode: true,
      sessionStore: store,
      now: () => T0,
    });
    expect(seen[0]?.tenantId).toBe("log-tenant-a");
  });

  it("opens nothing off server mode, so desktop and webdev lines are unchanged", async () => {
    await dispatch(request(), { serverMode: false });
    expect(seen[0]).toEqual({});
  });

  it("closes the scope again, so nothing after the request is stamped", async () => {
    await dispatch(request(asSession(sessionA.id)), { serverMode: true, sessionStore: store, now: () => T0 });
    expect(currentLogContext()).toEqual({});
  });
});
