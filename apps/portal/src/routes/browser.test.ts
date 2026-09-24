/**
 * The browser login, driven against a real server on an ephemeral port.
 *
 * Every test here walks the same three hops a person walks -- `GET /authorize`, post an e-mail,
 * post a code -- and then asserts what came back on the wire. Nothing reaches into a flow
 * function: the claim being made is "a browser can sign in and the host can redeem the code", and
 * only the wire can support it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomToken } from "../crypto";
import { addUser, seedFixture, type Fixture } from "../testing/fixtures";
import { fixedClock } from "../testing/pg";
import {
  createAgent,
  hiddenValue,
  startTestPortal,
  type Agent,
  type PortalHarness,
} from "../testing/server";

const CLIENT_ID = "agentforge-web";
const REDIRECT = "https://localhost:3443/auth/callback";
const OTHER_REDIRECT = "https://evil.test/collect";

let portal: PortalHarness;
let fixture: Fixture;
let clientSecret: string;

async function registerClient(tenantId: string): Promise<string> {
  const secret = randomToken();
  await portal.store.store.tx(tenantId, (ops) =>
    ops.oauthClients.create({
      clientId: CLIENT_ID,
      tenantId,
      name: "DPSBuddy",
      secret,
      redirectUris: [REDIRECT],
    }),
  );
  return secret;
}

function authorizeUrl(state: string, overrides: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state,
    ...overrides,
  });
  return `/authorize?${query.toString()}`;
}

/**
 * A user nobody else has spent a send budget on.
 *
 * The OTP limit is 3 sends per 15 minutes **per address**, counted from the `login_otps` rows, so
 * two tests sharing an address would make the second one's failures depend on the first one's
 * count. A fresh address per test keeps each one a statement about its own behaviour.
 */
let userSeq = 0;
async function freshEmail(): Promise<string> {
  userSeq += 1;
  const email = `user${userSeq}@dpsbuddy.test`;
  await addUser(portal.store.store, fixture, email);
  return email;
}

/** e-mail form -> code form. Returns the page the code form rendered onto. */
async function signIn(
  agent: Agent,
  state: string,
  email: string,
): Promise<{ readonly page: string; readonly code: string }> {
  const start = await agent.get(authorizeUrl(state));
  const csrf = hiddenValue(start.text, "csrf_token") as string;

  const sent = await agent.postForm("/authorize/email", {
    csrf_token: csrf,
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state,
    email,
  });
  return { page: sent.text, code: portal.mailer.newest()?.code ?? "" };
}

async function submitCode(agent: Agent, page: string, state: string, code: string, email: string) {
  return agent.postForm("/authorize/verify", {
    csrf_token: hiddenValue(page, "csrf_token") as string,
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    state,
    email,
    code,
  });
}

beforeAll(async () => {
  portal = await startTestPortal();
  fixture = await seedFixture(portal.store.store, { slug: "dpsbuddy", email: "owner@dpsbuddy.test" });
  clientSecret = await registerClient(fixture.tenant.id);
}, 180_000);

afterAll(async () => {
  await portal?.close();
});

beforeEach(() => {
  portal.mailer.clear();
});

