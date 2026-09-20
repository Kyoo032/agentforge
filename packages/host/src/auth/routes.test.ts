import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_SECURE,
  IDLE_TIMEOUT_MS,
  createSession,
  revokedSession,
  type SessionRecord,
} from "./session";
import { createMemorySessionStore, createMemoryTokenVault, type SessionStore, type TokenVault } from "./session-store";
import { PortalError, createFakePortalClient, type FakePortalClient } from "./portal-client";
import { createAuthRoutes, isSessionExemptPath, reasonMessage, requireSessionFor, type AuthRouteDeps } from "./routes";
import type { PortalIdentity } from "@agentforge/db";
import type { HostJsonResult, HostRequest } from "../types";

const T0 = Date.UTC(2026, 8, 18, 9, 0, 0);

type Harness = {
  routes: ReturnType<typeof createAuthRoutes>;
  store: SessionStore;
  vault: TokenVault;
  portal: FakePortalClient;
  deps: AuthRouteDeps;
  /** Every identity `handleLogin` provisioned, in order. Lane C: first sign-in writes the tenant. */
  provisioned: PortalIdentity[];
};

function harness(
  options: {
    portal?: FakePortalClient;
    store?: SessionStore;
    vault?: TokenVault;
    serverMode?: boolean;
    provision?: (identity: PortalIdentity) => Promise<unknown>;
  } = {},
): Harness {
  const store = options.store ?? createMemorySessionStore();
  const vault = options.vault ?? createMemoryTokenVault();
  const portal = options.portal ?? createFakePortalClient();
  const provisioned: PortalIdentity[] = [];
  const provision =
    options.provision ??
    (async (identity: PortalIdentity) => {
      provisioned.push(identity);
    });
  const deps: AuthRouteDeps = {
    store,
    vault,
    portal,
    provision,
    serverMode: options.serverMode ?? true,
    now: () => T0,
  };
  return { routes: createAuthRoutes(deps), store, vault, portal, deps, provisioned };
}

function request(overrides: Partial<HostRequest> = {}): HostRequest {
  return {
    method: "POST",
    path: "/api/v1/auth/login",
    query: {},
    params: {},
    headers: {},
    ...overrides,
  };
}

function withSession(id: string, overrides: Partial<HostRequest> = {}): HostRequest {
  // The harness is the hosted server by default, so its cookie carries the `__Host-` name.
  return request({ ...overrides, headers: { cookie: `${SESSION_COOKIE_SECURE}=${id}`, ...overrides.headers } });
}

async function json(result: Promise<unknown>): Promise<HostJsonResult> {
  return (await result) as HostJsonResult;
}

function body(result: HostJsonResult): Record<string, unknown> {
  return result.body as Record<string, unknown>;
}

async function signIn(h: Harness): Promise<{ id: string; result: HostJsonResult }> {
  const result = await json(h.routes.handleLogin(request({ body: { code: "K7M4PQ9T" } })));
  const cookie = result.cookies?.[0];
  return { id: cookie?.value ?? "", result };
}

