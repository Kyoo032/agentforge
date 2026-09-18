import { ApiError } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { requireGatewayAllowed } from "../gateway-gate";
import { loadSettings } from "../settings-store";
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
import { backendPayload, parseBackendId, selectKnowledgeBackend } from "../knowledge/backend-api";
import { countRetrievals } from "../knowledge-retrievals";
import { getGraph, graphCounts } from "../knowledge-graph";
import { reindexSource, reindexWorkspace } from "../knowledge-reindex";
import {
  getKnowledgeVerify,
  runKnowledgeSelfCheck,
  type KnowledgeVerifyRecord,
} from "../knowledge-verify";
import { upsertWorkSource } from "../knowledge-ingest";
import { requireArtifact } from "../artifacts";
import { getThread } from "../threads";
import { artifactWorkCard } from "../work-cards";

/**
 * "Send to Knowledge Base" labels → the work type to file the card under when the artifact's own
 * mode does not name a desk. Only a fallback: labels are shared between desks (Market and Finance
 * studios both send `Brief`), so `workTypeForArtifact` asks the artifact first.
 */
const KB_TYPE_TO_WORK: Partial<Record<PastedSourceType, ArtifactWorkType | null>> = {
  Dossier: "Research",
  Analysis: "Data",
  Brief: "Finance",
  Memo: "Legal",
  Playbook: "Legal",
  Paste: null,
};

type ArtifactWorkType = Extract<
  WorkSourceType,
  "Research" | "Data" | "Finance" | "Market" | "Documents" | "Presentation" | "Legal"
>;

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
  const type = workTypeForArtifact(artifact.mode, kbType);
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

/**
 * The work type a saved artifact's card is filed under. The artifact's mode is authoritative — a
 * Market briefing and a Finance brief both reach here labelled `Brief`, and filing the briefing as
 * `Finance` told every later Chat retrieval it was a finance brief. The label map only answers for
 * an artifact whose mode names no desk.
 */
export function workTypeForArtifact(mode: string, kbType: PastedSourceType): ArtifactWorkType {
  return artifactModeToWork(mode) ?? KB_TYPE_TO_WORK[kbType] ?? "Documents";
}

/** `null` when the mode names no desk, so the caller can fall back to the label the studio sent. */
function artifactModeToWork(mode: string): ArtifactWorkType | null {
  switch (mode) {
    case "research":
      return "Research";
    case "data":
      return "Data";
    case "finance":
      return "Finance";
    case "market":
      return "Market";
    case "legal":
      return "Legal";
    case "presentations":
      return "Presentation";
    case "documents":
      return "Documents";
    default:
      return null;
  }
}

export async function handleGetKnowledge(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk({
      soul: getSoul(tenant),
      memories: listMemories(tenant),
      sources: (sweepOrphanThreadSources(tenant), drainOnRead(tenant), listSources(tenant)),
      models: getKnowledgeModels(tenant),
      map: getKnowledgeMap(tenant),
      // Retrieved stage of the knowledge loop: chunks this workspace has been served, all time.
      retrievals: countRetrievals(tenant),
      // Graph and Verified stages. Counts only — the graph itself is GET /api/v1/knowledge/graph,
      // so the page that only draws the loop chart never pays for the node list.
      graph: graphCounts(tenant),
      verified: getKnowledgeVerify(tenant),
      // Which engine answers this desk, and what it still owes. Health is reported only when the
      // sidecar is already up, so rendering the page never triggers a cold start.
      backend: await backendPayload(tenant),
    });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Replay anything the retrieval backend still owes, without making the read wait for it. The
 * Knowledge page is the one screen that is opened after a sidecar comes back, so it is the natural
 * place to notice — but a drain that is slow or failing must not slow the page down.
 */
function drainOnRead(_tenant: { workspaceId: string }): void {
  // Sidecar outbox is gone.
}

/** Builtin retrieval engine. `400` if a sidecar id is sent. */
export async function handlePutKnowledgeBackend(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk(await selectKnowledgeBackend(tenant, parseBackendId(request.body)));
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Start (or resume) a backfill of every source the selected backend does not hold yet. Answers
 * immediately with how much work was queued; progress shows up as `backend.outbox` falling on
 * later reads of `GET /api/v1/knowledge`.
 */
export async function handlePostKnowledgeBackendReindex(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
    return jsonOk(await reindexWorkspace(tenant));
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Explicit re-index of one source for the built-in engine: re-read the stored body, run the
 * current chunker, replace chunks and vectors together. A source that cannot produce a body is a
 * 200 with a `Failed` outcome — the row records why, and `addFileSource` set the precedent.
 * `404` only when the id is not this workspace's (or was deleted mid-call).
 */
export async function handlePostKnowledgeSourceReindex(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
    const outcome = await reindexSource(tenant, request.params.sourceId);
    if (outcome.status === "missing") {
      throw new ApiError("not_found", "Source not found", 404);
    }
    return jsonOk(outcome);
  } catch (error) {
    return jsonError(error);
  }
}

/** Re-index every `Indexed` source of one workspace; answers with the per-source outcomes. */
export async function handlePostKnowledgeReindex(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
    return jsonOk(await reindexWorkspace(tenant));
  } catch (error) {
    return jsonError(error);
  }
}

/** The knowledge graph for drawing: highest-degree nodes first, edges wholly inside that set. */
export async function handleGetKnowledgeGraph(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const raw = typeof request.query.limit === "string" ? Number.parseInt(request.query.limit, 10) : Number.NaN;
    const limit = Number.isFinite(raw) && raw > 0 ? raw : undefined;
    return jsonOk(getGraph(tenant, { limit }));
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * How close together two self-checks of one workspace may run. The check plants a real source,
 * retrieves it and deletes it again, so a held button — or a page that re-mounts in a loop — would
 * otherwise churn the live knowledge base as fast as the endpoint answers.
 */
export const SELF_CHECK_MIN_INTERVAL_MS = 10_000;

/**
 * The stored record when it is young enough to serve as-is, otherwise null (run a fresh check).
 * A record stamped in the future — the clock moved backwards — is never considered fresh, or a
 * workspace could be locked out of checking itself for as long as the skew lasts.
 */
export function throttledSelfCheck(
  recent: KnowledgeVerifyRecord | null,
  now: number,
): KnowledgeVerifyRecord | null {
  if (!recent || recent.at > now) {
    return null;
  }
  return now - recent.at < SELF_CHECK_MIN_INTERVAL_MS ? recent : null;
}

/**
 * Run the planted-fact self-check now. Answers with the record it wrote; a failed check is a 200,
 * and so is a throttled one — the caller gets the last real result, flagged as not freshly run.
 */
export async function handlePostKnowledgeVerify(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
    const recent = throttledSelfCheck(getKnowledgeVerify(tenant), Date.now());
    if (recent) {
      return jsonOk({ ...recent, throttled: true });
    }
    return jsonOk({ ...(await runKnowledgeSelfCheck(tenant)), throttled: false });
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
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
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
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
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
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
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
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
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
