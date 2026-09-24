/**
 * The router's session gate (packages/host/src/router.ts): in server mode EVERY `/api` call needs a
 * verified session, whatever the method — a GET leaks a tenant's settings, threads, artifacts and
 * event streams just as surely as a POST writes them. The only exemptions are the four auth routes
 * (nobody has a session yet), the health probe and the first-run component status.
 *
 * Off server mode the gate is not evaluated at all, which is what keeps the desktop (IPC) and
 * webdev behaving exactly as they did before Phase 2.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../router";
import type { HostJsonResult, HostRequest } from "../types";
import { resetHostAuthForTests } from "./index";
import { createPortalSessionCheck } from "./portal-check";
import { createSessionSecrets } from "./session-secrets";
import { PortalError, createFakePortalClient, type FakePortalClient } from "./portal-client";
import { PORTAL_CHECK_INTERVAL_MS, SESSION_COOKIE, createSession } from "./session";
import { createMemorySessionStore, createMemoryTokenVault } from "./session-store";

const T0 = Date.UTC(2026, 8, 18, 9, 0, 0);

/**
 * `GET /api/v1/tools` stands in for "any gated route": the stub records the request the router
 * dispatched, so what the gate attached is visible without a database or a tenant.
 */
const { dispatched } = vi.hoisted(() => ({ dispatched: [] as unknown[] }));

vi.mock("../handlers/misc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../handlers/misc")>();
  return {
    ...actual,
    handleGetTools: async (request: unknown) => {
      dispatched.push(request);
      return { type: "json", status: 200, body: { tools: [] } };
    },
  };
});

function seen(index = 0): HostRequest {
  return dispatched[index] as HostRequest;
}

function request(overrides: Partial<HostRequest> = {}): HostRequest {
  return { method: "POST", path: "/api/v1/threads", query: {}, params: {}, headers: {}, ...overrides };
}

async function live() {
  const store = createMemorySessionStore();
  const session = createSession({ tenantId: "tnt", userId: "usr", orgId: "org", now: T0 });
  await store.create(session);
  return { store, session, now: () => T0 };
}

afterEach(() => {
  dispatched.length = 0;
  vi.unstubAllEnvs();
});

describe("dispatch, server mode off (desktop and webdev)", () => {
  it("never asks for a session on a mutating route", async () => {
    const result = (await dispatch(request({ path: "/api/v1/nope" }), { serverMode: false })) as HostJsonResult;
    // Unknown route, not 401: the gate did not run.
    expect(result.status).toBe(404);
  });

  it("never asks for a session on a read either, and dispatches with no session attached", async () => {
    const result = (await dispatch(request({ method: "GET", path: "/api/v1/tools" }), {
      serverMode: false,
    })) as HostJsonResult;
    expect(result.status).toBe(200);
    expect(seen().session).toBeUndefined();
  });

  it("is the default when no option is passed and AGENTFORGE_SERVER is unset", async () => {
    expect(process.env.AGENTFORGE_SERVER).toBeUndefined();
    const result = (await dispatch(request({ path: "/api/v1/nope" }))) as HostJsonResult;
    expect(result.status).toBe(404);
  });
});