describe("POST /api/v1/auth/login", () => {
  it("exchanges the code, stores the session server-side and sets the cookie", async () => {
    const h = harness();
    const { id, result } = await signIn(h);
    expect(result.status).toBe(200);
    expect(h.portal.calls).toEqual([{ kind: "exchange", code: "K7M4PQ9T" }]);
    expect(body(result)).toEqual({
      signedIn: true,
      userId: "usr_fake",
      orgId: "org_fake",
      tenantId: "tnt_fake",
      expiresAt: T0 + IDLE_TIMEOUT_MS,
    });
    expect(result.cookies?.[0]).toMatchObject({ name: SESSION_COOKIE_SECURE, path: "/" });
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await h.store.find(id);
    expect(stored).toMatchObject({ userId: "usr_fake", orgId: "org_fake", tenantId: "tnt_fake", revokedAt: null });
  });

  // Phase 3 lane C: first sign-in is what provisions the tenant, because it is the one moment the
  // portal has just vouched for these three ids. Every later request only reads them.
  it("provisions the tenant, org and user from the ids the portal returned", async () => {
    const h = harness();
    await signIn(h);
    expect(h.provisioned).toEqual([{ tenantId: "tnt_fake", orgId: "org_fake", userId: "usr_fake" }]);
  });

  it("provisions before the session exists, so a refused sign-in leaves no session behind", async () => {
    const order: string[] = [];
    const store = createMemorySessionStore();
    const h = harness({
      store: {
        ...store,
        create: async (session) => {
          order.push("session");
          return store.create(session);
        },
      },
      provision: async () => {
        order.push("provision");
      },
    });
    await signIn(h);
    expect(order).toEqual(["provision", "session"]);
  });

  it("refuses the sign-in when the host already holds that org under another tenant", async () => {
    const mismatch = Object.assign(new Error("org_tenant_mismatch"), { name: "PortalProvisionError" });
    const h = harness({
      provision: async () => {
        throw mismatch;
      },
    });
    const result = await h.routes.handleLogin(request({ body: { code: "K7M4PQ9T" } }));
    expect(result.status).toBe(403);
    expect((result.body as { error: { code: string } }).error.code).toBe("org_inactive");
    expect(result.cookies).toBeUndefined();
  });

  it("keeps the portal tokens out of the response and in the vault", async () => {
    const h = harness();
    const { id, result } = await signIn(h);
    expect(JSON.stringify(result.body)).not.toContain("fake-refresh");
    expect(JSON.stringify(result.body)).not.toContain("fake-access");
    expect(await h.vault.get(id)).toEqual({
      refreshToken: "fake-refresh",
      accessToken: "fake-access",
      deviceId: "dev_fake",
    });
  });

  it("refuses a body with no code", async () => {
    const h = harness();
    for (const bad of [undefined, {}, { code: "" }, { code: 7 }]) {
      const result = await json(h.routes.handleLogin(request({ body: bad })));
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: { code: "invalid_request", message: expect.any(String) } });
    }
    expect(h.portal.calls).toEqual([]);
  });

  it.each([
    ["seat_cap_reached", 403],
    ["tenant_inactive", 403],
    ["org_inactive", 403],
    ["org_past_due", 403],
    ["user_inactive", 403],
    ["device_revoked", 403],
    ["session_revoked", 401],
    ["refresh_reused", 401],
    ["refresh_expired", 401],
    ["invalid_grant", 400],
    ["portal_unavailable", 503],
  ] as const)("returns the portal's %s verbatim in the error envelope", async (reason, status) => {
    const h = harness({
      portal: createFakePortalClient({
        failWith: new PortalError(reason, status, { messageEn: "Portal copy.", messageId: "Salinan portal." }),
      }),
    });
    const result = await json(h.routes.handleLogin(request({ body: { code: "c" } })));
    expect(result.status).toBe(status);
    expect(body(result)).toEqual({ error: { code: reason, message: "Portal copy." } });
    expect(result.cookies).toBeUndefined();
  });

  it("falls back to the host's own English copy when the portal sends none", async () => {
    const h = harness({ portal: createFakePortalClient({ failWith: new PortalError("seat_cap_reached", 403) }) });
    const result = await json(h.routes.handleLogin(request({ body: { code: "c" } })));
    expect(body(result)).toEqual({
      error: { code: "seat_cap_reached", message: "No seats left in your organisation." },
    });
  });
});