describe("GET /authorize", () => {
  it("renders the sign-in form and sets a CSRF cookie", async () => {
    const agent = createAgent(portal.origin);
    const reply = await agent.get(authorizeUrl("state-1"));

    expect(reply.status).toBe(200);
    expect(reply.headers.get("content-type")).toContain("text/html");
    expect(reply.text).toContain("Sign in");
    expect(hiddenValue(reply.text, "state")).toBe("state-1");
    expect(agent.cookies.has("portal_csrf")).toBe(true);
  });

  it("carries the page security headers on every HTML answer", async () => {
    const reply = await createAgent(portal.origin).get(authorizeUrl("state-h"));

    expect(reply.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(reply.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(reply.headers.get("x-frame-options")).toBe("DENY");
    expect(reply.headers.get("referrer-policy")).toBe("no-referrer");
    expect(reply.headers.get("cache-control")).toContain("no-store");
  });

  /**
   * The real-browser bug: with `form-action 'self'` on the code page, Chromium blocked the verify
   * submission outright, because it enforces `form-action` across the redirect chain and the
   * successful verify answers `302 Location: <client redirect_uri>` on another origin. Every hop
   * of the flow is asserted here, and the error pages are asserted NOT to carry the origin.
   */
  it("names the client's origin in form-action on an authorize page, and only there", async () => {
    const agent = createAgent(portal.origin);
    const clientOrigin = new URL(REDIRECT).origin;

    const start = await agent.get(authorizeUrl("state-csp"));
    expect(start.headers.get("content-security-policy")).toContain(
      `form-action 'self' ${clientOrigin};`,
    );

    const email = await freshEmail();
    const sent = await agent.postForm("/authorize/email", {
      csrf_token: hiddenValue(start.text, "csrf_token") as string,
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state: "state-csp",
      email,
    });
    expect(sent.headers.get("content-security-policy")).toContain(
      `form-action 'self' ${clientOrigin};`,
    );

    // A wrong code re-renders the same form, so that page needs the same policy or the retry is
    // the blocked submission all over again.
    const retry = await submitCode(agent, sent.text, "state-csp", "000000", email);
    expect(retry.status).toBe(400);
    expect(retry.headers.get("content-security-policy")).toContain(
      `form-action 'self' ${clientOrigin};`,
    );
  });

  it("keeps form-action at 'self' on a page rendered before the client was validated", async () => {
    const unknownClient = await createAgent(portal.origin).get(
      authorizeUrl("state-csp-2", { client_id: "not-a-client" }),
    );
    expect(unknownClient.status).toBe(400);
    expect(unknownClient.headers.get("content-security-policy")).toContain("form-action 'self';");

    const badRedirect = await createAgent(portal.origin).get(
      authorizeUrl("state-csp-3", { redirect_uri: OTHER_REDIRECT }),
    );
    expect(badRedirect.status).toBe(400);
    expect(badRedirect.headers.get("content-security-policy")).toContain("form-action 'self';");
    expect(badRedirect.headers.get("content-security-policy")).not.toContain("evil.test");
  });

  it("answers in Indonesian when the browser asks for it", async () => {
    const reply = await createAgent(portal.origin).get(authorizeUrl("state-id"), {
      headers: { "accept-language": "id-ID,id;q=0.9" },
    });
    expect(reply.text).toContain("Masuk");
    expect(reply.text).toContain('<html lang="id">');
  });

  it("renders an error page for an unknown client and never redirects", async () => {
    const reply = await createAgent(portal.origin).get(
      authorizeUrl("state-2", { client_id: "not-a-client" }),
    );

    expect(reply.status).toBe(400);
    expect(reply.location).toBeNull();
    expect(reply.text).toContain("This sign-in link is not valid");
  });

  it("renders an error page for a redirect_uri outside the client's allowlist", async () => {
    const reply = await createAgent(portal.origin).get(
      authorizeUrl("state-3", { redirect_uri: OTHER_REDIRECT }),
    );

    expect(reply.status).toBe(400);
    // The open-redirect test: nothing about the answer points at the attacker's URL.
    expect(reply.location).toBeNull();
    expect(reply.text).not.toContain("evil.test");
  });

  it("refuses a response_type it does not implement", async () => {
    const reply = await createAgent(portal.origin).get(
      authorizeUrl("state-4", { response_type: "token" }),
    );
    expect(reply.status).toBe(400);
    expect(reply.location).toBeNull();
  });
});

describe("the sign-in hops", () => {
  it("sends a code and lands on the neutral page", async () => {
    const email = await freshEmail();
    const agent = createAgent(portal.origin);
    const { page, code } = await signIn(agent, "state-5", email);

    expect(page).toContain("Check your e-mail");
    expect(code).toMatch(/^\d{6}$/);
    expect(portal.mailer.newest()?.to).toBe(email);
  });

  /**
   * The mail used to name a product nothing else in this flow names. The subject and the pages now
   * come from one catalog, and a tenant that really has a display name overrides both.
   */
  it("puts the same product name in the subject that the pages print", async () => {
    const email = await freshEmail();
    await signIn(createAgent(portal.origin), "state-mail", email);

    const subject = portal.mailer.newest()?.subject ?? "";
    expect(subject).toContain("DPSBuddy");
    // The fixture tenant's name is its slug (`testing/fixtures.ts`), which is the seed's
    // placeholder, not a display name -- so the slug must not reach the subject either.
    expect(subject).not.toContain(fixture.tenant.slug);
  });

  it("lets a tenant that has a real display name name itself in the subject", async () => {
    try {
      await portal.store.store.tx(fixture.tenant.id, (ops) =>
        ops.tenantConfig.upsert({
          tenantId: fixture.tenant.id,
          branding: { product_name: "AIHub Metranet" },
        }),
      );
      await signIn(createAgent(portal.origin), "state-mail-2", await freshEmail());
      expect(portal.mailer.newest()?.subject).toContain("AIHub Metranet");
    } finally {
      await portal.store.store.tx(fixture.tenant.id, (ops) =>
        ops.tenantConfig.upsert({ tenantId: fixture.tenant.id, branding: {} }),
      );
    }
  });

  it("renders the identical page for an unknown address, and sends nothing", async () => {
    const agent = createAgent(portal.origin);
    const known = await signIn(agent, "state-6", await freshEmail());
    portal.mailer.clear();

    const unknown = await signIn(createAgent(portal.origin), "state-6", "nobody@nowhere.test");

    expect(portal.mailer.sent).toHaveLength(0);
    // Byte-identical but for the CSRF token and the echoed e-mail, both of which the browser
    // already knows. The sentence a user reads is the same.
    expect(unknown.page).toContain("If that address has an account");
    expect(known.page).toContain("If that address has an account");
  });

  it("renders the same page when the transport refuses the message", async () => {
    portal.mailer.failNext();
    const { page } = await signIn(createAgent(portal.origin), "state-7", await freshEmail());

    expect(page).toContain("Check your e-mail");
    expect(portal.mailer.sent).toHaveLength(0);
    const failures = await portal.store.store.tx(fixture.tenant.id, (ops) =>
      ops.audit.list({ tenantId: fixture.tenant.id, action: "otp.send_failed" }),
    );
    expect(failures.length).toBeGreaterThan(0);
  });

  it("completes: 302 to the registered redirect_uri with a code and the echoed state", async () => {
    const email = await freshEmail();
    const agent = createAgent(portal.origin);
    const { page, code } = await signIn(agent, "state-8", email);
    const done = await submitCode(agent, page, "state-8", code, email);

    expect(done.status).toBe(302);
    const location = new URL(done.location as string);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe("state-8");
    expect(location.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(done.headers.get("referrer-policy")).toBe("no-referrer");
    expect(agent.cookies.has("portal_session")).toBe(true);
  });

  it("skips the OTP entirely on the second sign-in, because the portal session cookie is live", async () => {
    const email = await freshEmail();
    const agent = createAgent(portal.origin);
    const { page, code } = await signIn(agent, "state-9", email);
    await submitCode(agent, page, "state-9", code, email);
    portal.mailer.clear();

    const again = await agent.get(authorizeUrl("state-10"));

    expect(again.status).toBe(302);
    expect(new URL(again.location as string).searchParams.get("state")).toBe("state-10");
    expect(portal.mailer.sent).toHaveLength(0);
  });

  it("refuses a post with no CSRF token, which is what a cross-site form has", async () => {
    const agent = createAgent(portal.origin);
    await agent.get(authorizeUrl("state-11"));

    const reply = await agent.postForm("/authorize/email", {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state: "state-11",
      email: fixture.user.email,
    });

    expect(reply.status).toBe(403);
    expect(portal.mailer.sent).toHaveLength(0);
  });

  it("re-validates the redirect_uri on the posts, not just on the first GET", async () => {
    const agent = createAgent(portal.origin);
    const start = await agent.get(authorizeUrl("state-12"));

    const reply = await agent.postForm("/authorize/email", {
      csrf_token: hiddenValue(start.text, "csrf_token") as string,
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: OTHER_REDIRECT,
      state: "state-12",
      email: fixture.user.email,
    });

    expect(reply.status).toBe(400);
    expect(reply.location).toBeNull();
    expect(portal.mailer.sent).toHaveLength(0);
  });
});

describe("the code form", () => {
  it("counts down the five attempts and refuses the sixth", async () => {
    const email = await freshEmail();
    const agent = createAgent(portal.origin);
    const { page, code } = await signIn(agent, "state-13", email);
    const wrong = code === "000000" ? "111111" : "000000";

    const messages: string[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const reply = await submitCode(agent, page, "state-13", wrong, email);
      expect(reply.status).toBe(400);
      messages.push(reply.text);
    }
    expect(messages[0]).toContain("4 attempts left");
    expect(messages[4]).toContain("0 attempts left");

    const sixth = await submitCode(agent, page, "state-13", wrong, email);
    expect(sixth.text).toContain("Too many attempts");

    // And the right code no longer works either: the row is spent.
    const after = await submitCode(agent, page, "state-13", code, email);
    expect(after.status).toBe(400);
    expect(after.location).toBeNull();
  });

  it("refuses a code that was already used", async () => {
    const email = await freshEmail();
    const agent = createAgent(portal.origin);
    const { page, code } = await signIn(agent, "state-14", email);
    expect((await submitCode(agent, page, "state-14", code, email)).status).toBe(302);

    const replay = await submitCode(createAgent(portal.origin), page, "state-14", code, email);
    expect(replay.status).not.toBe(302);
  });

  it("stops after three sends inside the window and still says nothing", async () => {
    const email = "burst@dpsbuddy.test";
    await addUser(portal.store.store, fixture, email);
    const agent = createAgent(portal.origin);

    for (let i = 0; i < 3; i += 1) {
      await signIn(agent, `state-15-${i}`, email);
    }
    expect(portal.mailer.sent).toHaveLength(3);

    const fourth = await signIn(agent, "state-15-3", email);
    expect(portal.mailer.sent).toHaveLength(3);
    expect(fourth.page).toContain("Check your e-mail");
  });
});

/**
 * Twenty guesses per address per 24 hours, over the wire. Before this, five guesses a code and three
 * codes per 15 minutes allowed about 1,440 guesses a day at one address, and nothing capped that.
 * Its own portal, because the fourth send has to wait out the send window, and only a clock the
 * test moves can do that in a test's time.
 */
describe("the daily guess budget", () => {
  const clock = fixedClock();
  let dayPortal: PortalHarness;
  let dayFixture: Fixture;

  beforeAll(async () => {
    dayPortal = await startTestPortal({ clock });
    dayFixture = await seedFixture(dayPortal.store.store, { slug: "guessday", email: "owner@guessday.test" });
    await dayPortal.store.store.tx(dayFixture.tenant.id, (ops) =>
      ops.oauthClients.create({
        clientId: CLIENT_ID,
        tenantId: dayFixture.tenant.id,
        name: "DPSBuddy",
        secret: randomToken(),
        redirectUris: [REDIRECT],
      }),
    );
  }, 180_000);

  afterAll(async () => {
    await dayPortal?.close();
  });

  async function sendCode(agent: Agent, state: string, email: string) {
    const start = await agent.get(authorizeUrl(state));
    const sent = await agent.postForm("/authorize/email", {
      csrf_token: hiddenValue(start.text, "csrf_token") as string,
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state,
      email,
    });
    return { page: sent.text, code: dayPortal.mailer.newest()?.code ?? "" };
  }

  function guess(agent: Agent, page: string, state: string, email: string, code: string, path = "/authorize/verify") {
    return agent.postForm(path, {
      csrf_token: hiddenValue(page, "csrf_token") as string,
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      state,
      email,
      code,
    });
  }

  it("refuses even the right code once twenty guesses were spent today, says why in both languages, and audits otp.locked", async () => {
    const email = "spent@guessday.test";
    await addUser(dayPortal.store.store, dayFixture, email);
    const agent = createAgent(dayPortal.origin);

    // Four codes, five wrong guesses each: no code's own limit is what stops anything below.
    for (let n = 0; n < 4; n += 1) {
      if (n === 3) {
        // Three sends per 15 minutes; the fourth waits the window out.
        clock.set(new Date(Date.now() + 16 * 60 * 1000));
      }
      const { page, code } = await sendCode(agent, `state-day-${n}`, email);
      const wrong = code === "999999" ? "000000" : "999999";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await guess(agent, page, `state-day-${n}`, email, wrong)).status).toBe(400);
      }
    }

    const { page, code } = await sendCode(agent, "state-day-4", email);
    expect(code).toMatch(/^\d{6}$/);

    const refused = await guess(agent, page, "state-day-4", email, code);
    expect(refused.status).toBe(400);
    expect(refused.location).toBeNull();
    expect(refused.text).toContain("Try again in 24 hours");

    const refusedId = await guess(agent, refused.text, "state-day-4", email, code, "/authorize/verify?lang=id");
    expect(refusedId.status).toBe(400);
    expect(refusedId.text).toContain("Coba lagi dalam 24 jam");

    const audit = await dayPortal.store.store.tx(dayFixture.tenant.id, (ops) =>
      ops.audit.list({ tenantId: dayFixture.tenant.id, action: "otp.locked" }),
    );
    expect(audit).toHaveLength(2);
    expect(audit.every((row) => row.reasonCode === "locked")).toBe(true);
  });
});