describe("dispatch, server mode on", () => {
  it("401s a mutating call with no session", async () => {
    const { store, now } = await live();
    const result = (await dispatch(request(), { serverMode: true, sessionStore: store, now })) as HostJsonResult;
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: { code: "session_required", message: expect.any(String) } });
  });

  // The bug this suite exists for: every one of these answered anonymously while the gate looked at
  // the method first.
  it.each([
    "/api/v1/settings",
    "/api/v1/threads",
    "/api/v1/threads/thr_1",
    "/api/v1/artifacts/art_1/file",
    "/api/v1/edit/projects/prj_1/events",
    "/api/v1/knowledge",
    "/api/v1/datasets",
    "/api/v1/usage",
    "/api/v1/tools",
  ])("401s an anonymous GET %s", async (path) => {
    const { store, now } = await live();
    const result = (await dispatch(request({ method: "GET", path }), {
      serverMode: true,
      sessionStore: store,
      now,
    })) as HostJsonResult;
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: { code: "session_required", message: expect.any(String) } });
    expect(dispatched).toHaveLength(0);
  });

  it("401s a HEAD and a DELETE the same way", async () => {
    const { store, now } = await live();
    for (const method of ["HEAD", "DELETE", "OPTIONS"]) {
      const result = (await dispatch(request({ method, path: "/api/v1/settings" }), {
        serverMode: true,
        sessionStore: store,
        now,
      })) as HostJsonResult;
      expect(result.status).toBe(401);
    }
  });

  it("401s with the portal reason when the session is revoked", async () => {
    const { store, session, now } = await live();
    await store.save({ ...session, revokedAt: T0 });
    const result = (await dispatch(request({ headers: { cookie: `${SESSION_COOKIE}=${session.id}` } }), {
      serverMode: true,
      sessionStore: store,
      now,
    })) as HostJsonResult;
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: { code: "session_revoked", message: expect.any(String) } });
  });

  it("401s a malformed cookie rather than letting a URIError become a 500", async () => {
    const { store, now } = await live();
    const malformed = request({ method: "GET", path: "/api/v1/tools", headers: { cookie: `${SESSION_COOKIE}=%` } });
    const result = (await dispatch(malformed, { serverMode: true, sessionStore: store, now })) as HostJsonResult;
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: { code: "session_required", message: expect.any(String) } });
    expect(dispatched).toHaveLength(0);
  });

  it("401s before it decides whether the route even exists", async () => {
    const { store, now } = await live();
    const result = (await dispatch(request({ path: "/api/v1/nope" }), {
      serverMode: true,
      sessionStore: store,
      now,
    })) as HostJsonResult;
    expect(result.status).toBe(401);
  });

  it("lets GET /api/v1/ping through: the health probe runs before anyone can sign in", async () => {
    const { store, now } = await live();
    const result = (await dispatch(request({ method: "GET", path: "/api/v1/ping" }), {
      serverMode: true,
      sessionStore: store,
      now,
    })) as HostJsonResult;
    expect(result.status).toBe(200);
  });

  it("lets GET /api/v1/components through: the first-run installer runs before anyone can sign in", async () => {
    const { store, now } = await live();
    const result = (await dispatch(request({ method: "GET", path: "/api/v1/components" }), {
      serverMode: true,
      sessionStore: store,
      now,
    })) as HostJsonResult;
    expect(result.status).toBe(200);
  });

  it("still gates the component install, which is a POST on a longer path", async () => {
    const { store, now } = await live();
    const result = (await dispatch(request({ path: "/api/v1/components/install/stream" }), {
      serverMode: true,
      sessionStore: store,
      now,
    })) as HostJsonResult;
    expect(result.status).toBe(401);
  });

  it("lets POST /api/v1/auth/login through to its own validation", async () => {
    const { store, now } = await live();
    const result = (await dispatch(request({ path: "/api/v1/auth/login", body: {} }), {
      serverMode: true,
      sessionStore: store,
      now,
    })) as HostJsonResult;
    // The handler answered, not the gate: a missing code is `invalid_request`, not `session_required`.
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: "invalid_request" } });
  });

  it("lets POST /api/v1/auth/logout through and answers idempotently", async () => {
    const { store, now } = await live();
    const result = (await dispatch(request({ path: "/api/v1/auth/logout" }), {
      serverMode: true,
      sessionStore: store,
      now,
    })) as HostJsonResult;
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ signedIn: false });
  });

  it("runs a mutating call that carries a live session", async () => {
    const { store, session, now } = await live();
    const result = (await dispatch(
      request({ path: "/api/v1/nope", headers: { cookie: `${SESSION_COOKIE}=${session.id}` } }),
      { serverMode: true, sessionStore: store, now },
    )) as HostJsonResult;
    // Past the gate: the router's own 404 is what comes back.
    expect(result.status).toBe(404);
  });

  it("slides lastSeenAt through the gate at most once per 5 minutes", async () => {
    const store = createMemorySessionStore();
    const old = createSession({ tenantId: "t", userId: "u", orgId: "o", now: T0 - 6 * 60 * 1000 });
    await store.create(old);
    await dispatch(request({ path: "/api/v1/nope", headers: { cookie: `${SESSION_COOKIE}=${old.id}` } }), {
      serverMode: true,
      sessionStore: store,
      now: () => T0,
    });
    expect((await store.find(old.id))?.lastSeenAt).toBe(T0);
  });

  it("leaves the non-/api paths alone", async () => {
    const { store, now } = await live();
    const result = (await dispatch(request({ path: "/healthz" }), {
      serverMode: true,
      sessionStore: store,
      now,
    })) as HostJsonResult;
    expect(result.status).toBe(404);
  });

  it("reads isServerMode() per request, not once at import", async () => {
    const { store, now } = await live();
    // The module was imported with AGENTFORGE_SERVER unset; the gate must still see this.
    vi.stubEnv("AGENTFORGE_SERVER", "1");
    const gated = (await dispatch(request({ method: "GET", path: "/api/v1/settings" }), {
      sessionStore: store,
      now,
    })) as HostJsonResult;
    expect(gated.status).toBe(401);
    vi.unstubAllEnvs();
    const open = (await dispatch(request({ path: "/api/v1/nope" }), { sessionStore: store, now })) as HostJsonResult;
    expect(open.status).toBe(404);
  });
});

