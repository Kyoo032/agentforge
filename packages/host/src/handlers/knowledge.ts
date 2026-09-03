import { ApiError } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import {
  addFileSource,
  addMemory,
  addPastedSource,
  addUrlSource,
  deleteMemory,
  deleteSource,
  getSoul,
  knowledgeInjection,
  listMemories,
  listSources,
  putSoul,
} from "../knowledge";

export async function handleGetKnowledge(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk({
      soul: getSoul(tenant),
      memories: listMemories(tenant),
      sources: listSources(tenant),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetKnowledgeContext(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const query = typeof request.query.query === "string" ? request.query.query : "";
    return jsonOk(knowledgeInjection(tenant, query));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePutKnowledgeSoul(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const body = (request.body ?? {}) as { name?: unknown; role?: unknown; voice?: unknown; rules?: unknown };
    const rules = Array.isArray(body.rules) ? body.rules.filter((item): item is string => typeof item === "string") : [];
    return jsonOk(
      putSoul(tenant, {
        name: typeof body.name === "string" ? body.name : "",
        role: typeof body.role === "string" ? body.role : "",
        voice: typeof body.voice === "string" ? body.voice : "",
        rules,
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostKnowledgeMemory(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const body = (request.body ?? {}) as { text?: unknown; pinned?: unknown };
    if (typeof body.text !== "string") {
      throw new ApiError("invalid_request", "text is required", 400);
    }
    return jsonOk(addMemory(tenant, body.text, body.pinned === true), 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleDeleteKnowledgeMemory(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    deleteMemory(tenant, request.params.memoryId);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostKnowledgeSource(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const file = request.files?.find((item) => item.field === "file") ?? request.files?.[0];
    if (file) {
      return jsonOk(await addFileSource(tenant, file), 201);
    }
    const body = (request.body ?? {}) as { name?: unknown; text?: unknown };
    if (typeof body.text === "string") {
      return jsonOk(addPastedSource(tenant, typeof body.name === "string" ? body.name : "Pasted notes", body.text), 201);
    }
    throw new ApiError("invalid_request", "file or text is required", 400);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostKnowledgeSourceUrl(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const url = request.body && typeof request.body === "object" ? (request.body as { url?: unknown }).url : undefined;
    if (typeof url !== "string") {
      throw new ApiError("invalid_request", "url is required", 400);
    }
    return jsonOk(await addUrlSource(tenant, url), 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleDeleteKnowledgeSource(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    deleteSource(tenant, request.params.sourceId);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
