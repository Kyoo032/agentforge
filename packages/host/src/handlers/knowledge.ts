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
  findSourceByOrigin,
  getKnowledgeModels,
  getSoul,
  knowledgeInjection,
  listMemories,
  listSources,
  pastedSourceType,
  sweepOrphanThreadSources,
  putKnowledgeModels,
  putSoul,
  type PastedSourceType,
  type WorkSourceType,
} from "../knowledge";
import { getKnowledgeMap, mapKnowledge } from "../knowledge-map";
import { countRetrievals } from "../knowledge-retrievals";
import { upsertWorkSource } from "../knowledge-ingest";
import { requireArtifact } from "../artifacts";
import { getThread } from "../threads";
import { artifactWorkCard } from "../work-cards";

/** "Send to Knowledge Base" labels → the work type the auto-ingest loop writes for that artifact. */
const KB_TYPE_TO_WORK: Partial<Record<PastedSourceType, Extract<WorkSourceType, "Research" | "Data" | "Finance"> | null>> = {
  Dossier: "Research",
  Analysis: "Data",
  Brief: "Finance",
  Paste: null,
};

/**
 * Send to Knowledge Base for a saved artifact. Idempotent against the auto-ingest origin: if the
 * job already wrote that artifact's card, answer with it (200, `alreadyIndexed`) instead of a copy.
 */
async function sendArtifactToKnowledge(
  tenant: Awaited<ReturnType<typeof getTenant>>,
  artifactId: string,
  kbType: PastedSourceType,
): Promise<HostResult> {
  const existing = findSourceByOrigin(tenant, { kind: "artifact", id: artifactId });
  if (existing) {
    return jsonOk({ ...existing, alreadyIndexed: true }, 200);
  }
  const artifact = requireArtifact(tenant, artifactId);
  const type = KB_TYPE_TO_WORK[kbType] ?? artifactModeToWork(artifact.mode);
  const result = await upsertWorkSource(
    tenant,
    artifactWorkCard({
      type,
      artifactId,
      title: artifact.title,
      prompt: typeof artifact.meta.question === "string" ? artifact.meta.question : undefined,
      markdown: artifact.body,
      model: typeof artifact.meta.model === "string" ? artifact.meta.model : undefined,
    }),
  );
  if (result.status === "skipped") {
    throw new ApiError("invalid_request", "That artifact has no text to index", 400);
  }
  return jsonOk({ ...result.source, alreadyIndexed: false }, result.status === "indexed" ? 201 : 200);
}

function artifactModeToWork(mode: string): Extract<WorkSourceType, "Research" | "Data" | "Finance" | "Documents" | "Presentation"> {
  switch (mode) {
    case "research":
      return "Research";
    case "data":
      return "Data";
    case "finance":
      return "Finance";
    case "presentations":
      return "Presentation";
    default:
      return "Documents";
  }
}

export async function handleGetKnowledge(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk({
      soul: getSoul(tenant),
      memories: listMemories(tenant),
      sources: (sweepOrphanThreadSources(tenant), listSources(tenant)),
      models: getKnowledgeModels(tenant),
      map: getKnowledgeMap(tenant),
      // Retrieved stage of the knowledge loop: chunks this workspace has been served, all time.
      retrievals: countRetrievals(tenant),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePutKnowledgeModels(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const body = (request.body ?? {}) as {
      embeddingModel?: unknown;
      brainModel?: unknown;
      verifierModel?: unknown;
    };
    return jsonOk(
      putKnowledgeModels(tenant, {
        embeddingModel: typeof body.embeddingModel === "string" ? body.embeddingModel : undefined,
        brainModel: typeof body.brainModel === "string" ? body.brainModel : undefined,
        verifierModel: typeof body.verifierModel === "string" ? body.verifierModel : undefined,
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostKnowledgeMap(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const body = (request.body ?? {}) as {
      embeddingModel?: unknown;
      brainModel?: unknown;
      verifierModel?: unknown;
    };
    return jsonOk(
      await mapKnowledge(tenant, {
        embeddingModel: typeof body.embeddingModel === "string" ? body.embeddingModel : undefined,
        brainModel: typeof body.brainModel === "string" ? body.brainModel : undefined,
        verifierModel: typeof body.verifierModel === "string" ? body.verifierModel : undefined,
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetKnowledgeContext(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const query = typeof request.query.query === "string" ? request.query.query : "";
    const threadId = typeof request.query.threadId === "string" ? request.query.threadId.trim() : "";
    // Only the caller's own thread (workspace-scoped lookup) can be excluded from its Sources.
    const own = threadId ? await getThread(tenant, threadId) : null;
    // `chunks` stays server-side (it is the retrieval record); the popover payload is unchanged.
    const { prompt, parts } = await knowledgeInjection(tenant, query, own ? { excludeThreadId: own.id } : {});
    return jsonOk({ prompt, parts });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePutKnowledgeSoul(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const body = (request.body ?? {}) as { name?: unknown; role?: unknown; voice?: unknown; rules?: unknown };
    const rules = Array.isArray(body.rules)
      ? body.rules.filter((item): item is string => typeof item === "string")
      : [];
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
    const body = (request.body ?? {}) as { name?: unknown; text?: unknown; type?: unknown; artifactId?: unknown };
    if (typeof body.artifactId === "string" && body.artifactId.trim()) {
      return await sendArtifactToKnowledge(tenant, body.artifactId.trim(), pastedSourceType(body.type));
    }
    if (typeof body.text === "string") {
      if (!body.text.trim()) {
        throw new ApiError("invalid_request", "text is empty", 400);
      }
      return jsonOk(
        await addPastedSource(
          tenant,
          typeof body.name === "string" ? body.name : "Pasted notes",
          body.text,
          pastedSourceType(body.type),
        ),
        201,
      );
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
