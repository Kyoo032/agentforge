import { db, DrizzleAgentRepository, ensureLocalOwner } from "@agentforge/db";
import { AgentService, type TenantContext } from "@agentforge/core";
import { readSelectedWorkspaceId } from "./workspace";

export const agentService = new AgentService(new DrizzleAgentRepository(db));

export async function getTenant(preferredWorkspaceId?: string | null): Promise<TenantContext> {
  const preferred = preferredWorkspaceId?.trim() || readSelectedWorkspaceId();
  return ensureLocalOwner(db, preferred);
}