describe("GET /api/v1/auth/session", () => {
  it("reports a live session", async () => {
    const h = harness();
    const { id } = await signIn(h);
    const result = await json(h.routes.handleSession(withSession(id, { method: "GET" })));
    expect(result.status).toBe(200);
    expect(body(result)).toEqual({
      signedIn: true,
      userId: "usr_fake",
      orgId: "org_fake",
      tenantId: "tnt_fake",
      expiresAt: T0 + IDLE_TIMEOUT_MS,
    });
  });

  it("reports a signed-out visitor with no reason at all", async () => {
    const h = harness();
    const result = await json(h.routes.handleSession(request({ method: "GET" })));
    expect(result.status).toBe(200);
    expect(body(result)).toEqual({ signedIn: false });
  });

  it("names the reason when a cookie was presented", async () => {
    const h = harness();
    const unknown = await json(h.routes.handleSession(withSession("no-such-session", { method: "GET" })));
    expect(body(unknown)).toEqual({ signedIn: false, reason: "session_required" });

    const { id } = await signIn(h);
    const live = (await h.store.find(id)) as SessionRecord;
    await h.store.save(revokedSession(live, T0));
    const revoked = await json(h.routes.handleSession(withSession(id, { method: "GET" })));
    expect(body(revoked)).toEqual({ signedIn: false, reason: "session_revoked" });
  });

  it("reports an idle-expired session as refresh_expired", async () => {
    const store = createMemorySessionStore();
    const stale = createSession({ tenantId: "t", userId: "u", orgId: "o", now: T0 - IDLE_TIMEOUT_MS - 1 });
    await store.create(stale);
    const h = harness({ store });
    const result = await json(h.routes.handleSession(withSession(stale.id, { method: "GET" })));
    expect(body(result)).toEqual({ signedIn: false, reason: "refresh_expired" });
  });

  it("slides lastSeenAt at most once per 5 minutes", async () => {
    const store = createMemorySessionStore();
    const old = createSession({ tenantId: "t", userId: "u", orgId: "o", now: T0 - 6 * 60 * 1000 });
    await store.create(old);
    const h = harness({ store });
    await h.routes.handleSession(withSession(old.id, { method: "GET" }));
    expect((await store.find(old.id))?.lastSeenAt).toBe(T0);

    const fresh = createSession({ tenantId: "t", userId: "u", orgId: "o", now: T0 - 60 * 1000 });
    await store.create(fresh);
    await h.routes.handleSession(withSession(fresh.id, { method: "GET" }));
    expect((await store.find(fresh.id))?.lastSeenAt).toBe(T0 - 60 * 1000);
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("revokes the session, drops the tokens, tells the portal and clears the cookie", async () => {
    const h = harness();
    const { id } = await signIn(h);
    const result = await json(h.routes.handleLogout(withSession(id)));
    expect(result.status).toBe(200);
    expect(body(result)).toEqual({ signedIn: false });
    expect((await h.store.find(id))?.revokedAt).toBe(T0);
    expect(await h.vault.get(id)).toBeNull();
    expect(h.portal.calls.at(-1)).toEqual({ kind: "logout", allDevices: false });
    expect(result.cookies?.[0]).toMatchObject({ name: SESSION_COOKIE_SECURE, value: "" });
  });

  it("is idempotent with no session and never calls the portal", async () => {
    const h = harness();
    const result = await json(h.routes.handleLogout(request()));
    expect(result.status).toBe(200);
    expect(body(result)).toEqual({ signedIn: false });
    expect(h.portal.calls).toEqual([]);
  });

  it("signs out locally even when the portal refuses", async () => {
    const h = harness();
    const { id } = await signIn(h);
    const failing = harness({
      store: h.store,
      vault: h.vault,
      portal: createFakePortalClient({ failWith: new PortalError("portal_unavailable", 503) }),
    });
    const result = await json(failing.routes.handleLogout(withSession(id)));
    expect(result.status).toBe(200);
    expect((await h.store.find(id))?.revokedAt).toBe(T0);
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("rotates the portal tokens and extends the session", async () => {
    const store = createMemorySessionStore();
    const old = createSession({ tenantId: "t", userId: "u", orgId: "o", now: T0 - 60 * 60 * 1000 });
    await store.create(old);
    const vault = createMemoryTokenVault();
    await vault.put(old.id, { refreshToken: "r1", accessToken: "a1", deviceId: "dev_1" });
    const h = harness({ store, vault });
    const result = await json(h.routes.handleRefresh(withSession(old.id)));
    expect(result.status).toBe(200);
    expect(h.portal.calls).toEqual([{ kind: "refresh", refreshToken: "r1", deviceId: "dev_1" }]);
    expect(await vault.get(old.id)).toMatchObject({ refreshToken: "fake-refresh", accessToken: "fake-access" });
    expect((await store.find(old.id))?.expiresAt).toBe(T0 + IDLE_TIMEOUT_MS);
    expect(body(result)).toMatchObject({ signedIn: true, expiresAt: T0 + IDLE_TIMEOUT_MS });
  });

  it("401s with session_required when there is no session", async () => {
    const h = harness();
    const result = await json(h.routes.handleRefresh(request()));
    expect(result.status).toBe(401);
    expect(body(result)).toEqual({ error: { code: "session_required", message: expect.any(String) } });
  });

  it("401s with refresh_expired when the tokens are gone (a server restart)", async () => {
    const store = createMemorySessionStore();
    const session = createSession({ tenantId: "t", userId: "u", orgId: "o", now: T0 });
    await store.create(session);
    const h = harness({ store });
    const result = await json(h.routes.handleRefresh(withSession(session.id)));
    expect(result.status).toBe(401);
    expect(body(result)).toEqual({ error: { code: "refresh_expired", message: expect.any(String) } });
  });

  it.each(["refresh_reused", "session_revoked", "device_revoked", "org_past_due"] as const)(
    "revokes the local session when the portal answers %s",
    async (reason) => {
      const store = createMemorySessionStore();
      const session = createSession({ tenantId: "t", userId: "u", orgId: "o", now: T0 });
      await store.create(session);
      const vault = createMemoryTokenVault();
      await vault.put(session.id, { refreshToken: "r1", accessToken: "a1", deviceId: null });
      const h = harness({
        store,
        vault,
        portal: createFakePortalClient({ failWith: new PortalError(reason, 401) }),
      });
      const result = await json(h.routes.handleRefresh(withSession(session.id)));
      expect(body(result)).toEqual({ error: { code: reason, message: expect.any(String) } });
      expect((await store.find(session.id))?.revokedAt).toBe(T0);
      expect(await vault.get(session.id)).toBeNull();
      expect(result.cookies?.[0]).toMatchObject({ name: SESSION_COOKIE_SECURE, value: "" });
    },
  );

  it("keeps the session when the portal is merely unreachable", async () => {
    const store = createMemorySessionStore();
    const session = createSession({ tenantId: "t", userId: "u", orgId: "o", now: T0 });
    await store.create(session);
    const vault = createMemoryTokenVault();
    await vault.put(session.id, { refreshToken: "r1", accessToken: "a1", deviceId: null });
    const h = harness({
      store,
      vault,
      portal: createFakePortalClient({ failWith: new PortalError("portal_unavailable", 503) }),
    });
    const result = await json(h.routes.handleRefresh(withSession(session.id)));
    expect(result.status).toBe(503);
    expect((await store.find(session.id))?.revokedAt).toBeNull();
    expect(await vault.get(session.id)).not.toBeNull();
    expect(result.cookies).toBeUndefined();
  });
});

describe("isSessionExemptPath", () => {
  it("exempts the auth routes, whatever the method", () => {
    expect(isSessionExemptPath("POST", "/api/v1/auth/login")).toBe(true);
    expect(isSessionExemptPath("POST", "/api/v1/auth/logout")).toBe(true);
    expect(isSessionExemptPath("GET", "/api/v1/auth/session")).toBe(true);
    expect(isSessionExemptPath("POST", "/api/v1/auth/refresh")).toBe(true);
  });

  it("exempts the health probe and the first-run component status, as GETs", () => {
    expect(isSessionExemptPath("GET", "/api/v1/ping")).toBe(true);
    expect(isSessionExemptPath("GET", "/api/v1/components")).toBe(true);
    expect(isSessionExemptPath("get", "/api/v1/ping")).toBe(true);
    expect(isSessionExemptPath("POST", "/api/v1/components")).toBe(false);
    expect(isSessionExemptPath("DELETE", "/api/v1/ping")).toBe(false);
  });

  it("exempts nothing else, and no read is exempt for being a read", () => {
    for (const path of [
      "/api/v1/threads",
      "/api/v1/threads/thr_1",
      "/api/v1/settings",
      "/api/v1/settings/reset",
      "/api/v1/artifacts/art_1/file",
      "/api/v1/knowledge",
      "/api/v1/datasets",
      "/api/v1/components/install/stream",
      "/api/v1/authx",
      "/api/v1/media",
    ]) {
      expect(isSessionExemptPath("GET", path)).toBe(false);
      expect(isSessionExemptPath("POST", path)).toBe(false);
    }
  });
});

describe("requireSessionFor", () => {
  it("returns the verified session", async () => {
    const h = harness();
    const { id } = await signIn(h);
    const session = await requireSessionFor(withSession(id), h.deps);
    expect(session.userId).toBe("usr_fake");
  });

  it("throws session_required with 401 when there is no cookie", async () => {
    const h = harness();
    await expect(requireSessionFor(request(), h.deps)).rejects.toMatchObject({
      code: "session_required",
      status: 401,
    });
  });

  it("throws the portal reason for a revoked session", async () => {
    const h = harness();
    const { id } = await signIn(h);
    const live = (await h.store.find(id)) as SessionRecord;
    await h.store.save(revokedSession(live, T0));
    await expect(requireSessionFor(withSession(id), h.deps)).rejects.toMatchObject({
      code: "session_revoked",
      status: 401,
    });
  });
});

/**
 * The routes hand the adapter a `HostCookie` and it serialises the attributes
 * (`http-adapter.ts:138-146`); there is no second serialiser in this module to keep in step.
 */
describe("the session cookie the routes emit", () => {
  it("is HttpOnly, Lax, whole-app scoped, Secure on the server, and lasts to the absolute expiry", async () => {
    const h = harness();
    const { id, result } = await signIn(h);
    expect(result.cookies).toEqual([
      {
        name: SESSION_COOKIE_SECURE,
        value: id,
        path: "/",
        sameSite: "Lax",
        httpOnly: true,
        secure: true,
        maxAge: 30 * 24 * 60 * 60,
      },
    ]);
  });

  it("drops Secure off the hosted server, so webdev over plain HTTP still works", async () => {
    const h = harness({ serverMode: false });
    const { result } = await signIn(h);
    expect(result.cookies?.[0]).toMatchObject({ secure: false, sameSite: "Lax", httpOnly: true });
  });

  /**
   * `__Host-` is not cosmetic: the browser only accepts it `Secure`, `Path=/` and without a
   * `Domain`, and nothing but the exact origin can write it. Over plain http — webdev, the desktop
   * shell — the browser drops it silently, so off server mode the plain name is the only option and
   * those two builds keep the cookie they have always had.
   */
  it("prefixes the name with __Host- on the hosted server and leaves it plain off it", async () => {
    const hosted = await signIn(harness());
    expect(hosted.result.cookies?.[0]).toMatchObject({ name: SESSION_COOKIE_SECURE, secure: true, path: "/" });
    expect(SESSION_COOKIE_SECURE.startsWith("__Host-")).toBe(true);

    const local = await signIn(harness({ serverMode: false }));
    expect(local.result.cookies?.[0]).toMatchObject({ name: SESSION_COOKIE, secure: false, path: "/" });
  });

  it("clears the name it set, per mode", async () => {
    const local = harness({ serverMode: false });
    const { id } = await signIn(local);
    const cleared = await json(local.routes.handleLogout(request({ headers: { cookie: `${SESSION_COOKIE}=${id}` } })));
    expect(cleared.cookies).toEqual([
      { name: SESSION_COOKIE, value: "", path: "/", sameSite: "Lax", httpOnly: true, secure: false, maxAge: 0 },
    ]);
    // The session really was revoked, so the plain cookie was the one the route read.
    expect((await local.store.find(id))?.revokedAt).not.toBeNull();
  });

  it("ignores a plain-named cookie on the hosted server", async () => {
    const h = harness();
    const { id } = await signIn(h);
    const result = await json(h.routes.handleSession(request({ headers: { cookie: `${SESSION_COOKIE}=${id}` } })));
    expect(body(result)).toEqual({ signedIn: false });
  });

  it("clears with Max-Age=0 and the same attributes on logout", async () => {
    const h = harness();
    const { id } = await signIn(h);
    const result = await json(h.routes.handleLogout(withSession(id)));
    expect(result.cookies).toEqual([
      { name: SESSION_COOKIE_SECURE, value: "", path: "/", sameSite: "Lax", httpOnly: true, secure: true, maxAge: 0 },
    ]);
  });
});

describe("reasonMessage", () => {
  it("is the device-code doc's own English copy", () => {
    expect(reasonMessage("seat_cap_reached")).toBe("No seats left in your organisation.");
    expect(reasonMessage("org_past_due")).toBe("Your organisation's payment is overdue.");
    expect(reasonMessage("refresh_reused")).toBe("Signed out for security. Please sign in again.");
  });
});
