import { NextResponse } from "next/server";
import { getTool } from "@agentforge/core";
import { jsonError } from "@/lib/http";
import { agentService, getTenant } from "@/lib/tenant";
import { DrizzleAgentRepository, db } from "@agentforge/db";
import { ApiError } from "@agentforge/core";
import { ensureToolsRegistered } from "@/lib/register-tools";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    ensureToolsRegistered();
    const tenant = await getTenant();
    const { agentId } = await context.params;
    const body = await request.json();
    if (!getTool(body.toolKey)) {
      throw new ApiError("not_found", "Tool not found", 404);
    }
    const repo = new DrizzleAgentRepository(db);
    const versions = await repo.listVersions(tenant.organizationId, agentId);
    const latest = versions.sort((a, b) => b.version - a.version)[0];
    if (!latest) {
      throw new ApiError("not_found", "Version not found", 404);
    }
    const binding = await agentService.bindTool(tenant, agentId, latest.id, body.toolKey);
    return NextResponse.json({ binding }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
