import { and, eq } from "drizzle-orm";
import {
  HOME_WORKSPACE_NAME,
  HOME_WORKSPACE_SLUG,
  LEGACY_HOME_WORKSPACE_NAME,
  LOCAL_OWNER_ID,
  LOCAL_TENANT_ID,
  LOCAL_TENANT_NAME,
  LOCAL_TENANT_SLUG,
  PERSONAL_ORG_SLUG,
  WORK_PRODUCT_MODES,
  pickWorkspaceId,
  slugifyWorkspace,
  type ProductMode,
  type TenantContext,
} from "@agentforge/core";
import type { Database } from "./client";
import { organizationMembers, organizations, tenants, user, workspaceMembers, workspaces } from "./schema";

export async function ensureLocalOwner(db: Database, preferredWorkspaceId?: string | null): Promise<TenantContext> {
  let [owner] = await db.select().from(user).where(eq(user.id, LOCAL_OWNER_ID)).limit(1);
  if (!owner) {
    await db.insert(user).values({
      id: LOCAL_OWNER_ID,
      name: "You",
      email: "local@agentforge.local",
      emailVerified: true,
    });
  }

  // Migration 0015 writes this row, and `ensureTenantTables` heals it onto a baseline-stamped
  // database. Re-asserting it here covers a test that builds a schema without either.
  const [localTenant] = await db.select().from(tenants).where(eq(tenants.id, LOCAL_TENANT_ID)).limit(1);
  if (!localTenant) {
    await db.insert(tenants).values({
      id: LOCAL_TENANT_ID,
      slug: LOCAL_TENANT_SLUG,
      name: LOCAL_TENANT_NAME,
      status: "active",
    });
  }

  // Scoped by tenant as well as slug: `organizations.slug` is only unique within a tenant from
  // 0015 on, so slug alone would pick an arbitrary tenant's "personal" org once a second exists.
  let [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.tenantId, LOCAL_TENANT_ID), eq(organizations.slug, PERSONAL_ORG_SLUG)))
    .limit(1);
  if (!org) {
    const inserted = await db
      .insert(organizations)
      .values({
        tenantId: LOCAL_TENANT_ID,
        name: "Personal",
        slug: PERSONAL_ORG_SLUG,
        industryPack: "generic",
      })
      .returning();
    org = inserted[0];
  }

  let ownedWorkspaces = await db.select().from(workspaces).where(eq(workspaces.organizationId, org.id));
  if (ownedWorkspaces.length === 0) {
    const inserted = await db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: HOME_WORKSPACE_NAME,
        slug: HOME_WORKSPACE_SLUG,
        productModes: [...WORK_PRODUCT_MODES],
      })
      .returning();
    ownedWorkspaces = inserted;
  }

  const homeRow = ownedWorkspaces.find((row) => row.slug === HOME_WORKSPACE_SLUG);
  if (homeRow?.name === LEGACY_HOME_WORKSPACE_NAME) {
    await db.update(workspaces).set({ name: HOME_WORKSPACE_NAME }).where(eq(workspaces.id, homeRow.id));
    homeRow.name = HOME_WORKSPACE_NAME;
  }

  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, LOCAL_OWNER_ID)))
    .limit(1);
  if (!membership) {
    await db.insert(organizationMembers).values({
      organizationId: org.id,
      userId: LOCAL_OWNER_ID,
      role: "owner",
    });
  }

  const workspaceId = pickWorkspaceId(
    ownedWorkspaces.map((row) => ({ id: row.id, slug: row.slug })),
    preferredWorkspaceId,
  );

  const [workspaceMembership] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, LOCAL_OWNER_ID)))
    .limit(1);
  if (!workspaceMembership) {
    await db.insert(workspaceMembers).values({
      workspaceId,
      organizationId: org.id,
      userId: LOCAL_OWNER_ID,
      role: "owner",
    });
  }

  const tenant: TenantContext = {
    tenantId: org.tenantId,
    organizationId: org.id,
    workspaceId,
    userId: LOCAL_OWNER_ID,
    role: "owner",
  };

  return tenant;
}

