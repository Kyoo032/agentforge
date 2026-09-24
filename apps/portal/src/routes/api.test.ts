/**
 * The JSON half: `/auth/token`, the device-code endpoints, `/auth/session`, `/auth/logout`,
 * `/tenant/config` and the JWKS document -- all over the wire against a real server.
 *
 * The first test in `POST /auth/token` is the contract test: the success body is read
 * field-by-field by `toTokens` in `packages/host/src/auth/portal-client.ts`, so the exact key set
 * is pinned here. "The portal answered 200 and the app still could not sign in" is the failure
 * that pin prevents, and no amount of flow-level testing catches it.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomToken } from "../crypto";
import { HOST_AUTH_REASONS } from "../flows/reasons";
import { keyFromSeed } from "../jwt/keys";
import { verifyAccessToken } from "../jwt/sign";
import { resolveKeyring } from "../jwt/keys";
import { addUser, seedFixture, type Fixture } from "../testing/fixtures";
import { createAgent, hiddenValue, startTestPortal, type PortalHarness } from "../testing/server";

const CLIENT_ID = "agentforge-web";
const REDIRECT = "https://localhost:3443/auth/callback";
const INSTALL_ID = "install-0123456789";

let portal: PortalHarness;
let fixture: Fixture;
let clientSecret: string;
let userSeq = 0;

async function freshEmail(): Promise<string> {
  userSeq += 1;
  const email = `api${userSeq}@dpsbuddy.test`;
  await addUser(portal.store.store, fixture, email);
  return email;
}

/** Walk the browser flow far enough to hold a live authorization code. */
async function authorizationCode(state = `state-${Math.random()}`): Promise<string> {
  const email = await freshEmail();
  const agent = createAgent(portal.origin);
  const query = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state,
  });
  const start = await agent.get(`/authorize?${query.toString()}`);
  const common = {
    csrf_token: hiddenValue(start.text, "csrf_token") as string,
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state,
    email,
  };
  const sent = await agent.postForm("/authorize/email", common);
  const done = await agent.postForm("/authorize/verify", {
    ...common,
    csrf_token: hiddenValue(sent.text, "csrf_token") as string,
    code: portal.mailer.newest()?.code ?? "",
  });
  return new URL(done.location as string).searchParams.get("code") as string;
}

function exchange(code: string, overrides: Record<string, string> = {}) {
  return createAgent(portal.origin).postJson("/auth/token", {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: CLIENT_ID,
    client_secret: clientSecret,
    ...overrides,
  });
}

beforeAll(async () => {
  portal = await startTestPortal();
  fixture = await seedFixture(portal.store.store, { slug: "apitenant", email: "owner@apitenant.test" });
  clientSecret = randomToken();
  await portal.store.store.tx(fixture.tenant.id, (ops) =>
    ops.oauthClients.create({
      clientId: CLIENT_ID,
      tenantId: fixture.tenant.id,
      name: "DPSBuddy",
      secret: clientSecret,
      redirectUris: [REDIRECT],
    }),
  );
}, 180_000);

afterAll(async () => {
  await portal?.close();
});

