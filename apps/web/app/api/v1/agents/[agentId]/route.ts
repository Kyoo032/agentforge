import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { agentService, getTenant } from "@/lib/tenant";
import { DrizzleAgentRepository, db } from "@agentforge/db";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { agentId } = await context.params;
    const agent = await agentService.get(tenant, agentId);
    if (!agent) {
      return NextResponse.json({ error: { code: "not_found", message: "Agent not found" } }, { status: 404 });
    }
    const repo = new DrizzleAgentRepository(db);
    const versions = await repo.listVersions(tenant.organizationId, agentId);
    const publishedBindings = agent.currentVersionId
      ? await repo.listBindings(tenant.organizationId, agent.currentVersionId)
      : [];
    const latest = versions.sort((a, b) => b.version - a.version)[0];
    const draftBindings = latest ? await repo.listBindings(tenant.organizationId, latest.id) : [];
    return NextResponse.json({ agent, versions, publishedBindings, draftBindings });
  } catch (error) {
    return jsonError(error);
  }
}
