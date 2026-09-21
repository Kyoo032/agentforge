/**
 * Phase 8 — readiness, `GET /api/v1/health`.
 *
 * Liveness (`/healthz`) is proved in `../http-adapter.test.ts`, because it never reaches `dispatch`.
 * What is on trial here is the other route and the two things that make it different: it is behind
 * the session, and it says what liveness refuses to — which backend, which components, ready or
 * not — precisely because it is behind the session.
 *
 * Driven through `dispatch` for the gate, and against `handleGetHealth`'s injected dependencies for
 * the failure shapes, because there is no way to wedge the real database from a test without
 * wedging every other test in the file.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-health-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "b1d7f0429c6a83e51fd2094bc7e3a6851f0d2934be75ac1806fd29e34b7c5a60";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;
delete process.env.AGENTFORGE_STORAGE;

import { dispatch } from "../router";
import { createSession } from "../auth/session";
import { createMemorySessionStore } from "../auth/session-store";
import { handleGetHealth, LIVENESS_BODY, LIVENESS_PATH, type ReadinessDeps } from "./health";
import type { HostJsonResult, HostRequest, HostResult } from "../types";
import type { SessionStore } from "../auth/session-store";

const T0 = Date.UTC(2026, 8, 21, 10, 0, 0);
const ALPHA = { tenantId: "health-tenant-a", orgId: "health-org-a", userId: "health-user-a" };

let store: SessionStore;
let cookie = "";

function json(result: HostResult): HostJsonResult {
  if (result.type !== "json") {
    throw new Error(`expected a json result, got ${result.type}`);
  }
  return result;
}

function body(result: HostResult): Record<string, unknown> {
  return json(result).body as Record<string, unknown>;
}

type Check = { name: string; ok: boolean; detail: string; items?: Array<{ id: string; state: string }> };

function checks(result: HostResult): Check[] {
  return body(result).checks as Check[];
}

function check(result: HostResult, name: string): Check {
  const found = checks(result).find((row) => row.name === name);
  if (!found) {
    throw new Error(`no ${name} check in ${JSON.stringify(checks(result))}`);
  }
  return found;
}

function request(over: Partial<HostRequest> = {}): HostRequest {
  return {
    method: "GET",
    path: "/api/v1/health",
    query: {},
    params: {},
    headers: { cookie },
    ...over,
  };
}

/** Everything healthy, injected, so a case only has to say which one it is breaking. */
const HEALTHY: ReadinessDeps = {
  sql: () => ({ prepare: () => ({ get: () => ({ 1: 1 }) }) }),
  storage: () => ({ kind: "file" }),
  components: () => [{ id: "anydoc", state: "ready" }],
};

beforeAll(async () => {
  const { db, ensurePortalOwner } = await import("@agentforge/db");
  store = createMemorySessionStore();
  await ensurePortalOwner(db, ALPHA);
  const session = createSession({ ...ALPHA, now: T0 });
  await store.create(session);
  cookie = `__Host-agentforge_session=${session.id}`;
});

beforeEach(() => {
  process.env.AGENTFORGE_SERVER = "1";
});

