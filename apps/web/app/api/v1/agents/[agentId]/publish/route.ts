import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { revalidateAppShell } from "@/lib/revalidate-shell";
import { agentService, getTenant } from "@/lib/tenant";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { agentId } = await context.params;
    const body = await request.json();
    const agent = await agentService.publish(tenant, agentId, body.versionId);
    revalidateAppShell();
    return NextResponse.json({ agent });
  } catch (error) {
    return jsonError(error);
  }
}