export async function listLocalWorkspaces(db: Database, organizationId: string) {
  return db.select().from(workspaces).where(eq(workspaces.organizationId, organizationId));
}

/**
 * Create a desk in an organisation and make one user its owner.
 *
 * `ownerUserId` defaults to `LOCAL_OWNER_ID`, which is right on the desktop and on webdev: there is
 * one user there and this function predates there being any other. On the hosted server it was
 * **wrong, and a 500** — a portal-provisioned database has no `local-owner` row, so the
 * `workspace_members` insert below violated its foreign key and `POST /api/v1/workspaces` failed
 * for every signed-in tenant. Found by the Phase 3 lane E tenancy harness, which could not seed a
 * second desk for a portal tenant (`packages/host/src/tenancy-harness.test.ts`);
 * `handlePostWorkspaces` now passes `tenant.userId`. The default is kept so the desktop's callers
 * are untouched.
 */
export async function createLocalWorkspace(
  db: Database,
  organizationId: string,
  name: string,
  templatePack?: string,
  productModes?: ProductMode[],
  ownerUserId: string = LOCAL_OWNER_ID,
) {
  const base = slugifyWorkspace(name);
  let slug = base;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const existing = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.organizationId, organizationId), eq(workspaces.slug, slug)))
      .limit(1);
    if (!existing[0]) {
      break;
    }
    slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;
  }
  const modes = productModes?.length ? productModes : [...WORK_PRODUCT_MODES];
  const [row] = await db
    .insert(workspaces)
    .values({
      organizationId,
      name: name.trim() || "Workspace",
      slug,
      templatePack: templatePack ?? null,
      productModes: modes,
    })
    .returning();
  await db.insert(workspaceMembers).values({
    workspaceId: row.id,
    organizationId,
    userId: ownerUserId,
    role: "owner",
  });
  return row;
}

export async function updateLocalWorkspace(
  db: Database,
  organizationId: string,
  workspaceId: string,
  patch: { name?: string; productModes?: ProductMode[] },
) {
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
    .limit(1);
  if (!existing) {
    return null;
  }
  const [row] = await db
    .update(workspaces)
    .set({
      ...(typeof patch.name === "string" && patch.name.trim() ? { name: patch.name.trim() } : {}),
      ...(patch.productModes ? { productModes: patch.productModes } : {}),
    })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return row ?? existing;
}

export type DeleteWorkspaceResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "protected" };

function wipeKnowledgeForWorkspace(db: Database, workspaceId: string): void {
  const sqlite = db.$client;
  sqlite.prepare("DELETE FROM knowledge_soul WHERE workspace_id = ?").run(workspaceId);
  sqlite.prepare("DELETE FROM knowledge_memories WHERE workspace_id = ?").run(workspaceId);
  sqlite.prepare("DELETE FROM knowledge_sources WHERE workspace_id = ?").run(workspaceId);
  sqlite.prepare("DELETE FROM knowledge_settings WHERE workspace_id = ?").run(workspaceId);
  sqlite.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ?").run(workspaceId);
  sqlite.prepare("DELETE FROM knowledge_maps WHERE workspace_id = ?").run(workspaceId);
  try {
    sqlite.prepare("DELETE FROM knowledge_chunks WHERE workspace_id = ?").run(workspaceId);
  } catch {
    // FTS5 table may be missing in a stripped test schema
  }
}

export async function deleteLocalWorkspace(
  db: Database,
  organizationId: string,
  workspaceId: string,
): Promise<DeleteWorkspaceResult> {
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
    .limit(1);
  if (!existing) {
    return { ok: false, code: "not_found" };
  }
  if (existing.slug === HOME_WORKSPACE_SLUG) {
    return { ok: false, code: "protected" };
  }
  wipeKnowledgeForWorkspace(db, workspaceId);
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  return { ok: true };
}
