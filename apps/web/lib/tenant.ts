import { cookies } from "next/headers";
import { db, DrizzleAgentRepository, ensureLocalOwner } from "@agentforge/db";
import { AgentService, WORKSPACE_COOKIE, type TenantContext } from "@agentforge/core";

export const agentService = new AgentService(new DrizzleAgentRepository(db));

export async function getTenant(): Promise<TenantContext> {
  const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  return ensureLocalOwner(db, preferred);
}
