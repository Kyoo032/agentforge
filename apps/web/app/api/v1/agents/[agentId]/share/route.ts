import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { agentService, getTenant } from "@/lib/tenant";
import type { Visibility } from "@agentforge/core";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { agentId } = await context.params;
    const body = await request.json();
    const visibility = body.visibility as Visibility;
    const agent = await agentService.share(tenant, agentId, visibility);
    return NextResponse.json({ agent });
  } catch (error) {
    return jsonError(error);
  }
}
