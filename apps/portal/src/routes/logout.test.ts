/**
 * `GET /logout` and `POST /logout`, driven over the wire — the way out of the portal's own 30-day
 * browser session (SR-21).
 *
 * The bug these pin, observed on the review instance before the route existed: with the portal
 * cookie live, `GET /authorize` answered `302 …?code&state` with no address, no code and no mail,
 * and nothing anywhere could end that cookie. On a shared browser the next person to press
 * "Sign in" was signed in as the one who had just left.
 *
 * Its own file rather than another block in `browser.test.ts` for a reason that is about the
 * subject, not tidiness: every full sign-in spends one hit of the 30-per-15-minutes per-IP OTP
 * send limit, the whole suite shares `127.0.0.1`, and a file that pushed `browser.test.ts` over
 * that ceiling would fail *it* — a real limit reported as somebody else's broken test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomToken } from "../crypto";
import { addUser, seedFixture, type Fixture } from "../testing/fixtures";
import {
  createAgent,
  hiddenValue,
  startTestPortal,
  type Agent,
  type PortalHarness,
} from "../testing/server";

const CLIENT_ID = "agentforge-web";
const REDIRECT = "https://localhost:3443/auth/callback";
const SIGN_IN = "https://localhost:3443/sign-in";

let portal: PortalHarness;
let fixture: Fixture;
let userSeq = 0;

function authorizeUrl(state: string): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state,
  });
  return `/authorize?${query.toString()}`;
}

function logoutUrl(clientId: string, target: string): string {
  return `/logout?client_id=${encodeURIComponent(clientId)}&post_logout_redirect_uri=${encodeURIComponent(target)}`;
}

async function freshEmail(): Promise<string> {
  userSeq += 1;
  const email = `out${userSeq}@dpsbuddy.test`;
  await addUser(portal.store.store, fixture, email);
  return email;
}

/** The three hops, for real, ending with the portal session cookie in the jar. */
async function signedInAgent(state: string): Promise<{ agent: Agent; email: string }> {
  const email = await freshEmail();
  const agent = createAgent(portal.origin);

  const start = await agent.get(authorizeUrl(state));
  const common = {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state,
    email,
  };
  const sent = await agent.postForm("/authorize/email", {
    ...common,
    csrf_token: hiddenValue(start.text, "csrf_token") as string,
  });
  const done = await agent.postForm("/authorize/verify", {
    ...common,
    csrf_token: hiddenValue(sent.text, "csrf_token") as string,
    code: portal.mailer.newest()?.code ?? "",
  });

  expect(done.status).toBe(302);
  expect(agent.cookies.has("portal_session")).toBe(true);
  return { agent, email };
}

beforeAll(async () => {
  portal = await startTestPortal();
  fixture = await seedFixture(portal.store.store, { slug: "dpsbuddy", email: "owner@dpsbuddy.test" });
  await portal.store.store.tx(fixture.tenant.id, (ops) =>
    ops.oauthClients.create({
      clientId: CLIENT_ID,
      tenantId: fixture.tenant.id,
      name: "DPSBuddy",
      secret: randomToken(),
      redirectUris: [REDIRECT],
    }),
  );
}, 180_000);

afterAll(async () => {
  await portal?.close();
});

beforeEach(() => {
  portal.mailer.clear();
});

