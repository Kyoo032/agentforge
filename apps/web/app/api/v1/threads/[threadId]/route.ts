import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { deleteThread, getThread, listMessages } from "@/lib/threads";
import { ApiError } from "@agentforge/core";

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

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { threadId } = await context.params;
    const deleted = await deleteThread(tenant, threadId);
    if (!deleted) {
      throw new ApiError("not_found", "Thread not found", 404);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