/**
 * Phase 3 hook (docs/internal/web-security-spec.md row T2): the gate knows who the caller is, so it
 * hands the handler the session. `getTenant()` does not read it yet — until it does, the hosted
 * server is single-tenant.
 */
describe("the verified session reaches the handler", () => {
  it("dispatches with request.session set to the session's ids", async () => {
    const { store, session, now } = await live();
    const result = (await dispatch(
      request({ method: "GET", path: "/api/v1/tools", headers: { cookie: `${SESSION_COOKIE}=${session.id}` } }),
      { serverMode: true, sessionStore: store, now },
    )) as HostJsonResult;
    expect(result.status).toBe(200);
    expect(seen().session).toEqual({
      id: session.id,
      tenantId: "tnt",
      orgId: "org",
      userId: "usr",
    });
  });

  it("carries the slid session, so the handler never sees a stale expiry", async () => {
    const store = createMemorySessionStore();
    const old = createSession({ tenantId: "t", userId: "u", orgId: "o", now: T0 - 6 * 60 * 1000 });
    await store.create(old);
    await dispatch(
      request({ method: "GET", path: "/api/v1/tools", headers: { cookie: `${SESSION_COOKIE}=${old.id}` } }),
      { serverMode: true, sessionStore: store, now: () => T0 },
    );
    expect(seen().session?.id).toBe(old.id);
  });

  // `session` is a trust marker. Only the gate may set it, or an adapter that ever spread untrusted
  // input into a HostRequest would hand a handler a tenant of the caller's choosing.
  it("drops a session the caller invented, off server mode", async () => {
    const forged = {
      ...request({ method: "GET", path: "/api/v1/tools" }),
      session: { id: "forged", tenantId: "victim", orgId: "victim", userId: "victim" },
    };
    await dispatch(forged, { serverMode: false });
    expect(seen().session).toBeUndefined();
  });

  it("replaces a session the caller invented with the verified one", async () => {
    const { store, session, now } = await live();
    const forged = {
      ...request({
        method: "GET",
        path: "/api/v1/tools",
        headers: { cookie: `${SESSION_COOKIE}=${session.id}` },
      }),
      session: { id: "forged", tenantId: "victim", orgId: "victim", userId: "victim" },
    };
    await dispatch(forged, { serverMode: true, sessionStore: store, now });
    expect(seen().session).toEqual({ id: session.id, tenantId: "tnt", orgId: "org", userId: "usr" });
  });

  it("never mutates the caller's request object", async () => {
    const { store, session, now } = await live();
    const original = request({
      method: "GET",
      path: "/api/v1/tools",
      headers: { cookie: `${SESSION_COOKIE}=${session.id}` },
    });
    await dispatch(original, { serverMode: true, sessionStore: store, now });
    expect(original.session).toBeUndefined();
    expect(seen()).not.toBe(original);
  });
});