describe("the portal's browser session, and the way out of it", () => {
  it("signs a returning browser straight back in -- the convenience being bounded", async () => {
    const { agent } = await signedInAgent("state-out-1");
    const again = await agent.get(authorizeUrl("state-out-1b"));
    expect(again.status).toBe(302);
    expect(new URL(again.location as string).searchParams.get("code")).toBeTruthy();
  });

  it("GET /logout clears the cookie, and the next /authorize asks for the e-mail again", async () => {
    const { agent } = await signedInAgent("state-out-2");

    const out = await agent.get("/logout");
    expect(out.status).toBe(200);
    expect(out.text).toContain("Signed out");
    expect(agent.cookies.has("portal_session")).toBe(false);

    const again = await agent.get(authorizeUrl("state-out-2b"));
    expect(again.status).toBe(200);
    expect(again.location).toBeNull();
    expect(again.text).toContain("Sign in");
    expect(hiddenValue(again.text, "state")).toBe("state-out-2b");
  });

  it("redirects back to a URI on the client's registered origin", async () => {
    const { agent } = await signedInAgent("state-out-3");
    const out = await agent.get(logoutUrl(CLIENT_ID, SIGN_IN));
    expect(out.status).toBe(302);
    expect(out.location).toBe(SIGN_IN);
    expect(agent.cookies.has("portal_session")).toBe(false);
  });

  /**
   * No sign-in needed for these: the claim is about where the route is willing to send a browser,
   * and it answers the same whether or not a session was there. Keeping them session-free also
   * keeps the file inside the per-IP OTP budget.
   */
  it("renders the neutral page rather than following a URI off that origin", async () => {
    for (const target of [
      "https://evil.test/collect",
      // Same host, another port: a different origin, and `URL.origin` is what says so.
      "https://localhost:3444/sign-in",
      // Same host and port, another scheme.
      "http://localhost:3443/sign-in",
      // A registered origin's host as a prefix of somebody else's.
      "https://localhost:3443.evil.test/sign-in",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      // Protocol-relative: `new URL` refuses it outright, which is the point.
      "//evil.test/sign-in",
    ]) {
      const out = await createAgent(portal.origin).get(logoutUrl(CLIENT_ID, target));
      expect(out.status, target).toBe(200);
      expect(out.location, target).toBeNull();
      expect(out.text, target).toContain("Signed out");
    }
  });

  it("refuses an unknown or revoked client rather than trusting the URI on its own", async () => {
    const unknown = await createAgent(portal.origin).get(logoutUrl("not-a-client", SIGN_IN));
    expect(unknown.status).toBe(200);
    expect(unknown.location).toBeNull();

    const noClient = await createAgent(portal.origin).get(
      `/logout?post_logout_redirect_uri=${encodeURIComponent(SIGN_IN)}`,
    );
    expect(noClient.status).toBe(200);
    expect(noClient.location).toBeNull();
  });

  it("clears the cookie on every answer, including the one it refuses", async () => {
    const { agent } = await signedInAgent("state-out-4");
    const refused = await agent.postForm("/logout", { csrf_token: "not-the-token" });
    expect(refused.status).toBe(403);
    expect(agent.cookies.has("portal_session")).toBe(false);
  });

  it("POST /logout takes the CSRF token the browser already holds", async () => {
    const agent = createAgent(portal.origin);
    // A signed-out browser gets the form, and with it the CSRF cookie.
    const start = await agent.get(authorizeUrl("state-out-5"));
    expect(start.status).toBe(200);

    const accepted = await agent.postForm("/logout", {
      csrf_token: hiddenValue(start.text, "csrf_token") as string,
      client_id: CLIENT_ID,
      post_logout_redirect_uri: SIGN_IN,
    });
    expect(accepted.status).toBe(302);
    expect(accepted.location).toBe(SIGN_IN);
  });

  it("carries the page security headers on the signed-out page", async () => {
    const out = await createAgent(portal.origin).get("/logout");
    expect(out.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(out.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(out.headers.get("x-frame-options")).toBe("DENY");
    expect(out.headers.get("cache-control")).toContain("no-store");
  });

  it("audits web_session.revoked with the blast radius it had", async () => {
    const { agent } = await signedInAgent("state-out-6");
    await agent.get("/logout");

    const rows = await portal.store.store.tx(fixture.tenant.id, (ops) =>
      ops.audit.list({ action: "web_session.revoked", limit: 10 }),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect((rows[0].after as Record<string, unknown> | null)?.scope).toBe("browser");
  });

  /**
   * The server-side half. The cookie is untouched in the jar and its HMAC still verifies; what
   * stops it is that `web_session_versions` moved on, which is what makes "revoke takes effect on
   * the next request" true rather than "on the next thirty days".
   */
  it("ends a live cookie when the user's web sessions are revoked server-side", async () => {
    const { agent, email } = await signedInAgent("state-out-7");

    const user = await portal.store.store.tx(fixture.tenant.id, (ops) =>
      ops.users.findByEmail(fixture.tenant.id, email),
    );
    await portal.store.store.tx(fixture.tenant.id, (ops) =>
      ops.webSessions.revoke({ userId: (user as { id: string }).id, tenantId: fixture.tenant.id }),
    );

    expect(agent.cookies.has("portal_session")).toBe(true);
    const again = await agent.get(authorizeUrl("state-out-7b"));
    expect(again.status).toBe(200);
    expect(again.location).toBeNull();
    expect(again.text).toContain("Sign in");
  });

  it("wrote no session cookie to any log line", async () => {
    const { agent } = await signedInAgent("state-out-8");
    const cookie = agent.cookies.get("portal_session") as string;
    await agent.get("/logout");
    expect(portal.logLines.join("\n")).not.toContain(cookie.split(".")[0]);
  });
});
