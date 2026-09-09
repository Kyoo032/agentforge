import { db, DrizzleAgentRepository, ensureLocalOwner, listLocalWorkspaces } from "@agentforge/db";
import { AgentService, HOME_WORKSPACE_SLUG, type TenantContext } from "@agentforge/core";
import { readSelectedWorkspaceId } from "./workspace";
import { adoptLegacySettings } from "./settings-store";

export const agentService = new AgentService(new DrizzleAgentRepository(db));

export async function getTenant(preferredWorkspaceId?: string | null): Promise<TenantContext> {
  const preferred = preferredWorkspaceId?.trim() || readSelectedWorkspaceId();
  const tenant = await ensureLocalOwner(db, preferred);
  const rows = await listLocalWorkspaces(db, tenant.organizationId);
  const home = rows.find((row) => row.slug === HOME_WORKSPACE_SLUG) ?? rows[0];
  if (home) {
    adoptLegacySettings(home.id);
  }
  return tenant;
}
