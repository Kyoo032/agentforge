/**
 * Provisioning and resolution for a **portal** identity — the hosted web app's half of what
 * `ensure-local-owner.ts` does for the desktop.
 *
 * Phase 3 lane C (docs/internal/web-phase3-tenancy-spec.md §3a, §3d). The portal is the authority
 * for who exists: a browser session carries `tenant_id`, `org_id` and `user_id` that the portal
 * minted, and the host's job is to hold a row for each so the tenant's desks have something to hang
 * off. Nothing here invents an identity — every id is the portal's own.
 *
 * Two entry points, deliberately split:
 *
 *   - `ensurePortalOwner` writes the rows. Called from the **sign-in path only**
 *     (`packages/host/src/auth/routes.ts`), because that is the one moment the host knows the
 *     portal just vouched for these ids.
 *   - `resolvePortalTenant` only reads. It never creates anything, so a session presenting a tenant
 *     the host has never provisioned is refused rather than quietly given a desk.
 *
 * That split is the fail-closed rule from the lane C brief: the portal's browser-login grant is
 * undocumented (spec §8 q1), so a session that does not resolve is a 401/403 and never a fall back
 * to `local-tenant`.
 */
import { and, eq } from "drizzle-orm";
import {
  HOME_WORKSPACE_NAME,
  HOME_WORKSPACE_SLUG,
  PERSONAL_ORG_SLUG,
  WORK_PRODUCT_MODES,
  type MembershipRole,
  type TenantContext,
} from "@agentforge/core";
import type { Database } from "./client";
import { organizationMembers, organizations, user, workspaceMembers, workspaces } from "./schema";
import { ensureTenant, getTenantById } from "./tenants";

/** The three ids a verified browser session carries. All minted by the portal, never here. */
export type PortalIdentity = {
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
};

/**
 * Why a session could not be turned into a tenant. Each maps to an existing reason code in
 * `packages/host/src/auth/session.ts`, so the renderer localises it with the copy it already has.
 */
export type PortalResolveFailure = "tenant_inactive" | "org_inactive" | "user_inactive" | "workspace_not_found";

/** A sign-in that cannot be provisioned. Never a fall back to another tenant's rows. */
export class PortalProvisionError extends Error {
  constructor(readonly code: "org_tenant_mismatch") {
    super(code);
    this.name = "PortalProvisionError";
  }
}

export type PortalResolution =
  | { readonly ok: true; readonly tenant: TenantContext }
  | { readonly ok: false; readonly code: PortalResolveFailure };

/**
 * The portal sends ids, not display names or slugs (`auth/portal-client.ts` — the token body is
 * `tenant_id` / `org_id` / `user_id` and nothing else). A slug is a NOT NULL unique column, so it is
 * derived from the id, which is unique by construction. When the portal starts returning a name
 * these become the fallback rather than the only value; nothing user-facing depends on them today.
 */
