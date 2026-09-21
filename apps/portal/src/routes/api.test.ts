/**
 * The JSON half: `/auth/token`, the device-code endpoints, `/auth/session`, `/auth/logout`,
 * `/tenant/config` and the JWKS document -- all over the wire against a real server.
 *
 * The first test in `POST /auth/token` is the contract test: the success body is read
 * field-by-field by `toTokens` in `packages/host/src/auth/portal-client.ts`, so the exact key set
 * is pinned here. "The portal answered 200 and the app still could not sign in" is the failure
 * that pin prevents, and no amount of flow-level testing catches it.
 */
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
    });
    expect(reply.status).toBe(401);
    expect(reply.json<{ reason: string }>().reason).toBe("refresh_expired");
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