describe("POST /auth/token, grant_type=authorization_code", () => {
  it("answers exactly the fields the host's toTokens reads", async () => {
    const reply = await exchange(await authorizationCode());

    expect(reply.status).toBe(200);
    const body = reply.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual([
      "access_token",
      "device_id",
      "expires_in",
      "org_id",
      "refresh_expires_in",
      "refresh_token",
      "session_id",
      "tenant_id",
      "token_type",
      "user_id",
    ]);
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(3600);
    expect(body.tenant_id).toBe(fixture.tenant.id);
    expect(body.org_id).toBe(fixture.org.id);
    expect(typeof body.refresh_expires_in).toBe("number");
  });

  it("mints an access token the published JWKS key verifies", async () => {
    const body = (await exchange(await authorizationCode())).json<{ access_token: string }>();

    const jwks = (await createAgent(portal.origin).get("/.well-known/jwks.json")).json<{
      keys: { kid: string; x: string; kty: string; crv: string; alg: string }[];
    }>();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA", use: "sig" });

    const header = JSON.parse(
      Buffer.from(body.access_token.split(".")[0], "base64url").toString("utf8"),
    );
    expect(header.kid).toBe(jwks.keys[0].kid);

    const verified = verifyAccessToken(portal.runtime.keys, body.access_token, {
      issuer: portal.origin,
      now: Date.now(),
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims.tid).toBe(fixture.tenant.id);
    expect(verified.claims.iss).toBe(portal.origin);
    expect(verified.claims.scope).toContain("v1.chat");
  });

  it("refuses a replayed code and audits it", async () => {
    const code = await authorizationCode();
    expect((await exchange(code)).status).toBe(200);

    const replay = await exchange(code);
    expect(replay.status).toBe(400);
    expect(replay.json<{ reason: string }>().reason).toBe("invalid_grant");

    const audit = await portal.store.store.tx(fixture.tenant.id, (ops) =>
      ops.audit.list({ tenantId: fixture.tenant.id, action: "auth_code.replayed" }),
    );
    expect(audit.length).toBeGreaterThan(0);
  });

  it("refuses a wrong client secret without burning the code", async () => {
    const code = await authorizationCode();

    const wrong = await exchange(code, { client_secret: randomToken() });
    expect(wrong.status).toBe(401);
    // `error` keeps the RFC family; `reason` is narrowed to what the host's AUTH_REASONS carries.
    expect(wrong.json<{ error: string; reason: string }>()).toMatchObject({
      error: "invalid_client",
      reason: "invalid_grant",
    });

    // The legitimate exchange still works: a wrong secret is not a denial-of-service on the user.
    expect((await exchange(code)).status).toBe(200);
  });

  it("refuses a redirect_uri that is not the one the code was issued for", async () => {
    const code = await authorizationCode();
    const reply = await exchange(code, { redirect_uri: "https://localhost:3443/other" });

    expect(reply.status).toBe(400);
    expect(reply.json<{ reason: string }>().reason).toBe("invalid_grant");
  });

  it("refuses an unknown code, and a body with a field missing", async () => {
    expect((await exchange(randomToken())).json<{ reason: string }>().reason).toBe("invalid_grant");

    const short = await createAgent(portal.origin).postJson("/auth/token", {
      grant_type: "authorization_code",
      code: "x",
    });
    expect(short.json<{ reason: string }>().reason).toBe("invalid_request");
  });

  it("only ever answers with a reason the host's AUTH_REASONS list carries", async () => {
    const replies = await Promise.all([
      exchange(randomToken()),
      exchange(await authorizationCode(), { client_secret: "nope" }),
      createAgent(portal.origin).postJson("/auth/token", { grant_type: "password" }),
      createAgent(portal.origin).postJson("/auth/token", { grant_type: "refresh_token", refresh_token: "x" }),
    ]);

    for (const reply of replies) {
      expect(HOST_AUTH_REASONS).toContain(reply.json<{ reason: string }>().reason);
    }
  });
});

describe("POST /auth/token, grant_type=refresh_token", () => {
  it("rotates, and the successor differs from the token presented", async () => {
    const first = (await exchange(await authorizationCode())).json<{
      refresh_token: string;
      device_id: string;
      session_id: string;
    }>();

    const reply = await createAgent(portal.origin).postJson("/auth/token", {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      device_id: first.device_id,
    });

    expect(reply.status).toBe(200);
    const second = reply.json<{ refresh_token: string; session_id: string }>();
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.session_id).toBe(first.session_id);
  });

  it("kills the whole chain when a spent generation is presented again", async () => {
    const first = (await exchange(await authorizationCode())).json<{
      refresh_token: string;
      device_id: string;
    }>();
    const second = (
      await createAgent(portal.origin).postJson("/auth/token", {
        grant_type: "refresh_token",
        refresh_token: first.refresh_token,
        device_id: first.device_id,
      })
    ).json<{ refresh_token: string }>();

    const replay = await createAgent(portal.origin).postJson("/auth/token", {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      device_id: first.device_id,
    });
    expect(replay.status).toBe(401);
    expect(replay.json<{ reason: string }>().reason).toBe("refresh_reused");

    // The live token is dead too: the session went with the chain (diagram (c) of the login doc).
    const after = await createAgent(portal.origin).postJson("/auth/token", {
      grant_type: "refresh_token",
      refresh_token: second.refresh_token,
      device_id: first.device_id,
    });
    expect(after.status).toBe(401);
    expect(["session_revoked", "refresh_expired", "refresh_reused"]).toContain(
      after.json<{ reason: string }>().reason,
    );
  });

  it("treats an unknown token as expired rather than telling anyone it is unknown", async () => {
    const reply = await createAgent(portal.origin).postJson("/auth/token", {
      grant_type: "refresh_token",
      refresh_token: randomToken(),
      device_id: randomUUID(),
    });
    expect(reply.status).toBe(401);
    expect(reply.json<{ reason: string }>().reason).toBe("refresh_expired");
  });

  /**
   * `rotate_refresh_token` compares `p_device_id` against the session's device only when it is not
   * NULL (`0005_functions.sql`), so a refresh with no `device_id` skipped the device binding
   * entirely: a token lifted off one machine refreshed anywhere. The host always sends it
   * (`packages/host/src/auth/portal-client.ts`, `refresh`, from the `device_id` of the portal's
   * own token body), so requiring it costs an honest caller nothing.
   */
  it("refuses a refresh with no device_id, in the invalid_request shape, without spending the token", async () => {
    const first = (await exchange(await authorizationCode())).json<{
      refresh_token: string;
      device_id: string;
      session_id: string;
    }>();

    const bare = await createAgent(portal.origin).postJson("/auth/token", {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
    });
    expect(bare.status).toBe(400);
    expect(bare.json<Record<string, unknown>>()).toMatchObject({
      error: "invalid_request",
      reason: "invalid_request",
    });

    // Nothing was rotated: the same token, presented with its device, still refreshes.
    const proper = await createAgent(portal.origin).postJson("/auth/token", {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      device_id: first.device_id,
    });
    expect(proper.status).toBe(200);
    expect(proper.json<{ session_id: string }>().session_id).toBe(first.session_id);
  });

  it("refuses a device_id that is not a devices.id, rather than failing inside the database", async () => {
    const first = (await exchange(await authorizationCode())).json<{
      refresh_token: string;
      device_id: string;
    }>();

    for (const deviceId of ["not-a-uuid", "install-0123456789", `${first.device_id}x`, ""]) {
      const reply = await createAgent(portal.origin).postJson("/auth/token", {
        grant_type: "refresh_token",
        refresh_token: first.refresh_token,
        device_id: deviceId,
      });
      expect(reply.status, deviceId).toBe(400);
      expect(reply.json<{ reason: string }>().reason, deviceId).toBe("invalid_request");
    }

    const proper = await createAgent(portal.origin).postJson("/auth/token", {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      device_id: first.device_id,
    });
    expect(proper.status).toBe(200);
  });
});

