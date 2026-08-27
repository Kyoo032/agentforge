import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { startModalityRun } from "@/lib/runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

type RouteContext = { params: Promise<{ threadId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { threadId } = await context.params;
    const body = await request.json();
    return await startModalityRun({ tenant, threadId, modality: "video", body });
  } catch (error) {
    return jsonError(error);
  }
}
