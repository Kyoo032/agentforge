/**
 * Proof that the policies in `docs/internal/portal/migrations/0004_rls.sql` and
 * `apps/portal/migrations/0006_browser_login.sql` actually isolate a tenant.
 *
 * This suite exists because a test that connects as the cluster superuser proves none of it: a
 * superuser bypasses row-level security, so every assertion below would pass with the policies
 * dropped. `src/testing/pg.ts` therefore connects the store as `portal_app_test`, a plain LOGIN
 * role whose only privilege is membership of `portal_app` -- and the first test here asserts that,
 * so a future change that quietly restores the superuser connection fails loudly rather than
 * turning the rest of the file into theatre.
 */
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomToken } from "../crypto";
import { addDevice, seedFixture, type Fixture } from "../testing/fixtures";
import { APP_ROLE, appClientFor, createTestStore, type TestStore } from "../testing/pg";
import type { PortalStore } from "../store/types";

/** The five tables the brief names, plus the two with a deliberate pre-authentication window. */
const TENANT_TABLES = ["users", "sessions", "refresh_tokens", "login_otps", "auth_codes"] as const;

interface TenantData {
  readonly fixture: Fixture;
  readonly sessionId: string;
  readonly deviceId: string;
  readonly clientId: string;
  readonly authCodeId: string;
}

let harness: TestStore;
let store: PortalStore;
let raw: Client;
let alpha: TenantData;
let beta: TenantData;

async function populate(store: PortalStore, slug: string): Promise<TenantData> {
  const fixture = await seedFixture(store, { slug, email: `owner@${slug}.test` });
  const device = await addDevice(store, fixture, fixture.user);
  const clientId = `client-${slug}`;

  return store.tx(fixture.tenant.id, async (ops) => {
    const session = await ops.sessions.create({
      tenantId: fixture.tenant.id,
      orgId: fixture.org.id,
      userId: fixture.user.id,
      deviceId: device.id,
    });
    await ops.refreshTokens.issue({ sessionId: session.id, rawToken: randomToken() });
    await ops.loginOtps.send({
      tenantId: fixture.tenant.id,
      email: fixture.user.email,
      code: "123456",
    });
    await ops.oauthClients.create({
      clientId,
      tenantId: fixture.tenant.id,
      name: slug,
      secret: randomToken(),
      redirectUris: [`https://${slug}.test/auth/callback`],
    });
    const authCode = await ops.authCodes.issue({
      rawCode: randomToken(),
      tenantId: fixture.tenant.id,
      orgId: fixture.org.id,
      userId: fixture.user.id,
      clientId,
      redirectUri: `https://${slug}.test/auth/callback`,
      state: randomToken(),
    });
    return { fixture, sessionId: session.id, deviceId: device.id, clientId, authCodeId: authCode.id };
  });
}

/** One statement under an explicit tenant scope, the way `store.tx` runs every query. */
async function scoped<T>(tenantId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await raw.query("BEGIN");
  try {
    await raw.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId ?? ""]);
    const { rows } = await raw.query(sql, params);
    return rows as T[];
  } finally {
    await raw.query("ROLLBACK");
  }
}

beforeAll(async () => {
  harness = await createTestStore();
  store = harness.store;
  raw = await appClientFor(harness.database);
  alpha = await populate(store, "alpha");
  beta = await populate(store, "beta");
}, 120_000);

afterAll(async () => {
  await raw?.end();
  await harness?.close();
});

describe("the connection the suite actually uses", () => {
  it("is a non-superuser member of portal_app, so a policy can refuse it", async () => {
    const [role] = await scoped<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      member: boolean;
    }>(
      null,
      `SELECT current_user, r.rolsuper, r.rolbypassrls,
              pg_has_role(current_user, 'portal_app', 'member') AS member
         FROM pg_roles r WHERE r.rolname = current_user`,
    );

    expect(role.current_user).toBe(APP_ROLE);
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
    expect(role.member).toBe(true);
  });

  it("reaches its own tenant's rows, so the isolation below is not just a broken connection", async () => {
    const rows = await scoped<{ id: string }>(alpha.fixture.tenant.id, `SELECT id FROM users`);
    expect(rows.map((row) => row.id)).toEqual([alpha.fixture.user.id]);
  });
});

