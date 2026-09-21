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
import {
  LOGIN_STATE_COOKIE,
  LOGIN_STATE_COOKIE_SECURE,
  LOGIN_STATE_MAX_AGE_SECONDS,
  loginStateCookieName,
} from "./login-state";
import { LOGIN_CONFIG_ERROR } from "./portal-config";
import { isAuthPath } from "../rate-limit";
import type { EnvLike } from "@agentforge/core";
import type { PortalIdentity } from "@agentforge/db";
import type { HostCookie, HostJsonResult, HostRequest } from "../types";

const T0 = Date.UTC(2026, 8, 18, 9, 0, 0);

/** A fully configured hosted deployment. Every case passes its own; none touches `process.env`. */
const PORTAL_ENV: EnvLike = {
  AGENTFORGE_PORTAL_URL: "https://portal.example.test/api",
  AGENTFORGE_PORTAL_CLIENT_ID: "cli_abc",
  AGENTFORGE_PORTAL_CLIENT_SECRET: "sec_xyz",
  AGENTFORGE_PUBLIC_URL: "https://app.example.test",
};

const REDIRECT_URI = "https://app.example.test/auth/callback";
/** The opaque value `/auth/start` minted and put in the cookie; the browser echoes it back. */
const STATE = "st_a_known_opaque_value";

type Harness = {
  routes: ReturnType<typeof createAuthRoutes>;
  store: SessionStore;
  vault: TokenVault;
  portal: FakePortalClient;
  deps: AuthRouteDeps;
  /** Every identity `handleLogin` provisioned, in order. Lane C: first sign-in writes the tenant. */
  provisioned: PortalIdentity[];
  /** Every identity `handleLogin` claimed a seat for, in order. Lane B: the seat cap at sign-in. */
  seated: PortalIdentity[];
};

