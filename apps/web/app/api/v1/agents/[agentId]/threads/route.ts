import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { listThreads } from "@/lib/threads";

export async function GET(request: Request) {
  try {
    const tenant = await getTenant();
    const agentId = new URL(request.url).searchParams.get("agentId");
    if (!agentId) {
      return NextResponse.json({ error: { code: "invalid_content_part", message: "agentId required" } }, { status: 400 });
    }
    const threads = await listThreads(tenant, agentId);
    return NextResponse.json({ threads });
  } catch (error) {
    return jsonError(error);
  }
}
