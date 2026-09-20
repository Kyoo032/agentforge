/**
 * Phase 3 lane C — provisioning a portal identity and resolving it back.
 *
 * In-memory SQLite built by `ensureSchema`, the same fixture `migrate-0015.test.ts` uses for the
 * fresh-database cases. Nothing here touches a data dir or the repo's own database.
 */
import { LOCAL_TENANT_ID } from "@agentforge/core";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema } from "./ensure-schema";
import { ensurePortalOwner, PortalProvisionError, resolvePortalTenant } from "./portal-owner";
import * as schema from "./schema";
import { organizations, user, workspaces } from "./schema";

const A = { tenantId: "tnt_a", orgId: "org_a", userId: "usr_a" };
const B = { tenantId: "tnt_b", orgId: "org_b", userId: "usr_b" };

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  ensureSchema(sqlite);
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
});

describe("ensurePortalOwner", () => {
  it("writes the tenant, org, user, membership and a home desk from the portal's ids", async () => {
    const tenant = await ensurePortalOwner(db, A);

    expect(tenant).toMatchObject({ tenantId: "tnt_a", organizationId: "org_a", userId: "usr_a", role: "owner" });
    const [org] = await db.select().from(organizations).where(eq(organizations.id, "org_a"));
    expect(org.tenantId).toBe("tnt_a");
    const desks = await db.select().from(workspaces).where(eq(workspaces.organizationId, "org_a"));
    expect(desks).toHaveLength(1);
    expect(desks[0].slug).toBe("home");
  });

  it("is idempotent: a second sign-in adds no second org, desk or user", async () => {
    const first = await ensurePortalOwner(db, A);
    const second = await ensurePortalOwner(db, A);

    expect(second.workspaceId).toBe(first.workspaceId);
    expect(await db.select().from(workspaces).where(eq(workspaces.organizationId, "org_a"))).toHaveLength(1);
    expect(await db.select().from(user)).toHaveLength(1);
  });

  it("keys the user on the portal id and never on an address anyone else could claim", async () => {
    await ensurePortalOwner(db, A);

    const [row] = await db.select().from(user).where(eq(user.id, "usr_a"));
    expect(row.id).toBe("usr_a");
    // RFC 2606 reserves `.invalid`, so this can never collide with a real address.
    expect(row.email).toMatch(/@portal\.invalid$/);
    expect(row.emailVerified).toBe(false);
  });

  it("leaves the local tenant alone, so a desktop database that signs in still opens", async () => {
    await ensurePortalOwner(db, A);

    const rows = await db.select().from(schema.tenants);
    expect(rows.map((row) => row.id).sort()).toEqual([LOCAL_TENANT_ID, "tnt_a"].sort());
  });

  it("refuses to re-home an org that already belongs to another tenant", async () => {
    await ensurePortalOwner(db, A);

    await expect(ensurePortalOwner(db, { ...A, tenantId: "tnt_b" })).rejects.toBeInstanceOf(PortalProvisionError);
  });

  it("gives two tenants disjoint orgs and desks", async () => {
    const a = await ensurePortalOwner(db, A);
    const b = await ensurePortalOwner(db, B);

    expect(a.organizationId).not.toBe(b.organizationId);
    expect(a.workspaceId).not.toBe(b.workspaceId);
  });
});

describe("resolvePortalTenant", () => {
  it("resolves a provisioned identity to its own org and home desk", async () => {
    const provisioned = await ensurePortalOwner(db, A);

    const resolution = await resolvePortalTenant(db, A);

    expect(resolution.ok).toBe(true);
    expect(resolution.ok && resolution.tenant).toMatchObject({
      tenantId: "tnt_a",
      organizationId: "org_a",
      workspaceId: provisioned.workspaceId,
      role: "owner",
    });
  });

  it("creates nothing: an identity nobody provisioned is refused, not given a desk", async () => {
    const resolution = await resolvePortalTenant(db, A);

    expect(resolution).toEqual({ ok: false, code: "tenant_inactive" });
    expect(await db.select().from(organizations)).toHaveLength(0);
  });

  it("refuses an inactive tenant", async () => {
    await ensurePortalOwner(db, A);
    await db.update(schema.tenants).set({ status: "inactive" }).where(eq(schema.tenants.id, "tnt_a"));

    expect(await resolvePortalTenant(db, A)).toEqual({ ok: false, code: "tenant_inactive" });
  });

  it("refuses an org from another tenant even though both ids are real", async () => {
    await ensurePortalOwner(db, A);
    await ensurePortalOwner(db, B);

    expect(await resolvePortalTenant(db, { ...A, orgId: "org_b" })).toEqual({ ok: false, code: "org_inactive" });
  });

  it("refuses a user who is not a member of the org the session names", async () => {
    await ensurePortalOwner(db, A);
    await ensurePortalOwner(db, B);

    expect(await resolvePortalTenant(db, { ...A, userId: "usr_b" })).toEqual({ ok: false, code: "user_inactive" });
  });

  it("refuses a desk that belongs to another tenant instead of substituting home", async () => {
    await ensurePortalOwner(db, A);
    const b = await ensurePortalOwner(db, B);

    expect(await resolvePortalTenant(db, A, b.workspaceId)).toEqual({ ok: false, code: "workspace_not_found" });
  });

  it("honours a desk the session's own org owns", async () => {
    const a = await ensurePortalOwner(db, A);

    const resolution = await resolvePortalTenant(db, A, a.workspaceId);

    expect(resolution.ok && resolution.tenant.workspaceId).toBe(a.workspaceId);
  });

  it("treats an empty or whitespace desk preference as no preference", async () => {
    const a = await ensurePortalOwner(db, A);

    for (const blank of ["", "   ", null, undefined]) {
      const resolution = await resolvePortalTenant(db, A, blank);
      expect(resolution.ok && resolution.tenant.workspaceId).toBe(a.workspaceId);
    }
  });
});
