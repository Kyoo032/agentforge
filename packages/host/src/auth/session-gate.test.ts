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
import { SESSION_COOKIE, createSession } from "./session";
import { createMemorySessionStore } from "./session-store";

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