function slugForId(prefix: string, id: string): string {
  const cleaned = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${prefix}-${cleaned.length > 0 ? cleaned : "unknown"}`;
}

/**
 * `user.email` is NOT NULL and globally unique (`schema.ts:18`). Spec §3a: key users on the portal
 * `user_id` and stop relying on email uniqueness — the host never authenticates on an address, only
 * the portal does. So the row is keyed on the portal id and carries a placeholder address that is
 * unique by construction and cannot collide with a real one (`.invalid` is reserved by RFC 2606).
 * A real address, when the portal starts sending one, is an update to this row, not a new key.
 */
function placeholderEmail(userId: string): string {
  return `${encodeURIComponent(userId)}@portal.invalid`;
}

/**
 * Write the host's rows for a portal identity, idempotently: tenant, org, user, the two memberships
 * and a home desk. Safe to call on every sign-in; the second call reads and returns.
 */
export async function ensurePortalOwner(db: Database, identity: PortalIdentity): Promise<TenantContext> {
  await ensureTenant(db, {
    id: identity.tenantId,
    slug: slugForId("tenant", identity.tenantId),
    name: identity.tenantId,
  });

  let [org] = await db.select().from(organizations).where(eq(organizations.id, identity.orgId)).limit(1);
  if (!org) {
    const inserted = await db
      .insert(organizations)
      .values({
        id: identity.orgId,
        tenantId: identity.tenantId,
        name: identity.orgId,
        slug: slugForId(PERSONAL_ORG_SLUG, identity.orgId),
        industryPack: "generic",
      })
      .returning();
    org = inserted[0];
  }
  if (org.tenantId !== identity.tenantId) {
    // The portal moved an org between tenants, or two portals disagree. Never silently re-home a row
    // that already carries another tenant's data: the sign-in turns this into `org_inactive`.
    throw new PortalProvisionError("org_tenant_mismatch");
  }

  const [existingUser] = await db.select().from(user).where(eq(user.id, identity.userId)).limit(1);
  if (!existingUser) {
    await db.insert(user).values({
      id: identity.userId,
      name: identity.userId,
      email: placeholderEmail(identity.userId),
      emailVerified: false,
    });
  }

  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, identity.userId)))
    .limit(1);
  if (!membership) {
    // The portal has no role claim in the token body yet (open question in the lane C notes), so the
    // first and every signed-in user owns their own org, which is what the desktop already assumes.
    await db.insert(organizationMembers).values({
      organizationId: org.id,
      userId: identity.userId,
      role: "owner",
    });
  }

  let ownedWorkspaces = await db.select().from(workspaces).where(eq(workspaces.organizationId, org.id));
  if (ownedWorkspaces.length === 0) {
    ownedWorkspaces = await db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: HOME_WORKSPACE_NAME,
        slug: HOME_WORKSPACE_SLUG,
        productModes: [...WORK_PRODUCT_MODES],
      })
      .returning();
  }
  const home = ownedWorkspaces.find((row) => row.slug === HOME_WORKSPACE_SLUG) ?? ownedWorkspaces[0];

  const [deskMembership] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, home.id), eq(workspaceMembers.userId, identity.userId)))
    .limit(1);
  if (!deskMembership) {
    await db.insert(workspaceMembers).values({
      workspaceId: home.id,
      organizationId: org.id,
      userId: identity.userId,
      role: "owner",
    });
  }

  return {
    tenantId: org.tenantId,
    organizationId: org.id,
    workspaceId: home.id,
    userId: identity.userId,
    role: "owner",
  };
}

/**
 * Turn a verified session into a `TenantContext`, reading only.
 *
 * `preferredWorkspaceId` is the `WORKSPACE_COOKIE` the browser sent, which is entirely
 * client-supplied. Spec §3d: on the hosted server a desk the session's org does not own is
 * `workspace_not_found` — **never** the silent substitution `pickWorkspaceId` does on the desktop,
 * which would mask a real bug and tell a prober nothing about which ids exist.
 */
export async function resolvePortalTenant(
  db: Database,
  identity: PortalIdentity,
  preferredWorkspaceId?: string | null,
): Promise<PortalResolution> {
  const tenant = await getTenantById(db, identity.tenantId);
  if (tenant?.status !== "active") {
    return { ok: false, code: "tenant_inactive" };
  }

  // The org is pinned to the session's tenant in the same WHERE, so an org id from another tenant
  // cannot resolve even if the session's two ids are mixed from different sessions.
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, identity.orgId), eq(organizations.tenantId, identity.tenantId)))
    .limit(1);
  if (!org) {
    return { ok: false, code: "org_inactive" };
  }

  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, org.id), eq(organizationMembers.userId, identity.userId)))
    .limit(1);
  if (!membership) {
    return { ok: false, code: "user_inactive" };
  }

  const desks = await db.select().from(workspaces).where(eq(workspaces.organizationId, org.id));
  if (desks.length === 0) {
    return { ok: false, code: "workspace_not_found" };
  }
  const preferred = preferredWorkspaceId?.trim();
  if (preferred && !desks.some((desk) => desk.id === preferred)) {
    return { ok: false, code: "workspace_not_found" };
  }
  const home = desks.find((desk) => desk.slug === HOME_WORKSPACE_SLUG) ?? desks[0];

  return {
    ok: true,
    tenant: {
      tenantId: org.tenantId,
      organizationId: org.id,
      workspaceId: preferred || home.id,
      userId: identity.userId,
      role: membership.role as MembershipRole,
    },
  };
}
