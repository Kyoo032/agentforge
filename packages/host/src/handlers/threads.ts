import { ApiError, isDefaultChatAgent } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { agentService, getTenant } from "../tenant";
import { createThread, deleteThread, getThread, listMessages, listWorkspaceThreads, type WorkspaceThreadScope } from "../threads";
import { isDefaultThreadTitle, THREAD_TITLE_MAX } from "../thread-title";

function parseScope(value: string | undefined): WorkspaceThreadScope {
  if (value === "chat" || value === "agent") {
    return value;
  }
  return "all";
}

export async function handleGetThreads(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const scope = parseScope(request.query.scope);
    const agentId = request.query.agentId || undefined;
    if (scope === "agent" && agentId) {
      const agent = await agentService.get(tenant, agentId);
      if (!agent) {
        throw new ApiError("not_found", "Agent not found", 404);
      }
    }
    const rows = await listWorkspaceThreads(tenant, { scope, agentId });
    return jsonOk({
      threads: rows
        .filter((row) => !isDefaultThreadTitle(row.title))
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

export async function handlePostThreads(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = (request.body ?? {}) as { agentId?: unknown; title?: unknown };
    if (body.agentId !== undefined && typeof body.agentId !== "string") {
      throw new ApiError("invalid_request", "agentId must be a string", 400);
    }
    if (body.title !== undefined && typeof body.title !== "string") {
      throw new ApiError("invalid_request", "title must be a string", 400);
    }
    const agent = await agentService.get(tenant, body.agentId ?? "");
    if (!agent) {
      throw new ApiError("not_found", "Agent not found", 404);
    }
    const title = typeof body.title === "string" ? body.title.trim().slice(0, THREAD_TITLE_MAX) : undefined;
    const thread = await createThread(tenant, agent.id, title || undefined);
    return jsonOk({ thread }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetThread(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const threadId = request.params.threadId;
    const thread = await getThread(tenant, threadId);
    if (!thread) {
      return jsonOk({ error: { code: "not_found", message: "Thread not found" } }, 404);
    }
    const messages = await listMessages(tenant, threadId);
    return jsonOk({ thread, messages });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleDeleteThread(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const deleted = await deleteThread(tenant, request.params.threadId);
    if (!deleted) {
      throw new ApiError("not_found", "Thread not found", 404);
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
