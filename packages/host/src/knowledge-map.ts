import {
  ApiError,
  hasLiveProvider,
  knowledgeBrainPrompt,
  knowledgeVerifierPrompt,
  modeMessage,
  parseKnowledgeMap,
  resolveRuntimeMode,
  stubKnowledgeMap,
  withOutputLanguage,
  type KnowledgeMap,
  type KnowledgeModels,
  type TenantContext,
} from "@agentforge/core";
import { sql } from "@agentforge/db";
import { collectJobAssistantText } from "./job-regen";
import { getKnowledgeModels, listSources, putKnowledgeModels } from "./knowledge";
import { reembedWorkspaceChunks } from "./knowledge-embed";
import { projectMapToGraph } from "./knowledge-graph";
import { loadSettings } from "./settings-store";
import { localeForRun } from "./run-context";
import { log } from "./log";

function workspaceId(tenant: TenantContext): string {
  return tenant.workspaceId;
}

export function getKnowledgeMap(tenant: TenantContext): KnowledgeMap | null {
  const row = sql
    .prepare("SELECT payload, status FROM knowledge_maps WHERE workspace_id = ?")
    .get(workspaceId(tenant)) as { payload: string; status: string } | undefined;
  if (!row || row.status !== "Mapped") {
    return null;
  }
  try {
    const parsed = JSON.parse(row.payload) as KnowledgeMap;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveMap(
  tenant: TenantContext,
  status: "Mapped" | "Mapping" | "Failed",
  payload: KnowledgeMap | null,
  error: string | null,
): void {
  sql
    .prepare(
      `INSERT INTO knowledge_maps (workspace_id, payload, status, error, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         payload = excluded.payload,
         status = excluded.status,
         error = excluded.error,
         created_at = excluded.created_at`,
    )
    .run(workspaceId(tenant), JSON.stringify(payload ?? {}), status, error, Date.now());
}

function sourceExcerpts(tenant: TenantContext): Array<{ id: string; name: string; excerpt: string }> {
  const sources = listSources(tenant);
  return sources.map((source) => {
    const row = sql
      .prepare(`SELECT body FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ? LIMIT 1`)
      .get(workspaceId(tenant), source.id) as { body: string } | undefined;
    return {
      id: source.id,
      name: source.name,
      excerpt: row?.body ?? "",
    };
  });
}

export async function mapKnowledge(tenant: TenantContext, overrides?: Partial<KnowledgeModels>): Promise<KnowledgeMap> {
  let models = getKnowledgeModels(tenant);
  if (overrides?.embeddingModel || overrides?.brainModel || overrides?.verifierModel) {
    models = putKnowledgeModels(tenant, {
      embeddingModel: overrides.embeddingModel ?? models.embeddingModel,
      brainModel: overrides.brainModel ?? models.brainModel,
      verifierModel: overrides.verifierModel ?? models.verifierModel,
    });
  }

  saveMap(tenant, "Mapping", null, null);

  try {
    await reembedWorkspaceChunks(tenant, models.embeddingModel);

    const settings = loadSettings(tenant);
    const mode = resolveRuntimeMode({
      settingsHasKey: hasLiveProvider(settings),
      envRuntime: process.env.AGENTFORGE_RUNTIME,
    });

    const sources = listSources(tenant).map((source) => ({ id: source.id, name: source.name }));
    let map: KnowledgeMap | null;

    if (mode === "stub") {
      map = stubKnowledgeMap(sources, models, localeForRun());
    } else {
      const excerpts = sourceExcerpts(tenant);
      const brainRaw = await collectJobAssistantText({
        tenant,
        model: models.brainModel,
        systemPrompt: withOutputLanguage(
          "You organize a local knowledge base. Return JSON only.",
          "knowledge",
          localeForRun(),
        ),
        runPrefix: "knowledge-brain",
        agentId: "knowledge-brain",
        // Nearest studio for the thinking knob; the map is JSON over excerpts, like Research.
        jobMode: "research",
        versionId: "knowledge-brain",
        prompt: knowledgeBrainPrompt(excerpts),
      });
      const draft = parseKnowledgeMap(brainRaw, models, "live");
      if (!draft) {
        throw new ApiError("generation_failed", modeMessage("invalidKnowledgeMap", localeForRun()), 502);
      }
      const evidence = excerpts.map((item) => `[${item.id}] ${item.name}\n${item.excerpt}`).join("\n\n");
      const verifierRaw = await collectJobAssistantText({
        tenant,
        model: models.verifierModel,
        systemPrompt: withOutputLanguage(
          "You verify a knowledge map against source evidence. Return JSON only.",
          "knowledge",
          localeForRun(),
        ),
        runPrefix: "knowledge-verifier",
        agentId: "knowledge-verifier",
        jobMode: "research",
        versionId: "knowledge-verifier",
        prompt: knowledgeVerifierPrompt(JSON.stringify(draft), evidence),
      });
      map = parseKnowledgeMap(verifierRaw, models, "live") ?? draft;
    }

    saveMap(tenant, "Mapped", map, null);
    // Graph stage of the loop: the map already *is* topic → source edges, so project it. Recomputed
    // from the blob that was just saved, so it is idempotent; a graph failure never fails the map.
    // NOTE(phase 2): sources indexed before the overlapping chunker are not re-chunked here. A
    // rechunk pass belongs with a re-index (it has to rewrite FTS rows and vectors together), so it
    // is deliberately out of this projection; existing sources keep their fixed-stride chunks.
    try {
      projectMapToGraph(tenant, map);
    } catch (error) {
      log.warn("knowledge_map_graph_projection_skipped", {
        detail: error instanceof Error ? error.message.slice(0, 120) : "error",
      });
    }
    return map;
  } catch (error) {
    const message = error instanceof Error ? error.message : modeMessage("knowledgeMapFailed", localeForRun());
    saveMap(tenant, "Failed", null, message);
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("generation_failed", message, 502);
  }
}
