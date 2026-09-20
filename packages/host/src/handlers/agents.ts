import { DEFAULT_CHAT_MODEL, isDefaultChatAgent, RUN_PATHS, getTool, ApiError } from "@agentforge/core";
import { DrizzleAgentRepository, db } from "@agentforge/db";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { agentService, getTenant } from "../tenant";
import { defaultSelectableModel, listSelectableModels } from "../selectable-models";
import { ensureToolsRegistered } from "../register-tools";
import { listThreads } from "../threads";
import type { InputModality, Visibility } from "@agentforge/core";

export async function handleGetAgent(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const agentId = request.params.agentId;
    const agent = await agentService.get(tenant, agentId);
    if (!agent) {
      return jsonOk({ error: { code: "not_found", message: "Agent not found" } }, 404);
    }
    const repo = new DrizzleAgentRepository(db);
    const versions = await repo.listVersions(tenant.organizationId, agentId);
    const publishedBindings = agent.currentVersionId
      ? await repo.listBindings(tenant.organizationId, agent.currentVersionId)
      : [];
    const latest = versions.sort((a, b) => b.version - a.version)[0];
    const draftBindings = latest ? await repo.listBindings(tenant.organizationId, latest.id) : [];
    return jsonOk({
      agent,
      versions,
      publishedBindings,
      draftBindings,
      isDefaultChat: isDefaultChatAgent(agent),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetAgentCapabilities(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const agentId = request.params.agentId;
    const agent = await agentService.get(tenant, agentId);
    if (!agent) {
      return jsonOk({ error: { code: "not_found", message: "Agent not found" } }, 404);
    }
    const published = agent.currentVersionId
      ? await agentService.getPublishedForRun(tenant, agentId)
      : null;
    return jsonOk({
      inputModalities: published?.version.inputModalities ?? ["text"],
      model: isDefaultChatAgent(agent)
        ? defaultSelectableModel()
        : (published?.version.model ?? DEFAULT_CHAT_MODEL),
      published: Boolean(agent.currentVersionId),
      runPaths: RUN_PATHS,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostAgentTools(request: HostRequest): Promise<HostResult> {
  try {
    ensureToolsRegistered();
    const tenant = await getTenant(request);
    const agentId = request.params.agentId;
    const body = (request.body ?? {}) as { toolKey?: string };
    if (!getTool(body.toolKey ?? "")) {
      throw new ApiError("not_found", "Tool not found", 404);
    }
    const repo = new DrizzleAgentRepository(db);
    const versions = await repo.listVersions(tenant.organizationId, agentId);
    const latest = versions.sort((a, b) => b.version - a.version)[0];
    if (!latest) {
      throw new ApiError("not_found", "Version not found", 404);
    }
    const binding = await agentService.bindTool(tenant, agentId, latest.id, body.toolKey ?? "");
    return jsonOk({ binding }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostAgentSoul(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
    const { version } = await agentService.createRevision(tenant, request.params.agentId, {
      systemPrompt: typeof body.systemPrompt === "string" ? body.systemPrompt : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      inputModalities: Array.isArray(body.inputModalities) ? (body.inputModalities as InputModality[]) : undefined,
      toolKeys: Array.isArray(body.toolKeys) ? (body.toolKeys as string[]) : undefined,
    });
    return jsonOk({ version: { id: version.id, version: version.version } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostAgentPublish(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = (request.body ?? {}) as { versionId?: string };
    const agent = await agentService.publish(tenant, request.params.agentId, body.versionId ?? "");
    return jsonOk({ agent });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostAgentShare(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = (request.body ?? {}) as { visibility?: Visibility };
    const agent = await agentService.share(tenant, request.params.agentId, body.visibility as Visibility);
    return jsonOk({ agent });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostAgentProductModes(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = request.body && typeof request.body === "object" ? (request.body as { productModes?: unknown }) : {};
    const version = await agentService.updateProductModes(tenant, request.params.agentId, body.productModes);
    return jsonOk({ version });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostAgentGenerateDefaults(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
    const version = await agentService.updateGenerateDefaults(tenant, request.params.agentId, {
      imageGenModel: "imageGenModel" in body ? ((body.imageGenModel as string | null) ?? null) : undefined,
      videoGenModel: "videoGenModel" in body ? ((body.videoGenModel as string | null) ?? null) : undefined,
      musicGenModel: "musicGenModel" in body ? ((body.musicGenModel as string | null) ?? null) : undefined,
    });
    return jsonOk({ version });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetAgentThreads(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const agentId = request.query.agentId || request.params.agentId;
    if (!agentId) {
      return jsonOk({ error: { code: "invalid_content_part", message: "agentId required" } }, 400);
    }
    const threads = await listThreads(tenant, agentId);
    return jsonOk({ threads });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetWorkspaceAgents(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    if (request.params.workspaceId !== tenant.workspaceId) {
      return jsonOk({ error: { code: "not_found", message: "Workspace not found" } }, 404);
    }
    const agents = await agentService.list(tenant);
    return jsonOk({ agents });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostWorkspaceAgents(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    if (request.params.workspaceId !== tenant.workspaceId) {
      return jsonOk({ error: { code: "not_found", message: "Workspace not found" } }, 404);
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const created = await agentService.create(
      tenant,
      {
        name: body.name as string,
        description: body.description as string | undefined,
        systemPrompt: body.systemPrompt as string | undefined,
        model: (body.model as string | undefined) ?? DEFAULT_CHAT_MODEL,
        inputModalities: body.inputModalities as InputModality[] | undefined,
        productModes: body.productModes as never,
        visibility: body.visibility as never,
        config:
          body.imageGenModel || body.videoGenModel || body.musicGenModel
            ? {
                ...(typeof body.imageGenModel === "string" && body.imageGenModel.trim()
                  ? { imageGenModel: body.imageGenModel.trim() }
                  : {}),
                ...(typeof body.videoGenModel === "string" && body.videoGenModel.trim()
                  ? { videoGenModel: body.videoGenModel.trim() }
                  : {}),
                ...(typeof body.musicGenModel === "string" && body.musicGenModel.trim()
                  ? { musicGenModel: body.musicGenModel.trim() }
                  : {}),
              }
            : undefined,
      },
      listSelectableModels(),
    );
    return jsonOk(created, 201);
  } catch (error) {
    return jsonError(error);
  }
}
