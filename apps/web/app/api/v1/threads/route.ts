import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { agentService, getTenant } from "@/lib/tenant";
import { createThread, listWorkspaceThreads, type WorkspaceThreadScope } from "@/lib/threads";
import { ApiError, isDefaultChatAgent } from "@agentforge/core";
import { DEFAULT_THREAD_TITLE } from "@/lib/thread-title";

function parseScope(value: string | null): WorkspaceThreadScope {
  if (value === "chat" || value === "agent") {
    return value;
  }
  return "all";
}

export async function GET(request: Request) {
  try {
    const tenant = await getTenant();
    const url = new URL(request.url);
    const scope = parseScope(url.searchParams.get("scope"));
    const agentId = url.searchParams.get("agentId") ?? undefined;
    if (scope === "agent" && agentId) {
      const agent = await agentService.get(tenant, agentId);
      if (!agent) {
        throw new ApiError("not_found", "Agent not found", 404);
      }
    }
    const rows = await listWorkspaceThreads(tenant, { scope, agentId });
    return NextResponse.json({
      threads: rows
        .filter((row) => row.title !== DEFAULT_THREAD_TITLE)
        .map((row) => ({
          id: row.id,
          title: row.title,
          agentId: row.agentId,
          agentName: row.agentName,
          createdAt: row.createdAt,
          isDefaultChat: isDefaultChatAgent({ slug: row.agentSlug }),
        })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const tenant = await getTenant();
    const body = await request.json();
    const agent = await agentService.get(tenant, body.agentId);
    if (!agent) {
      throw new ApiError("not_found", "Agent not found", 404);
    }
    const thread = await createThread(tenant, agent.id, body.title);
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
