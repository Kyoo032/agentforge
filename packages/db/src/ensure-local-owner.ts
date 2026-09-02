import { and, eq } from "drizzle-orm";
import {
  HOME_WORKSPACE_SLUG,
  LOCAL_OWNER_ID,
  PERSONAL_ORG_SLUG,
  WORK_PRODUCT_MODES,
  pickWorkspaceId,
  slugifyWorkspace,
  type ProductMode,
  type TenantContext,
} from "@agentforge/core";
import type { Database } from "./client";
import { organizationMembers, organizations, user, workspaceMembers, workspaces } from "./schema";

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

  let [org] = await db.select().from(organizations).where(eq(organizations.slug, PERSONAL_ORG_SLUG)).limit(1);
  if (!org) {
    const inserted = await db
      .insert(organizations)
      .values({
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
        name: "Home",
        slug: HOME_WORKSPACE_SLUG,
        productModes: [...WORK_PRODUCT_MODES],
      })
      .returning();
    ownedWorkspaces = inserted;
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

export async function createLocalWorkspace(
  db: Database,
  organizationId: string,
  name: string,
  templatePack?: string,
  productModes?: ProductMode[],
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
    userId: LOCAL_OWNER_ID,
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