function harness(
  options: {
    portal?: FakePortalClient;
    store?: SessionStore;
    vault?: TokenVault;
    serverMode?: boolean;
    env?: EnvLike;
    provision?: (identity: PortalIdentity) => Promise<unknown>;
    claimSeat?: (identity: PortalIdentity) => Promise<{ readonly ok: boolean }>;
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
  const seated: PortalIdentity[] = [];
  // The default admits everybody, which is what a tenant with no plan row gets from the real
  // wiring: a null seat cap. A case that wants the refusal passes its own.
  const claimSeat =
    options.claimSeat ??
    (async (identity: PortalIdentity) => {
      seated.push(identity);
      return { ok: true };
    });
  const deps: AuthRouteDeps = {
    store,
    vault,
    portal,
    provision,
    claimSeat,
    serverMode: options.serverMode ?? true,
    env: options.env ?? PORTAL_ENV,
    now: () => T0,
  };
  return { routes: createAuthRoutes(deps), store, vault, portal, deps, provisioned, seated };
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

/** The `state` cookie as the browser presents it back, under this mode's name. */
function stateCookie(h: Harness, value: string): string {
  return `${loginStateCookieName({ secure: h.deps.serverMode })}=${value}`;
}

function cookieNamed(result: HostJsonResult, name: string): HostCookie | undefined {
  return result.cookies?.find((cookie) => cookie.name === name);
}

/**
 * A sign-in that carries a matching `state` in the body and the cookie, which is what
 * `/api/v1/auth/start` set up one hop earlier. A case that wants the mismatch passes its own.
 */
async function signIn(
  h: Harness,
  over: { bodyState?: string | null; cookieState?: string | null } = {},
): Promise<{ id: string; result: HostJsonResult }> {
  const bodyState = over.bodyState === undefined ? STATE : over.bodyState;
  const cookieState = over.cookieState === undefined ? STATE : over.cookieState;
  const headers = cookieState === null ? {} : { cookie: stateCookie(h, cookieState) };
  const body = bodyState === null ? { code: "K7M4PQ9T" } : { code: "K7M4PQ9T", state: bodyState };
  const result = await json(h.routes.handleLogin(request({ body, headers })));
  return { id: cookieNamed(result, sessionCookieNameFor(h))?.value ?? "", result };
}

function sessionCookieNameFor(h: Harness): string {
  return h.deps.serverMode ? SESSION_COOKIE_SECURE : SESSION_COOKIE;
}

describe("POST /api/v1/auth/login", () => {
  it("exchanges the code, stores the session server-side and sets the cookie", async () => {
    const h = harness();
    const { id, result } = await signIn(h);
    expect(result.status).toBe(200);
    // The exchange carries the same `redirect_uri` `/auth/start` put in the authorize URL, plus the
    // confidential client's id. The secret goes on the wire and is never recorded by the fake.
    expect(h.portal.calls).toEqual([
      { kind: "exchange", code: "K7M4PQ9T", redirectUri: REDIRECT_URI, clientId: "cli_abc" },
    ]);
    expect(body(result)).toEqual({
      signedIn: true,
      userId: "usr_fake",
      orgId: "org_fake",
      tenantId: "tnt_fake",
      expiresAt: T0 + IDLE_TIMEOUT_MS,
    });
    expect(cookieNamed(result, SESSION_COOKIE_SECURE)).toMatchObject({ name: SESSION_COOKIE_SECURE, path: "/" });
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
    const { result } = await signIn(h);
    expect(result.status).toBe(403);
    expect((result.body as { error: { code: string } }).error.code).toBe("org_inactive");
    expect(cookieNamed(result, SESSION_COOKIE_SECURE)).toBeUndefined();
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
    for (const bad of [undefined, {}, { code: "" }, { code: 7 }, { state: STATE }]) {
      const result = await json(
        h.routes.handleLogin(request({ body: bad, headers: { cookie: stateCookie(h, STATE) } })),
      );
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
    const { result } = await signIn(h);
    expect(result.status).toBe(status);
    expect(body(result)).toEqual({ error: { code: reason, message: "Portal copy." } });
    expect(cookieNamed(result, SESSION_COOKIE_SECURE)).toBeUndefined();
  });

  it("falls back to the host's own English copy when the portal sends none", async () => {
    const h = harness({ portal: createFakePortalClient({ failWith: new PortalError("seat_cap_reached", 403) }) });
    const { result } = await signIn(h);
    expect(body(result)).toEqual({
      error: { code: "seat_cap_reached", message: "No seats left in your organisation." },
    });
  });
});

/**
 * The login-CSRF control (plan §3 of the browser flow). Without it, anybody who can make a browser
 * POST to this route can plant THEIR authorization code in somebody else's session — the victim
 * then works, uploads and pays inside the attacker's tenant. The state is minted by `/auth/start`,
 * kept in an HttpOnly cookie the page's script cannot read, and compared in constant time.
 */
describe("POST /api/v1/auth/login — the state binding", () => {
  it.each([
    ["no state in the body", { bodyState: null }],
    ["no state cookie", { cookieState: null }],
    ["a state that does not match the cookie", { bodyState: "st_attacker" }],
    ["an empty state on both sides", { bodyState: "", cookieState: "" }],
    ["a state that is a prefix of the cookie's", { bodyState: STATE.slice(0, 5) }],
  ])("refuses %s, and never calls the portal", async (_name, over) => {
    const h = harness();
    const { result } = await signIn(h, over);
    expect(result.status).toBe(400);
    expect(body(result)).toEqual({ error: { code: "invalid_request", message: expect.any(String) } });
    expect(h.portal.calls).toEqual([]);
    expect(h.provisioned).toEqual([]);
    expect(cookieNamed(result, SESSION_COOKIE_SECURE)).toBeUndefined();
  });

  it("never echoes the state back in the refusal", async () => {
    const h = harness();
    const { result } = await signIn(h, { bodyState: "st_attacker" });
    expect(JSON.stringify(result.body)).not.toContain("st_attacker");
    expect(JSON.stringify(result.body)).not.toContain(STATE);
  });

  it("clears the state cookie on a successful sign-in — one state, one attempt", async () => {
    const h = harness();
    const { result } = await signIn(h);
    expect(cookieNamed(result, LOGIN_STATE_COOKIE_SECURE)).toEqual({
      name: LOGIN_STATE_COOKIE_SECURE,
      value: "",
      path: "/",
      sameSite: "Lax",
      httpOnly: true,
      secure: true,
      maxAge: 0,
    });
  });

  it.each([
    ["a state mismatch", { bodyState: "st_attacker" }],
    ["a portal refusal", { bodyState: STATE }],
  ])("clears the state cookie after %s too, so a stale state cannot be replayed", async (_name, over) => {
    const h = harness({ portal: createFakePortalClient({ failWith: new PortalError("invalid_grant", 400) }) });
    const { result } = await signIn(h, over);
    expect(cookieNamed(result, LOGIN_STATE_COOKIE_SECURE)).toMatchObject({ value: "", maxAge: 0 });
  });

  it("503s with a configuration code when the client credentials are absent, without calling the portal", async () => {
    const h = harness({ env: { ...PORTAL_ENV, AGENTFORGE_PORTAL_CLIENT_SECRET: "" } });
    const { result } = await signIn(h);
    expect(result.status).toBe(503);
    expect((body(result).error as { code: string }).code).toBe(LOGIN_CONFIG_ERROR);
    expect(h.portal.calls).toEqual([]);
  });

  it("never puts the client secret in the answer", async () => {
    const h = harness({ env: { ...PORTAL_ENV, AGENTFORGE_PUBLIC_URL: "http://app.example.test" } });
    const { result } = await signIn(h);
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toContain("sec_xyz");
  });
});

/**
 * `/api/v1/auth/start` — the first hop. It mints the state, puts it somewhere the browser cannot
 * read, and hands back where to send the person.
 */
describe("GET /api/v1/auth/start", () => {
  const startRequest = () => request({ method: "GET", path: "/api/v1/auth/start" });

  it("returns the authorize URL and sets the state cookie", async () => {
    const h = harness();
    const result = await json(h.routes.handleStart(startRequest()));
    expect(result.status).toBe(200);

    const url = new URL((body(result) as { authorizeUrl: string }).authorizeUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://portal.example.test/api/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cli_abc");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);

    const cookie = cookieNamed(result, LOGIN_STATE_COOKIE_SECURE);
    expect(cookie).toEqual({
      name: LOGIN_STATE_COOKIE_SECURE,
      value: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      path: "/",
      sameSite: "Lax",
      httpOnly: true,
      secure: true,
      maxAge: LOGIN_STATE_MAX_AGE_SECONDS,
    });
    // The cookie and the URL carry the SAME state: that is the whole binding.
    expect(url.searchParams.get("state")).toBe(cookie?.value);
    expect(Object.keys(body(result))).toEqual(["authorizeUrl"]);
  });

  it("mints a fresh state on every call", async () => {
    const h = harness();
    const first = await json(h.routes.handleStart(startRequest()));
    const second = await json(h.routes.handleStart(startRequest()));
    expect(cookieNamed(first, LOGIN_STATE_COOKIE_SECURE)?.value).not.toBe(
      cookieNamed(second, LOGIN_STATE_COOKIE_SECURE)?.value,
    );
  });

  it("hands the browser a state the next login accepts", async () => {
    const h = harness();
    const start = await json(h.routes.handleStart(startRequest()));
    const state = cookieNamed(start, LOGIN_STATE_COOKIE_SECURE)?.value as string;
    const { result } = await signIn(h, { bodyState: state, cookieState: state });
    expect(result.status).toBe(200);
  });

  it("does not exist off server mode, like the other hosted-only routes", async () => {
    const h = harness({ serverMode: false });
    const result = await json(h.routes.handleStart(startRequest()));
    expect(result.status).toBe(404);
    expect(result.cookies).toBeUndefined();
  });

  it.each([
    ["no public URL and no trusted origin", { ...PORTAL_ENV, AGENTFORGE_PUBLIC_URL: "" }],
    ["a cleartext public URL off loopback", { ...PORTAL_ENV, AGENTFORGE_PUBLIC_URL: "http://app.example.test" }],
    ["no client id", { ...PORTAL_ENV, AGENTFORGE_PORTAL_CLIENT_ID: "" }],
    ["no client secret", { ...PORTAL_ENV, AGENTFORGE_PORTAL_CLIENT_SECRET: "" }],
    ["no portal URL", { ...PORTAL_ENV, AGENTFORGE_PORTAL_URL: "" }],
  ])("503s with a clear configuration code when there is %s", async (_name, env) => {
    const h = harness({ env: { ...env, AGENTFORGE_SERVER: "1" } });
    const result = await json(h.routes.handleStart(startRequest()));
    expect(result.status).toBe(503);
    expect((body(result).error as { code: string }).code).toBe(LOGIN_CONFIG_ERROR);
    expect(result.cookies).toBeUndefined();
  });

  it("falls back to the first trusted origin when no public URL is set", async () => {
    const h = harness({
      env: {
        ...PORTAL_ENV,
        AGENTFORGE_SERVER: "1",
        AGENTFORGE_PUBLIC_URL: "",
        AGENTFORGE_TRUSTED_ORIGINS: "https://desk.example.test,https://second.example.test",
      },
    });
    const result = await json(h.routes.handleStart(startRequest()));
    const url = new URL((body(result) as { authorizeUrl: string }).authorizeUrl);
    expect(url.searchParams.get("redirect_uri")).toBe("https://desk.example.test/auth/callback");
  });

  it("needs no session and rides the tight auth rate bucket, like its siblings", () => {
    expect(isSessionExemptPath("GET", "/api/v1/auth/start")).toBe(true);
    expect(isAuthPath("/api/v1/auth/start")).toBe(true);
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
  /** The portal hop this deployment's answer names, as a parsed URL. */
  function portalLogout(result: HostJsonResult): URL {
    return new URL(body(result).portalLogoutUrl as string);
  }

  it("revokes the session, drops the tokens, tells the portal and clears the cookie", async () => {
    const h = harness();
    const { id } = await signIn(h);
    const result = await json(h.routes.handleLogout(withSession(id)));
    expect(result.status).toBe(200);
    expect(body(result).signedIn).toBe(false);
    expect((await h.store.find(id))?.revokedAt).toBe(T0);
    expect(await h.vault.get(id)).toBeNull();
    expect(h.portal.calls.at(-1)).toEqual({ kind: "logout", allDevices: false });
    expect(result.cookies?.[0]).toMatchObject({ name: SESSION_COOKIE_SECURE, value: "" });
  });

  it("is idempotent with no session and never calls the portal", async () => {
    const h = harness();
    const result = await json(h.routes.handleLogout(request()));
    expect(result.status).toBe(200);
    expect(body(result).signedIn).toBe(false);
    expect(h.portal.calls).toEqual([]);
  });

  /**
   * SR-21. Clearing this deployment's cookie is half a sign-out: the portal keeps a 30-day browser
   * session of its own, and while it is live `GET /authorize` hands back a code with no OTP at
   * all. So the answer names the portal's `/logout`, which the renderer navigates to; the portal
   * only redirects back to an origin that client has registered, which is this deployment's.
   */
  it("names the portal's logout, with this deployment's sign-in as the way back", async () => {
    const h = harness();
    const { id } = await signIn(h);
    const url = portalLogout(await json(h.routes.handleLogout(withSession(id))));

    expect(url.origin).toBe("https://portal.example.test");
    expect(url.pathname).toBe("/api/logout");
    expect(url.searchParams.get("client_id")).toBe("cli_abc");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://app.example.test/sign-in");
  });

  it("names it on the idempotent answer too, because the portal cookie outlives this one", async () => {
    const h = harness();
    const url = portalLogout(await json(h.routes.handleLogout(request())));
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://app.example.test/sign-in");
  });

  it("carries no portal logout at all when sign-in is not configured", async () => {
    const h = harness({ env: {} });
    const result = await json(h.routes.handleLogout(request()));
    expect(result.status).toBe(200);
    expect(body(result)).toEqual({ signedIn: false });
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
    expect(cookieNamed(result, SESSION_COOKIE_SECURE)).toEqual({
      name: SESSION_COOKIE_SECURE,
      value: id,
      path: "/",
      sameSite: "Lax",
      httpOnly: true,
      secure: true,
      maxAge: 30 * 24 * 60 * 60,
    });
    // Exactly two: the session, and the spent state being cleared. Nothing else is ever set here.
    expect(result.cookies?.map((cookie) => cookie.name)).toEqual([SESSION_COOKIE_SECURE, LOGIN_STATE_COOKIE_SECURE]);
  });

  it("drops Secure off the hosted server, so webdev over plain HTTP still works", async () => {
    const h = harness({ serverMode: false });
    const { result } = await signIn(h);
    expect(cookieNamed(result, SESSION_COOKIE)).toMatchObject({ secure: false, sameSite: "Lax", httpOnly: true });
    // And the state cookie makes the same split, for the same reason: a browser on plain http
    // silently drops a `__Host-` cookie, so off the server the plain name is the only one that works.
    expect(cookieNamed(result, LOGIN_STATE_COOKIE)).toMatchObject({ value: "", maxAge: 0, secure: false });
    expect(cookieNamed(result, LOGIN_STATE_COOKIE_SECURE)).toBeUndefined();
  });

  /**
   * `__Host-` is not cosmetic: the browser only accepts it `Secure`, `Path=/` and without a
   * `Domain`, and nothing but the exact origin can write it. Over plain http — webdev, the desktop
   * shell — the browser drops it silently, so off server mode the plain name is the only option and
   * those two builds keep the cookie they have always had.
   */
  it("prefixes the name with __Host- on the hosted server and leaves it plain off it", async () => {
    const hosted = await signIn(harness());
    expect(cookieNamed(hosted.result, SESSION_COOKIE_SECURE)).toMatchObject({ secure: true, path: "/" });
    expect(SESSION_COOKIE_SECURE.startsWith("__Host-")).toBe(true);

    const local = await signIn(harness({ serverMode: false }));
    expect(cookieNamed(local.result, SESSION_COOKIE)).toMatchObject({ secure: false, path: "/" });
    expect(cookieNamed(local.result, SESSION_COOKIE_SECURE)).toBeUndefined();
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