/**
 * The gate asks the portal (./portal-check.ts). Before this, a session the portal had revoked kept
 * working here for as long as the host's own row did: 12 h idle, 30 days absolute.
 */
describe("the gate checks the session with the portal once its last word is ten minutes old", () => {
  const DUE_AT = T0;
  const SIGNED_IN_AT = T0 - PORTAL_CHECK_INTERVAL_MS;

  async function due(portal: FakePortalClient, options: { withTokens?: boolean } = {}) {
    const store = createMemorySessionStore();
    const vault = createMemoryTokenVault();
    const session = createSession({ tenantId: "tnt", userId: "usr", orgId: "org", now: SIGNED_IN_AT });
    await store.create(session);
    if (options.withTokens ?? true) {
      await vault.put(session.id, { refreshToken: "r1", accessToken: "a1", deviceId: "dev_1" });
    }
    const portalCheck = createPortalSessionCheck({ vault, portal });
    const dispatchOptions = { serverMode: true, sessionStore: store, now: () => DUE_AT, portalCheck };
    const call = () =>
      dispatch(
        request({ method: "GET", path: "/api/v1/tools", headers: { cookie: `${SESSION_COOKIE}=${session.id}` } }),
        dispatchOptions,
      ) as Promise<HostJsonResult>;
    return { store, vault, session, call };
  }

  it("refuses with the portal's own reason when the portal has ended the session, before any handler runs", async () => {
    const portal = createFakePortalClient({ failWith: new PortalError("device_revoked", 403) });
    const { store, session, call } = await due(portal);
    const result = await call();
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: { code: "device_revoked", message: expect.any(String) } });
    expect(dispatched).toHaveLength(0);
    expect((await store.find(session.id))?.revokedAt).toBe(DUE_AT);
  });

  it.each(["session_revoked", "user_inactive", "org_past_due", "tenant_inactive", "refresh_reused"] as const)(
    "ends the session for %s, and the next request is refused without asking again",
    async (reason) => {
      const portal = createFakePortalClient({ failWith: new PortalError(reason, 401) });
      const { call } = await due(portal);
      expect((await call()).body).toMatchObject({ error: { code: reason } });
      const again = await call();
      expect(again.status).toBe(401);
      expect(again.body).toMatchObject({ error: { code: "session_revoked" } });
      expect(portal.calls.filter((entry) => entry.kind === "refresh")).toHaveLength(1);
    },
  );

  it("lets the request through when the portal rotates the tokens, and keeps the new pair", async () => {
    const portal = createFakePortalClient();
    const { store, vault, session, call } = await due(portal);
    const result = await call();
    expect(result.status).toBe(200);
    expect(dispatched).toHaveLength(1);
    expect(portal.calls).toEqual([{ kind: "refresh", refreshToken: "r1", deviceId: "dev_1" }]);
    expect(await vault.get(session.id)).toEqual({
      refreshToken: "fake-refresh",
      accessToken: "fake-access",
      deviceId: "dev_fake",
    });
    expect((await store.find(session.id))?.portalCheckedAt).toBe(DUE_AT);
  });

  it("lets the request through when the portal is unreachable: an outage never signs anybody out", async () => {
    const portal = createFakePortalClient({ failWith: new PortalError("portal_unavailable", 503) });
    const { store, session, call } = await due(portal);
    const result = await call();
    expect(result.status).toBe(200);
    expect((await store.find(session.id))?.revokedAt).toBeNull();
  });

  it("ends a due session the host holds no tokens for, which is what a restart leaves", async () => {
    const portal = createFakePortalClient();
    const { call } = await due(portal, { withTokens: false });
    const result = await call();
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: { code: "refresh_expired" } });
    expect(portal.calls).toEqual([]);
  });

  it("does not ask the portal inside the interval", async () => {
    const portal = createFakePortalClient({ failWith: new PortalError("device_revoked", 403) });
    const { store, session, now } = await live();
    const portalCheck = createPortalSessionCheck({ vault: createMemoryTokenVault(), portal });
    const result = (await dispatch(
      request({ method: "GET", path: "/api/v1/tools", headers: { cookie: `${SESSION_COOKIE}=${session.id}` } }),
      { serverMode: true, sessionStore: store, now, portalCheck },
    )) as HostJsonResult;
    expect(result.status).toBe(200);
    expect(portal.calls).toEqual([]);
  });

  it("never asks off server mode, where there is no session to check", async () => {
    const portal = createFakePortalClient({ failWith: new PortalError("device_revoked", 403) });
    const portalCheck = createPortalSessionCheck({ vault: createMemoryTokenVault(), portal });
    const result = (await dispatch(request({ method: "GET", path: "/api/v1/tools" }), {
      serverMode: false,
      portalCheck,
    })) as HostJsonResult;
    expect(result.status).toBe(200);
    expect(portal.calls).toEqual([]);
  });

  it("falls back to the process-wide check, whose vault holds nothing for a session it never signed in", async () => {
    const store = createMemorySessionStore();
    const session = createSession({ tenantId: "tnt", userId: "usr", orgId: "org", now: SIGNED_IN_AT });
    await store.create(session);
    const result = (await dispatch(
      request({ method: "GET", path: "/api/v1/tools", headers: { cookie: `${SESSION_COOKIE}=${session.id}` } }),
      { serverMode: true, sessionStore: store, now: () => DUE_AT },
    )) as HostJsonResult;
    resetHostAuthForTests();
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: { code: "refresh_expired" } });
  });
});

