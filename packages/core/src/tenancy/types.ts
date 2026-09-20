export const MEMBERSHIP_ROLES = ["owner", "admin", "builder", "member"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const INDUSTRY_PACKS = ["university", "generic"] as const;
export type IndustryPack = (typeof INDUSTRY_PACKS)[number];

export const VISIBILITIES = ["private", "workspace"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const INPUT_MODALITIES = ["text", "image", "video"] as const;
export type InputModality = (typeof INPUT_MODALITIES)[number];

export type TenantContext = {
  /** The whitelabel partner the row belongs to. `LOCAL_TENANT_ID` on desktop and webdev. */
  tenantId: string;
  organizationId: string;
  workspaceId: string;
  userId: string;
  role: MembershipRole;
};

export function requireTenant(tenant: TenantContext | null | undefined): TenantContext {
  if (!tenant) {
    throw new Error("tenant_required");
  }
  return tenant;
}

export function canBuild(role: MembershipRole): boolean {
  return role === "owner" || role === "admin" || role === "builder";
}

export function canAdminister(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}