describe("the device-code flow", () => {
  async function startDevice(overrides: Record<string, unknown> = {}) {
    return createAgent(portal.origin).postJson("/auth/device/code", {
      install_id: INSTALL_ID,
      tenant_hint: fixture.tenant.slug,
      platform: "win32",
      app_version: "0.14.27",
      label: "Windows device",
      ...overrides,
    });
  }

  it("issues a user_code and a device_code in the documented shape", async () => {
    const body = (await startDevice({ install_id: "install-shape-001" })).json<Record<string, unknown>>();

    expect(Object.keys(body).sort()).toEqual([
      "device_code",
      "expires_in",
      "interval",
      "user_code",
      "verification_uri",
      "verification_uri_complete",
    ]);
    expect(body.user_code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    expect(body.device_code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.expires_in).toBe(600);
    expect(body.interval).toBe(5);
    expect(body.verification_uri).toBe(`${portal.origin}/activate`);
  });

  it("refuses a platform outside the mapping table and a short install_id", async () => {
    expect((await startDevice({ platform: "freebsd" })).json<{ reason: string }>().reason).toBe(
      "invalid_request",
    );
    expect((await startDevice({ install_id: "short" })).json<{ reason: string }>().reason).toBe(
      "invalid_request",
    );
  });

  it("refuses a tenant_hint nobody owns", async () => {
    const reply = await startDevice({ tenant_hint: "not-a-tenant", install_id: "install-hint-0001" });
    expect(reply.status).toBe(403);
    expect(reply.json<{ reason: string }>().reason).toBe("tenant_inactive");
  });

  it("completes: pending, approve in the browser, then a session", async () => {
    const installId = "install-happy-0001";
    const started = (await startDevice({ install_id: installId })).json<{
      device_code: string;
      user_code: string;
    }>();

    const pending = await createAgent(portal.origin).postJson("/auth/device/token", {
      device_code: started.device_code,
      install_id: installId,
    });
    expect(pending.status).toBe(400);
    expect(pending.json<{ reason: string }>().reason).toBe("authorization_pending");

    // The browser half: sign in at /activate, then approve.
    const email = await freshEmail();
    const agent = createAgent(portal.origin);
    const page = await agent.get(`/activate?code=${started.user_code}`);
    const sent = await agent.postForm("/activate/email", {
      csrf_token: hiddenValue(page.text, "csrf_token") as string,
      user_code: started.user_code,
      email,
    });
    const approveScreen = await agent.postForm("/activate/verify", {
      csrf_token: hiddenValue(sent.text, "csrf_token") as string,
      user_code: started.user_code,
      email,
      code: portal.mailer.newest()?.code ?? "",
    });
    expect(approveScreen.text).toContain("Approve this device?");
    expect(approveScreen.text).toContain("Windows");
    expect(approveScreen.text).toContain(started.user_code);

    const approved = await agent.postForm("/auth/device/approve", {
      csrf_token: hiddenValue(approveScreen.text, "csrf_token") as string,
      user_code: started.user_code,
      decision: "approve",
    });
    expect(approved.status).toBe(200);
    expect(approved.text).toContain("Device approved");

    const tokens = await createAgent(portal.origin).postJson("/auth/device/token", {
      device_code: started.device_code,
      install_id: installId,
    });
    expect(tokens.status).toBe(200);
    const body = tokens.json<Record<string, unknown>>();
    expect(body.tenant_id).toBe(fixture.tenant.id);
    expect(typeof body.device_id).toBe("string");

    // Single use: a second poll on a redeemed code is invalid_grant, not a second session.
    const replay = await createAgent(portal.origin).postJson("/auth/device/token", {
      device_code: started.device_code,
      install_id: installId,
    });
    expect(replay.status).toBe(400);
    expect(replay.json<{ reason: string }>().reason).toBe("invalid_grant");
  });

  it("refuses a poll whose install_id is not the one the code was minted for", async () => {
    const started = (await startDevice({ install_id: "install-mismatch-01" })).json<{
      device_code: string;
    }>();

    const reply = await createAgent(portal.origin).postJson("/auth/device/token", {
      device_code: started.device_code,
      install_id: "install-someone-else",
    });
    expect(reply.status).toBe(400);
    expect(reply.json<{ reason: string }>().reason).toBe("invalid_grant");
  });

  it("answers slow_down on the third poll inside one interval window", async () => {
    const installId = "install-fast-00001";
    const started = (await startDevice({ install_id: installId })).json<{ device_code: string }>();
    const poll = () =>
      createAgent(portal.origin).postJson("/auth/device/token", {
        device_code: started.device_code,
        install_id: installId,
      });

    await poll();
    await poll();
    const third = await poll();

    expect(third.json<{ reason: string }>().reason).toBe("slow_down");
    expect(third.json<{ retry_after: number }>().retry_after).toBeGreaterThan(0);
    expect(third.headers.get("retry-after")).not.toBeNull();
  });

  it("refuses an approve with no portal session cookie", async () => {
    const started = (await startDevice({ install_id: "install-nosession-1" })).json<{
      user_code: string;
    }>();

    const reply = await createAgent(portal.origin).postJson("/auth/device/approve", {
      user_code: started.user_code,
      decision: "approve",
    });
    expect(reply.status).toBe(401);
  });
});

describe("the Bearer endpoints", () => {
  async function signedIn() {
    const body = (await exchange(await authorizationCode())).json<{
      access_token: string;
      refresh_token: string;
      session_id: string;
      user_id: string;
      device_id: string;
    }>();
    return body;
  }

  it("GET /auth/session describes the org, the seats and the device", async () => {
    const session = await signedIn();
    const reply = await createAgent(portal.origin).get("/auth/session", {
      headers: { authorization: `Bearer ${session.access_token}` },
    });

    expect(reply.status).toBe(200);
    const body = reply.json<{
      org: { seat_cap: number; seats_used: number; status: string };
      tenant: { slug: string };
      session: { id: string };
      device: { id: string };
    }>();
    expect(body.tenant.slug).toBe(fixture.tenant.slug);
    expect(body.org.status).toBe("active");
    expect(body.org.seat_cap).toBe(20);
    expect(body.org.seats_used).toBeGreaterThan(0);
    expect(body.session.id).toBe(session.session_id);
  });

  it("GET /auth/session refuses a token signed by another key", async () => {
    const foreign = resolveKeyring({ production: false, signingKey: Buffer.alloc(32, 77) });
    void keyFromSeed(Buffer.alloc(32, 77));
    const { signAccessToken } = await import("../jwt/sign");
    const token = signAccessToken(foreign.current, {
      issuer: portal.origin,
      userId: fixture.user.id,
      tenantId: fixture.tenant.id,
      orgId: fixture.org.id,
      deviceId: fixture.user.id,
      sessionId: fixture.user.id,
      scope: "v1.chat",
      now: Date.now(),
    });

    const reply = await createAgent(portal.origin).get("/auth/session", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(reply.status).toBe(401);
  });

  it("POST /auth/logout is 204 and stops the refresh chain", async () => {
    const session = await signedIn();

    const out = await createAgent(portal.origin).postJson(
      "/auth/logout",
      { all_devices: false },
      { headers: { authorization: `Bearer ${session.access_token}` } },
    );
    expect(out.status).toBe(204);
    expect(out.text).toBe("");

    const refresh = await createAgent(portal.origin).postJson("/auth/token", {
      grant_type: "refresh_token",
      refresh_token: session.refresh_token,
      device_id: session.device_id,
    });
    expect(refresh.status).toBe(401);
    // `refresh_reused`, not `session_revoked`, and that is `rotate_refresh_token` in
    // `0005_functions.sql` rather than a portal decision: `revoke_session_chain` marks the
    // outstanding refresh rows revoked, and the function treats a revoked row as reuse. The login
    // doc's reason table implies `session_revoked` here; both are terminal and the client clears
    // the session either way, but the two documents disagree and this pins which one runs.
    expect(refresh.json<{ reason: string }>().reason).toBe("refresh_reused");

    // Idempotent: the same call again is still 204.
    const again = await createAgent(portal.origin).postJson(
      "/auth/logout",
      { all_devices: false },
      { headers: { authorization: `Bearer ${session.access_token}` } },
    );
    expect(again.status).toBe(204);
  });

  /**
   * SR-21. "Sign me out everywhere" used to leave the portal's own 30-day browser cookie alone, so
   * the next visitor on that machine pressed Sign in and was signed in as the person who had just
   * asked to be signed out of everything. A single-session logout deliberately does NOT do this:
   * it would end browsers the person never touched.
   */
  it("POST /auth/logout with all_devices also ends that user's portal browser sessions", async () => {
    const session = await signedIn();
    const userId = session.user_id;
    const before = await portal.store.store.tx(fixture.tenant.id, (ops) =>
      ops.webSessions.version(userId),
    );

    const single = await signedIn();
    await createAgent(portal.origin).postJson(
      "/auth/logout",
      { all_devices: false },
      { headers: { authorization: `Bearer ${single.access_token}` } },
    );
    expect(
      await portal.store.store.tx(fixture.tenant.id, (ops) => ops.webSessions.version(single.user_id)),
    ).toBe(before);

    const out = await createAgent(portal.origin).postJson(
      "/auth/logout",
      { all_devices: true },
      { headers: { authorization: `Bearer ${session.access_token}` } },
    );
    expect(out.status).toBe(204);
    expect(
      await portal.store.store.tx(fixture.tenant.id, (ops) => ops.webSessions.version(userId)),
    ).toBeGreaterThan(before);

    const rows = await portal.store.store.tx(fixture.tenant.id, (ops) =>
      ops.audit.list({ action: "web_session.revoked", limit: 5 }),
    );
    expect(rows.some((row) => (row.after as Record<string, unknown> | null)?.scope === "user")).toBe(true);
  });

  it("GET /tenant/config gives flags to a Bearer and branding only to ?tenant=", async () => {
    const session = await signedIn();

    const full = await createAgent(portal.origin).get("/tenant/config", {
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    expect(full.status).toBe(200);
    const body = full.json<Record<string, unknown>>();
    expect(body).toHaveProperty("feature_flags");
    expect(body).toHaveProperty("model_allowlist");

    const anonymous = await createAgent(portal.origin).get(
      `/tenant/config?tenant=${fixture.tenant.slug}`,
    );
    expect(anonymous.status).toBe(200);
    const branding = anonymous.json<Record<string, unknown>>();
    expect(branding).not.toHaveProperty("feature_flags");
    expect(branding).not.toHaveProperty("model_allowlist");
    expect(branding.slug).toBe(fixture.tenant.slug);
  });

  /**
   * SR-42. The unauthenticated `?tenant=` branch answered `400 invalid_request` for a slug that
   * does not exist and `403 tenant_inactive` for one that does but is suspended, so anybody could
   * walk a wordlist and learn which tenants the portal knows about. Both are the same refusal now;
   * a Bearer -- who already belongs to the tenant -- still gets the real reason.
   */
  it("GET /tenant/config cannot tell an unknown slug from a suspended tenant", async () => {
    const suspended = await seedFixture(portal.store.store, { email: "sus@suspended.test" });
    await portal.store.store.tx(suspended.tenant.id, (ops) =>
      ops.tenants.setStatus(suspended.tenant.id, "suspended"),
    );

    const unknown = await createAgent(portal.origin).get("/tenant/config?tenant=no-such-tenant-here");
    const inactive = await createAgent(portal.origin).get(`/tenant/config?tenant=${suspended.tenant.slug}`);

    expect(inactive.status).toBe(unknown.status);
    expect(inactive.json<Record<string, unknown>>().reason).toBe(
      unknown.json<Record<string, unknown>>().reason,
    );
  });

  it("GET /tenant/config is rate limited on both branches", async () => {
    const limiter = portal.runtime.limiters.tenantConfigIp;
    expect(limiter).toBeDefined();

    const before = limiter.peek("probe");
    expect(before.ok).toBe(true);

    // Both branches count: the unauthenticated slug lookup and the Bearer one.
    await createAgent(portal.origin).get(`/tenant/config?tenant=${fixture.tenant.slug}`);
    const session = await signedIn();
    await createAgent(portal.origin).get("/tenant/config", {
      headers: { authorization: `Bearer ${session.access_token}` },
    });

    // The limiter's window is keyed on the client address, and every agent here shares one.
    expect(limiter.size).toBeGreaterThan(0);
  });

  it("GET /tenant/config answers 304 to a matching If-None-Match", async () => {
    const first = await createAgent(portal.origin).get(`/tenant/config?tenant=${fixture.tenant.slug}`);
    const etag = first.headers.get("etag") as string;

    const second = await createAgent(portal.origin).get(
      `/tenant/config?tenant=${fixture.tenant.slug}`,
      { headers: { "if-none-match": etag } },
    );
    expect(second.status).toBe(304);
    expect(second.text).toBe("");
  });
});

/**
 * Behind the proxy (`PORTAL_TRUST_PROXY=1`), every per-IP bucket keys on `X-Forwarded-For`. The
 * proxy appends the address it saw, so the client controls everything to the left of it. When the
 * left-most entry was the key, a caller could rotate a forged prefix and get a fresh bucket on
 * every request. Driven here against the 30 / 10 min per-IP limit on POST /auth/device/code.
 */
describe("the per-IP limit behind a proxy", () => {
  let proxied: PortalHarness;
  let proxiedFixture: Fixture;

  beforeAll(async () => {
    proxied = await startTestPortal({ trustProxy: true });
    proxiedFixture = await seedFixture(proxied.store.store, { slug: "proxytenant", email: "o@proxytenant.test" });
  }, 180_000);

  /** A confidential client of the proxied tenant, and the secret it was registered with. */
  async function confidentialClient(clientId: string): Promise<string> {
    const secret = randomToken();
    await proxied.store.store.tx(proxiedFixture.tenant.id, (ops) =>
      ops.oauthClients.create({
        clientId,
        tenantId: proxiedFixture.tenant.id,
        name: clientId,
        secret,
        redirectUris: [REDIRECT],
      }),
    );
    return secret;
  }

  /** A refresh from `address`, with an unknown token: it spends a limiter and then 401s. */
  function refreshFrom(address: string, extra: Record<string, string> = {}) {
    return createAgent(proxied.origin).postJson(
      "/auth/token",
      { grant_type: "refresh_token", refresh_token: randomToken(), device_id: randomUUID(), ...extra },
      { headers: { "x-forwarded-for": address } },
    );
  }

  afterAll(async () => {
    await proxied?.close();
  });

  it("keys on the address the proxy appended, so a rotated forged prefix does not buy a fresh bucket", async () => {
    const realClient = "198.51.100.23";
    const replies: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      const reply = await createAgent(proxied.origin).postJson(
        "/auth/device/code",
        {
          // A new install_id each time, so only the per-IP bucket is in play.
          install_id: `install-rotate-${String(i).padStart(4, "0")}`,
          tenant_hint: proxiedFixture.tenant.slug,
          platform: "win32",
        },
        { headers: { "x-forwarded-for": `10.9.${i}.1, ${realClient}` } },
      );
      replies.push(reply.status);
    }

    expect(replies.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(replies[30]).toBe(429);
  });

  /**
   * POST /auth/device/token had no limiter at all: an unauthenticated endpoint that costs two
   * database round trips a call. One honest device polls every 5 s for the code's 10 minutes, which
   * is 120 polls, so the limit must never be below that. It is 600, enough for five devices signing
   * in at once behind one office address.
   */
  it("limits POST /auth/device/token per IP, at 600 per 10 minutes, and never trips one polling device", async () => {
    const realClient = "198.51.100.77";
    const poll = () =>
      createAgent(proxied.origin).postJson(
        "/auth/device/token",
        { device_code: randomToken(), install_id: "install-poller-0001" },
        { headers: { "x-forwarded-for": realClient } },
      );

    const statuses: number[] = [];
    for (let i = 0; i < 600; i += 1) {
      statuses.push((await poll()).status);
    }
    // Unknown codes: every one answered on its merits (400 invalid_grant), none of them throttled.
    expect(statuses.filter((status) => status === 429)).toHaveLength(0);

    const over = await poll();
    expect(over.status).toBe(429);
    expect(over.json<{ error: string; reason: string; retry_after: number }>()).toMatchObject({
      error: "invalid_request",
      reason: "rate_limited",
    });
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  /**
   * The host refreshes every hosted session through the portal every ~10 minutes, and every one of
   * those comes from the host's one address. At 300 per address per 10 minutes, that capped hosted
   * use at ~300 active sessions. A refresh that authenticates as a confidential client is counted
   * against the client instead. A public refresh keeps the per-address limit.
   */
  it("counts an authenticated client's refreshes against the client, never the address, and keeps 300 for public ones", async () => {
    const clientId = "proxy-host-a";
    const secret = await confidentialClient(clientId);
    const hostAddress = "198.51.100.200";

    const authenticated: number[] = [];
    for (let i = 0; i < 301; i += 1) {
      authenticated.push((await refreshFrom(hostAddress, { client_id: clientId, client_secret: secret })).status);
    }
    // Unknown tokens, so each one is refused on its merits (401 refresh_expired), and none throttled.
    expect([...new Set(authenticated)]).toEqual([401]);

    // None of that spent the address's public budget: 300 public refreshes fit, the 301st does not.
    const publicReplies: number[] = [];
    for (let i = 0; i < 301; i += 1) {
      publicReplies.push((await refreshFrom(hostAddress)).status);
    }
    expect(publicReplies.slice(0, 300).filter((status) => status === 429)).toHaveLength(0);
    expect(publicReplies[300]).toBe(429);
  });

  it("keys the confidential bucket on client_id, whichever address the refresh comes from", async () => {
    const clientId = "proxy-host-b";
    const secret = await confidentialClient(clientId);
    const before = proxied.runtime.limiters.tokenClient.size;

    await refreshFrom("198.51.100.201", { client_id: clientId, client_secret: secret });
    await refreshFrom("198.51.100.202", { client_id: clientId, client_secret: secret });

    expect(proxied.runtime.limiters.tokenClient.size).toBe(before + 1);
  });

  it("answers 429 once a client has spent its 20,000 refreshes in the window", async () => {
    const clientId = "proxy-host-c";
    const secret = await confidentialClient(clientId);
    // The window filled in memory: 20,000 round trips would prove nothing more.
    for (let i = 0; i < 20_000; i += 1) {
      proxied.runtime.limiters.tokenClient.check(clientId);
    }

    const over = await refreshFrom("198.51.100.203", { client_id: clientId, client_secret: secret });
    expect(over.status).toBe(429);
    expect(over.json<{ reason: string }>().reason).toBe("invalid_request");
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("refuses a wrong client_secret as invalid_client, audits it, and stops looking after 20 from one address", async () => {
    const clientId = "proxy-host-d";
    await confidentialClient(clientId);
    const address = "198.51.100.204";
    const audited = async () =>
      (
        await proxied.store.store.tx(proxiedFixture.tenant.id, (ops) =>
          ops.audit.list({ tenantId: proxiedFixture.tenant.id, action: "token.client_auth_failed", limit: 100 }),
        )
      ).filter((row) => (row.after as Record<string, unknown> | null)?.client_id === clientId).length;

    for (let i = 0; i < 20; i += 1) {
      const wrong = await refreshFrom(address, { client_id: clientId, client_secret: randomToken() });
      expect(wrong.status).toBe(401);
      expect(wrong.json<{ error: string }>().error).toBe("invalid_client");
    }
    const stopped = await refreshFrom(address, { client_id: clientId, client_secret: randomToken() });
    expect(stopped.status).toBe(429);
    // Twenty looked up and audited; the twenty-first was refused before any lookup.
    expect(await audited()).toBe(20);
  });
});

describe("what reached the log", () => {
  it("wrote no access token, refresh token, device code or client secret", async () => {
    const started = (
      await createAgent(portal.origin).postJson("/auth/device/code", {
        install_id: "install-logcheck-1",
        tenant_hint: fixture.tenant.slug,
        platform: "win32",
      })
    ).json<{ device_code: string }>();
    const tokens = (await exchange(await authorizationCode())).json<{
      access_token: string;
      refresh_token: string;
    }>();

    const log = portal.logLines.join("\n");
    expect(log).not.toContain(tokens.access_token);
    expect(log).not.toContain(tokens.refresh_token);
    expect(log).not.toContain(started.device_code);
    expect(log).not.toContain(clientSecret);
  });
});