describe("a transaction scoped to one tenant", () => {
  it.each(TENANT_TABLES)("reads none of tenant beta's %s", async (table) => {
    const mine = await scoped<{ n: string }>(
      alpha.fixture.tenant.id,
      `SELECT count(*)::text AS n FROM ${table} WHERE tenant_id = $1`,
      [alpha.fixture.tenant.id],
    );
    const theirs = await scoped<{ n: string }>(
      alpha.fixture.tenant.id,
      `SELECT count(*)::text AS n FROM ${table} WHERE tenant_id = $1`,
      [beta.fixture.tenant.id],
    );

    expect(Number(mine[0].n)).toBeGreaterThan(0);
    expect(Number(theirs[0].n)).toBe(0);
  });

  it("cannot see another tenant's tenants, orgs or devices row either", async () => {
    const [counts] = await scoped<{ tenants: string; orgs: string; devices: string }>(
      alpha.fixture.tenant.id,
      `SELECT (SELECT count(*)::text FROM tenants WHERE id = $1)      AS tenants,
              (SELECT count(*)::text FROM orgs    WHERE id = $2)      AS orgs,
              (SELECT count(*)::text FROM devices WHERE id = $3)      AS devices`,
      [beta.fixture.tenant.id, beta.fixture.org.id, beta.deviceId],
    );
    expect(counts).toEqual({ tenants: "0", orgs: "0", devices: "0" });
  });

  it("cannot update another tenant's user, and the row is untouched afterwards", async () => {
    const updated = await scoped<{ id: string }>(
      alpha.fixture.tenant.id,
      `UPDATE users SET status = 'disabled' WHERE id = $1 RETURNING id`,
      [beta.fixture.user.id],
    );
    expect(updated).toEqual([]);

    const [after] = await scoped<{ status: string }>(
      beta.fixture.tenant.id,
      `SELECT status FROM users WHERE id = $1`,
      [beta.fixture.user.id],
    );
    expect(after.status).toBe("active");
  });

  it("cannot insert a row carrying another tenant's id -- WITH CHECK refuses it", async () => {
    await expect(
      scoped(
        alpha.fixture.tenant.id,
        `INSERT INTO login_otps (tenant_id, email, otp_hash, expires_at)
         VALUES ($1, 'smuggled@beta.test', sha256('x'::bytea), now() + interval '10 minutes')`,
        [beta.fixture.tenant.id],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("cannot revoke another tenant's session through the store either", async () => {
    // "admin" is one of the values `sessions_revoked_reason_chk` allows; the point of the test is
    // that the row is never reached, not what reason would have been written.
    await store.tx(alpha.fixture.tenant.id, (ops) => ops.sessions.revoke(beta.sessionId, "admin"));
    const live = await store.tx(beta.fixture.tenant.id, (ops) => ops.sessions.findById(beta.sessionId));
    expect(live?.revokedAt).toBeNull();
  });

  it("cannot consume another tenant's authorization code through the store", async () => {
    const [before] = await scoped<{ consumed_at: string | null }>(
      beta.fixture.tenant.id,
      `SELECT consumed_at FROM auth_codes WHERE id = $1`,
      [beta.authCodeId],
    );
    expect(before.consumed_at).toBeNull();

    const rows = await scoped<{ id: string }>(
      alpha.fixture.tenant.id,
      `UPDATE auth_codes SET consumed_at = now() WHERE id = $1 RETURNING id`,
      [beta.authCodeId],
    );
    expect(rows).toEqual([]);
  });
});

describe("the pre-authentication window", () => {
  it("reaches no tenant-scoped table at all when app.tenant_id is unset", async () => {
    for (const table of TENANT_TABLES) {
      const [row] = await scoped<{ n: string }>(null, `SELECT count(*)::text AS n FROM ${table}`);
      expect({ table, n: row.n }).toEqual({ table, n: "0" });
    }
  });

  it("no longer reaches oauth_clients: 0008 closed that window", async () => {
    // 0006 gave the table the device_codes shape. Nothing needed it -- every call site scopes the
    // transaction first -- so 0008 removed `OR app_tenant_id() IS NULL` and the list of every
    // partner's client ids and callbacks stopped being readable without a tenant.
    const unscoped = await scoped<{ client_id: string }>(null, `SELECT client_id FROM oauth_clients`);
    expect(unscoped).toEqual([]);

    const scopedRows = await scoped<{ client_id: string }>(
      alpha.fixture.tenant.id,
      `SELECT client_id FROM oauth_clients`,
    );
    expect(scopedRows.map((row) => row.client_id)).toEqual([alpha.clientId]);
  });

  it("keeps the device_codes window, which is the one a code is legitimately minted in", async () => {
    const rawDeviceCode = randomToken();
    // tenantId null is the generic-build case: the row is inserted with no tenant at all.
    const minted = await store.tx(null, (ops) =>
      ops.deviceCodes.create({ rawDeviceCode, installId: "install-unscoped-1" }),
    );
    const readBack = await scoped<{ id: string }>(
      null,
      `SELECT id FROM device_codes WHERE id = $1`,
      [minted.id],
    );
    expect(readBack.map((row) => row.id)).toEqual([minted.id]);
  });

  it("answers through the SECURITY DEFINER resolvers, which is the only other way in", async () => {
    // The resolvers run outside a tenant scope by design and each answers at most a tenant id.
    await expect(store.resolve.bySlug(alpha.fixture.tenant.slug)).resolves.toBe(alpha.fixture.tenant.id);
    await expect(store.resolve.byEmail(beta.fixture.user.email)).resolves.toBe(beta.fixture.tenant.id);
    await expect(store.resolve.byClientId(beta.clientId)).resolves.toBe(beta.fixture.tenant.id);
    await expect(store.resolve.byEmail("nobody@nowhere.test")).resolves.toBeNull();
  });

  it("still cannot read a user through a resolver -- they return a tenant id and nothing else", async () => {
    const tenantId = await store.resolve.byEmail(beta.fixture.user.email);
    const rows = await scoped<{ email: string }>(
      null,
      `SELECT email FROM users WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows).toEqual([]);
  });
});
