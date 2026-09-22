/**
 * Authorization codes: 60 s, single use, bound to `client_id` and `redirect_uri`.
 *
 * `state_hash` is stored and never compared -- see "consumes a code without being given a state"
 * below and SR-43. It stays on the row for audit.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomToken } from "../../crypto";
import { seedFixture, type Fixture } from "../../testing/fixtures";
import { createTestStore, fixedClock, type TestStore } from "../../testing/pg";
import type { PortalStore } from "../types";

let harness: TestStore;
let store: PortalStore;
let fixture: Fixture;
const clock = fixedClock();

const CLIENT_ID = "dpsbuddy-web";
const REDIRECT = "https://localhost:3443/auth/callback";

beforeAll(async () => {
  harness = await createTestStore(clock);
  store = harness.store;
  fixture = await seedFixture(store);
  await store.tx(fixture.tenant.id, (ops) =>
    ops.oauthClients.create({
      clientId: CLIENT_ID,
      tenantId: fixture.tenant.id,
      name: "DPSBuddy web",
      secret: "s3cret-value-for-the-test",
      redirectUris: [REDIRECT, "https://localhost:3443/auth/callback/alt"],
    }),
  );
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

async function issue(options: { state?: string; ttlMs?: number; redirectUri?: string } = {}) {
  clock.set(new Date());
  const raw = randomToken();
  const state = options.state ?? randomToken(16);
  await store.tx(fixture.tenant.id, (ops) =>
    ops.authCodes.issue({
      rawCode: raw,
      tenantId: fixture.tenant.id,
      orgId: fixture.org.id,
      userId: fixture.user.id,
      clientId: CLIENT_ID,
      redirectUri: options.redirectUri ?? REDIRECT,
      state,
      ttlMs: options.ttlMs,
    }),
  );
  return { raw, state };
}

function consume(input: { rawCode: string; clientId?: string; redirectUri?: string }) {
  return store.tx(fixture.tenant.id, (ops) =>
    ops.authCodes.consume({
      rawCode: input.rawCode,
      clientId: input.clientId ?? CLIENT_ID,
      redirectUri: input.redirectUri ?? REDIRECT,
    }),
  );
}

describe("authorization codes", () => {
  it("is exchanged once and refused the second time", async () => {
    const { raw } = await issue();
    const first = await consume({ rawCode: raw });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.code.userId).toBe(fixture.user.id);
    expect(first.code.consumedAt).not.toBeNull();

    const replay = await consume({ rawCode: raw });
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toBe("already_used");
  });

  it("is bound to the client it was issued to", async () => {
    const { raw } = await issue();
    const result = await consume({ rawCode: raw, clientId: "someone-else" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("client_mismatch");
  });

  it("is bound to the redirect_uri it was issued for", async () => {
    const { raw } = await issue();
    const result = await consume({
      rawCode: raw,
      redirectUri: "https://localhost:3443/auth/callback/alt",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("redirect_mismatch");
  });

  /**
   * SR-43. `state_hash` is written and never read back: the host does not send `state` to
   * `/auth/token` and never did -- its own `__Host-` cookie comparison
   * (`packages/host/src/auth/routes.ts`, `readState`) is the login-CSRF control, and it runs
   * before the portal is called at all. The `state_mismatch` branch here was therefore dead code
   * dressed as a control, which is worse than no control: the map page and the migration comment
   * both claimed the code was "bound to sha256(state)". The hash is still stored, for audit.
   */
  it("consumes a code without being given a state, because nothing sends one", async () => {
    const { raw } = await issue();
    const result = await consume({ rawCode: raw });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code.userId).toBe(fixture.user.id);
  });

  it("expires after 60 seconds", async () => {
    const { raw } = await issue({ ttlMs: -1 });
    const result = await consume({ rawCode: raw });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("expired");
  });

  it("defaults to a 60 second life", async () => {
    clock.set(new Date());
    const raw = randomToken();
    const issued = await store.tx(fixture.tenant.id, (ops) =>
      ops.authCodes.issue({
        rawCode: raw,
        tenantId: fixture.tenant.id,
        orgId: fixture.org.id,
        userId: fixture.user.id,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT,
        state: "nonce",
      }),
    );
    const life = new Date(issued.expiresAt).getTime() - new Date(issued.createdAt).getTime();
    expect(life).toBeGreaterThan(50_000);
    expect(life).toBeLessThanOrEqual(61_000);
  });

  it("answers invalid_grant for a code that was never issued", async () => {
    const result = await consume({ rawCode: randomToken() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_grant");
  });

  it("stores neither the code nor the state", async () => {
    const { raw, state } = await issue();
    const consumed = await consume({ rawCode: raw });
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) return;
    const serialised = JSON.stringify(consumed.code);
    expect(serialised).not.toContain(raw);
    expect(serialised).not.toContain(state);
  });
});

describe("oauth clients", () => {
  it("verifies its secret in constant time and refuses a wrong one", async () => {
    expect(await store.tx(fixture.tenant.id, (ops) => ops.oauthClients.verifySecret(CLIENT_ID, "s3cret-value-for-the-test"))).toBe(true);
    expect(await store.tx(fixture.tenant.id, (ops) => ops.oauthClients.verifySecret(CLIENT_ID, "wrong"))).toBe(false);
    expect(await store.tx(fixture.tenant.id, (ops) => ops.oauthClients.verifySecret("unknown-client", "wrong"))).toBe(false);
  });

  it("matches a redirect_uri exactly — no prefix, no wildcard", async () => {
    const allows = (uri: string) =>
      store.tx(fixture.tenant.id, (ops) => ops.oauthClients.allowsRedirect(CLIENT_ID, uri));
    expect(await allows(REDIRECT)).toBe(true);
    expect(await allows(`${REDIRECT}/../evil`)).toBe(false);
    expect(await allows(`${REDIRECT}?next=https://evil.example`)).toBe(false);
    expect(await allows("https://evil.example/auth/callback")).toBe(false);
  });

  it("rotates the secret, invalidating the old one immediately", async () => {
    const next = randomToken();
    await store.tx(fixture.tenant.id, (ops) => ops.oauthClients.rotateSecret(CLIENT_ID, next));
    expect(await store.tx(fixture.tenant.id, (ops) => ops.oauthClients.verifySecret(CLIENT_ID, next))).toBe(true);
    expect(
      await store.tx(fixture.tenant.id, (ops) => ops.oauthClients.verifySecret(CLIENT_ID, "s3cret-value-for-the-test")),
    ).toBe(false);
  });

  it("never returns the secret hash", async () => {
    const client = await store.tx(fixture.tenant.id, (ops) => ops.oauthClients.findByClientId(CLIENT_ID));
    expect(client).not.toBeNull();
    expect(Object.keys(client ?? {})).not.toContain("secretHash");
    expect(Object.isFrozen(client)).toBe(true);
  });

  it("resolves its tenant before anyone has signed in", async () => {
    // A brand-new tenant id used to double-check the resolver is not reading a cached scope.
    expect(await store.resolve.byClientId(CLIENT_ID)).toBe(fixture.tenant.id);
    expect(await store.resolve.byClientId(`missing-${randomUUID().slice(0, 8)}`)).toBeNull();
  });
});
