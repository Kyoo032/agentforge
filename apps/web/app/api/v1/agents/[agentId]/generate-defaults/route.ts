import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { revalidateAppShell } from "@/lib/revalidate-shell";
import { agentService, getTenant } from "@/lib/tenant";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { agentId } = await context.params;
    const body = await request.json().catch(() => null);
    const patch =
      body && typeof body === "object"
        ? {
            imageGenModel:
              "imageGenModel" in body ? ((body as { imageGenModel?: string | null }).imageGenModel ?? null) : undefined,
            videoGenModel:
              "videoGenModel" in body ? ((body as { videoGenModel?: string | null }).videoGenModel ?? null) : undefined,
          }
        : {};
    const version = await agentService.updateGenerateDefaults(tenant, agentId, patch);
    revalidateAppShell();
    return NextResponse.json({ version });
  } catch (error) {
    return jsonError(error);
  }
}
