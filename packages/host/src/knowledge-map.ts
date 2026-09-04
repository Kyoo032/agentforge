import {
  ApiError,
  hasLiveProvider,
  knowledgeBrainPrompt,
  knowledgeVerifierPrompt,
  parseKnowledgeMap,
  resolveRuntimeMode,
  stubKnowledgeMap,
  type KnowledgeMap,
  type KnowledgeModels,
  type TenantContext,
} from "@agentforge/core";
import { sql } from "@agentforge/db";
import { collectJobAssistantText } from "./job-regen";
import { getKnowledgeModels, listSources, putKnowledgeModels } from "./knowledge";
import { reembedWorkspaceChunks } from "./knowledge-embed";
import { loadSettings } from "./settings-store";

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
    .run(
      workspaceId(tenant),
      JSON.stringify(payload ?? {}),
      status,
      error,
      Date.now(),
    );
}

function sourceExcerpts(tenant: TenantContext): Array<{ id: string; name: string; excerpt: string }> {
  const sources = listSources(tenant);
  return sources.map((source) => {
    const row = sql
      .prepare(
        `SELECT body FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ? LIMIT 1`,
      )
      .get(workspaceId(tenant), source.id) as { body: string } | undefined;
    return {
      id: source.id,
      name: source.name,
      excerpt: row?.body ?? "",
    };
  });
}

export async function mapKnowledge(
  tenant: TenantContext,
  overrides?: Partial<KnowledgeModels>,
): Promise<KnowledgeMap> {
  let models = getKnowledgeModels(tenant);
  if (
    overrides?.embeddingModel ||
    overrides?.brainModel ||
    overrides?.verifierModel
  ) {
    models = putKnowledgeModels(tenant, {
      embeddingModel: overrides.embeddingModel ?? models.embeddingModel,
      brainModel: overrides.brainModel ?? models.brainModel,
      verifierModel: overrides.verifierModel ?? models.verifierModel,
    });
  }

  saveMap(tenant, "Mapping", null, null);

  try {
    await reembedWorkspaceChunks(tenant, models.embeddingModel);

    const settings = loadSettings();
    const mode = resolveRuntimeMode({
      settingsHasKey: hasLiveProvider(settings),
      envRuntime: process.env.AGENTFORGE_RUNTIME,
    });

    const sources = listSources(tenant).map((source) => ({ id: source.id, name: source.name }));
    let map: KnowledgeMap | null;

    if (mode === "stub") {
      map = stubKnowledgeMap(sources, models);
    } else {
      const excerpts = sourceExcerpts(tenant);
      const brainRaw = await collectJobAssistantText({
        tenant,
        model: models.brainModel,
        systemPrompt: "You organize a local knowledge base. Return JSON only.",
        runPrefix: "knowledge-brain",
        agentId: "knowledge-brain",
        versionId: "knowledge-brain",
        prompt: knowledgeBrainPrompt(excerpts),
      });
      const draft = parseKnowledgeMap(brainRaw, models, "live");
      if (!draft) {
        throw new ApiError("generation_failed", "Brain returned an invalid knowledge map", 502);
      }
      const evidence = excerpts
        .map((item) => `[${item.id}] ${item.name}\n${item.excerpt}`)
        .join("\n\n");
      const verifierRaw = await collectJobAssistantText({
        tenant,
        model: models.verifierModel,
        systemPrompt: "You verify a knowledge map against source evidence. Return JSON only.",
        runPrefix: "knowledge-verifier",
        agentId: "knowledge-verifier",
        versionId: "knowledge-verifier",
        prompt: knowledgeVerifierPrompt(JSON.stringify(draft), evidence),
      });
      map = parseKnowledgeMap(verifierRaw, models, "live") ?? draft;
    }

    saveMap(tenant, "Mapped", map, null);
    return map;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Map failed";
    saveMap(tenant, "Failed", null, message);
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("generation_failed", message, 502);
  }
}
