import { NextResponse } from "next/server";
import { DEFAULT_CHAT_MODEL } from "@agentforge/core";
import { jsonError } from "@/lib/http";
import { agentService, getTenant } from "@/lib/tenant";
import { listSelectableModels } from "@/lib/selectable-models";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { workspaceId } = await context.params;
    if (workspaceId !== tenant.workspaceId) {
      return NextResponse.json({ error: { code: "not_found", message: "Workspace not found" } }, { status: 404 });
    }
    const agents = await agentService.list(tenant);
    return NextResponse.json({ agents });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { workspaceId } = await context.params;
    if (workspaceId !== tenant.workspaceId) {
      return NextResponse.json({ error: { code: "not_found", message: "Workspace not found" } }, { status: 404 });
    }
    const body = await request.json();
    const created = await agentService.create(
      tenant,
      {
        name: body.name,
        description: body.description,
        systemPrompt: body.systemPrompt,
        model: body.model ?? DEFAULT_CHAT_MODEL,
        inputModalities: body.inputModalities,
        visibility: body.visibility,
      },
      listSelectableModels(),
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
