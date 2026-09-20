export const LOCAL_OWNER_ID = "local-owner";
/**
 * The one tenant every pre-Phase-3 database resolves to. Deterministic, not a UUID: a desktop that
 * has already run migration 0015 and a fresh install must agree on the id, because it is written
 * into `organizations.tenant_id` by the migration and read back by `ensureLocalOwner`.
 */
export const LOCAL_TENANT_ID = "local-tenant";
export const LOCAL_TENANT_SLUG = "local";
export const LOCAL_TENANT_NAME = "Local";
export const PERSONAL_ORG_SLUG = "personal";
export const HOME_WORKSPACE_SLUG = "home";
export const HOME_WORKSPACE_NAME = "Default";
export const LEGACY_HOME_WORKSPACE_NAME = "Home";
export const WORKSPACE_COOKIE = "agentforge_workspace";

export function slugifyWorkspace(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug.length > 0 ? slug : "workspace";
}

export function pickWorkspaceId(
  workspaces: Array<{ id: string; slug: string }>,
  preferredId?: string | null,
): string {
  if (preferredId && workspaces.some((workspace) => workspace.id === preferredId)) {
    return preferredId;
  }
  const home = workspaces.find((workspace) => workspace.slug === HOME_WORKSPACE_SLUG);
  if (home) {
    return home.id;
  }
  if (workspaces[0]) {
    return workspaces[0].id;
  }
  throw new Error("workspace_missing");
}