describe("the login gate", () => {
  it("redirects with ?error=seat_cap_reached rather than rendering it", async () => {
    const capped = await seedFixture(portal.store.store, { slug: "capped", seatCap: 1, email: "a@capped.test" });
    const secret = randomToken();
    await portal.store.store.tx(capped.tenant.id, (ops) =>
      ops.oauthClients.create({
        clientId: "capped-web",
        tenantId: capped.tenant.id,
        name: "capped",
        secret,
        redirectUris: [REDIRECT],
      }),
    );
    // One seat, and the first user already holds it with a live session.
    const device = await portal.store.store.tx(capped.tenant.id, async (ops) => {
      const upserted = await ops.devices.upsert({
        tenantId: capped.tenant.id,
        orgId: capped.org.id,
        userId: capped.user.id,
        installId: "install-capped-1",
        platform: "windows",
      });
      if (!upserted.ok) throw new Error("device revoked");
      return upserted.device;
    });
    await portal.store.store.tx(capped.tenant.id, (ops) =>
      ops.sessions.create({
        tenantId: capped.tenant.id,
        orgId: capped.org.id,
        userId: capped.user.id,
        deviceId: device.id,
      }),
    );
    const second = await addUser(portal.store.store, capped, "b@capped.test");

    const agent = createAgent(portal.origin);
    const query = new URLSearchParams({
      response_type: "code",
      client_id: "capped-web",
      redirect_uri: REDIRECT,
      state: "state-16",
    });
    const start = await agent.get(`/authorize?${query.toString()}`);
    const csrf = hiddenValue(start.text, "csrf_token") as string;
    const sent = await agent.postForm("/authorize/email", {
      csrf_token: csrf,
      response_type: "code",
      client_id: "capped-web",
      redirect_uri: REDIRECT,
      state: "state-16",
      email: second.email,
    });
    const done = await agent.postForm("/authorize/verify", {
      csrf_token: hiddenValue(sent.text, "csrf_token") as string,
      response_type: "code",
      client_id: "capped-web",
      redirect_uri: REDIRECT,
      state: "state-16",
      email: second.email,
      code: portal.mailer.newest()?.code ?? "",
    });

    expect(done.status).toBe(302);
    const location = new URL(done.location as string);
    expect(location.searchParams.get("error")).toBe("seat_cap_reached");
    expect(location.searchParams.get("state")).toBe("state-16");
    expect(location.searchParams.get("code")).toBeNull();
  });
});

describe("what reached the log", () => {
  it("never wrote an OTP, an authorization code or a session cookie to any line", async () => {
    const email = await freshEmail();
    const agent = createAgent(portal.origin);
    const { page, code } = await signIn(agent, "state-17", email);
    const done = await submitCode(agent, page, "state-17", code, email);
    expect(done.status).toBe(302);
    const authCode = new URL(done.location as string).searchParams.get("code") as string;
    const sessionCookie = agent.cookies.get("portal_session") as string;

    const log = portal.logLines.join("\n");
    expect(log).not.toContain(code);
    expect(log).not.toContain(authCode);
    expect(log).not.toContain(sessionCookie.split(".")[0]);
    expect(log).not.toContain(clientSecret);
  });
});