afterEach(() => {
  delete process.env.AGENTFORGE_SERVER;
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("GET /api/v1/health through the router", () => {
  it("needs a session on the hosted server", async () => {
    const result = await dispatch(request({ headers: {} }), { serverMode: true, sessionStore: store, now: () => T0 });
    // The diagnosis this route gives — the backend's name, which components load — is exactly the
    // reconnaissance liveness refuses to hand a stranger. The session is what makes it sayable.
    expect(json(result).status).toBe(401);
  });

  it("answers a signed-in caller with the deployment's verdict", async () => {
    const result = await dispatch(request(), { serverMode: true, sessionStore: store, now: () => T0 });
    expect(json(result).status).toBe(200);
    expect(body(result).mode).toBe("server");
    expect(checks(result).map((row) => row.name)).toEqual(["database", "storage", "components"]);
    // The real database, through the real seam `router.ts` installs.
    expect(check(result, "database").ok).toBe(true);
  });

  it("carries the capability flags, so one read tells a client what this box does", async () => {
    const result = await dispatch(request(), { serverMode: true, sessionStore: store, now: () => T0 });
    const capabilities = body(result).capabilities as Record<string, boolean>;
    expect(capabilities.sessions).toBe(true);
    expect(capabilities.startOver).toBe(false);
    expect(capabilities.tenantReset).toBe(true);
  });

  it("is not a gateway-gated route: a blocked tenant may still read it", async () => {
    // A support conversation that starts with two unknowns instead of one is the failure here.
    const result = await dispatch(request(), { serverMode: true, sessionStore: store, now: () => T0 });
    const error = body(result).error as { code?: string } | undefined;
    expect(error?.code).not.toBe("gateway_blocked");
    expect(json(result).status).toBe(200);
  });
});

describe("what readiness reports", () => {
  /*
   * These call the handler rather than going through `dispatch`, because there is no way to wedge
   * the real database from a test without wedging every other test in the file. That means no
   * ambient session context, which server mode's `getTenant` requires — so they run as the desk,
   * where the owner is local and the checks are the only thing on trial. The mode the body reports
   * is injected in its own case below.
   */
  beforeEach(() => {
    delete process.env.AGENTFORGE_SERVER;
  });

  it("is ready when every dependency answers", async () => {
    const result = await handleGetHealth(request(), HEALTHY);
    expect(body(result).ready).toBe(true);
    expect(check(result, "storage").detail).toBe("file backend configured");
    expect(check(result, "components").items).toEqual([{ id: "anydoc", state: "ready" }]);
  });

  it("is not ready, at HTTP 200, when the database does not answer", async () => {
    const result = await handleGetHealth(request(), {
      ...HEALTHY,
      sql: () => ({
        prepare: () => {
          throw new Error("SQLITE_BUSY: database is locked at /data/agentforge.sqlite");
        },
      }),
    });
    // 200 on purpose: a 503 is what an orchestrator retries and a proxy hides, and this route is
    // read by a person. `/healthz` is the one an orchestrator reads.
    expect(json(result).status).toBe(200);
    expect(body(result).ready).toBe(false);
    expect(check(result, "database")).toMatchObject({ ok: false, detail: "did not answer" });
  });

  it("never puts the thrown message in the body, because a SQLite error names the file", async () => {
    const result = await handleGetHealth(request(), {
      ...HEALTHY,
      sql: () => ({
        prepare: () => {
          throw new Error("SQLITE_BUSY: database is locked at /data/agentforge.sqlite");
        },
      }),
    });
    const payload = JSON.stringify(body(result));
    expect(payload).not.toContain("/data/agentforge.sqlite");
    expect(payload).not.toContain("SQLITE_BUSY");
  });

  it("is not ready when the storage backend cannot be built", async () => {
    const result = await handleGetHealth(request(), {
      ...HEALTHY,
      storage: () => {
        // The shape `createCosObjectStore` throws for a missing bucket or a missing credential:
        // the misconfiguration worth catching before a tenant's first upload finds it.
        throw new Error("COS_BUCKET is not set");
      },
    });
    expect(body(result).ready).toBe(false);
    expect(check(result, "storage").ok).toBe(false);
    expect(JSON.stringify(body(result))).not.toContain("COS_BUCKET");
  });

  it("is not ready when a required component does not load", async () => {
    const result = await handleGetHealth(request(), {
      ...HEALTHY,
      components: () => [
        { id: "anydoc", state: "missing" },
        { id: "ffmpeg", state: "ready" },
      ],
    });
    expect(body(result).ready).toBe(false);
    expect(check(result, "components")).toMatchObject({ ok: false, detail: "1 not loading" });
  });

  it("does not call a component the platform has no package for a failure", async () => {
    const result = await handleGetHealth(request(), {
      ...HEALTHY,
      // `unsupported` is a fact about the platform, not about this box.
      components: () => [{ id: "anydoc", state: "unsupported" }],
    });
    expect(body(result).ready).toBe(true);
    expect(check(result, "components").ok).toBe(true);
  });

  it("names the components and their states and nothing else", async () => {
    const result = await handleGetHealth(request(), {
      ...HEALTHY,
      components: () =>
        [{ id: "anydoc", state: "ready", version: "1.4.2", path: "/opt/agentforge/components/anydoc" }] as never,
    });
    // A version here would tell a signed-in caller which build of a native library to look up, and
    // a path would tell them the layout of the disk. `GET /api/v1/components` is where both live.
    expect(check(result, "components").items).toEqual([{ id: "anydoc", state: "ready" }]);
  });

  it("says which mode the box is in, because half the rules follow from it", async () => {
    // Injected both ways: the field is what a support ticket reads to know which half of the
    // rulebook applies to the box in front of it.
    const desk = await handleGetHealth(request(), { ...HEALTHY, serverMode: () => false });
    expect(body(desk).mode).toBe("desk");
    const server = await handleGetHealth(request(), { ...HEALTHY, serverMode: () => true });
    expect(body(server).mode).toBe("server");
  });
});

describe("the liveness constants readiness must not drift from", () => {
  it("is one word at a fixed path", () => {
    expect(LIVENESS_PATH).toBe("/healthz");
    expect(LIVENESS_BODY).toEqual({ status: "ok" });
    // Frozen, so nothing can push a version or a path into it from somewhere else at runtime.
    expect(Object.isFrozen(LIVENESS_BODY)).toBe(true);
  });
});
