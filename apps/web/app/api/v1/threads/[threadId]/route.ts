import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { getThread, listMessages } from "@/lib/threads";

type RouteContext = { params: Promise<{ threadId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { threadId } = await context.params;
    const thread = await getThread(tenant, threadId);
    if (!thread) {
      return NextResponse.json({ error: { code: "not_found", message: "Thread not found" } }, { status: 404 });
    }
    const messages = await listMessages(tenant, threadId);
    return NextResponse.json({ thread, messages });
  } catch (error) {
    return jsonError(error);
  }
}
