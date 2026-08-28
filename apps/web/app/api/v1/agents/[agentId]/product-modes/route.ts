import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { agentService, getTenant } from "@/lib/tenant";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { agentId } = await context.params;
    const body = await request.json().catch(() => null);
    const productModes = body && typeof body === "object" ? (body as { productModes?: unknown }).productModes : undefined;
    const version = await agentService.updateProductModes(tenant, agentId, productModes);
    return NextResponse.json({ version });
  } catch (error) {
    return jsonError(error);
  }
}