/**
 * Owner decision, 2026-09-23: a restart or a deploy signs nobody out. After one, the process's
 * vault is empty and the gate's first check on a due session opens the refresh token sealed on the
 * row instead of ending the session.
 */
describe("the gate after a restart", () => {
  it("lets a due session through on the refresh token sealed on its row", async () => {
    const secrets = createSessionSecrets(() => Buffer.alloc(32, 3));
    const store = createMemorySessionStore();
    const session = createSession({ tenantId: "tnt", userId: "usr", orgId: "org", now: T0 - PORTAL_CHECK_INTERVAL_MS });
    await store.create(session, secrets.seal(session.id, { refreshToken: "sealed-r1", deviceId: "dev_1" }));
    const portal = createFakePortalClient();
    // A fresh process: nothing in memory.
    const portalCheck = createPortalSessionCheck({ vault: createMemoryTokenVault(), portal, secrets });
    const result = (await dispatch(
      request({ method: "GET", path: "/api/v1/tools", headers: { cookie: `${SESSION_COOKIE}=${session.id}` } }),
      { serverMode: true, sessionStore: store, now: () => T0, portalCheck },
    )) as HostJsonResult;
    expect(result.status).toBe(200);
    expect(portal.calls).toEqual([{ kind: "refresh", refreshToken: "sealed-r1", deviceId: "dev_1" }]);
    expect(secrets.open(session.id, (await store.readRefreshSealed(session.id)) as string)).toEqual({
      refreshToken: "fake-refresh",
      deviceId: "dev_fake",
    });
  });
});
