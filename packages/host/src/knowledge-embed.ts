import {
  DEFAULT_OPENAI_BASE_URL,
  cosineSimilarity,
  hasLiveProvider,
  parseEmbeddingResponse,
  resolveRuntimeMode,
  stubEmbed,
  type KnowledgeModels,
  type TenantContext,
} from "@agentforge/core";
import { sql } from "@agentforge/db";
import { loadSettings } from "./settings-store";

const EMBED_BATCH = 16;

function workspaceId(tenant: TenantContext): string {
  return tenant.workspaceId;
}

function isStubEmbedding(): boolean {
  const settings = loadSettings();
  return (
    resolveRuntimeMode({
      settingsHasKey: hasLiveProvider(settings),
      envRuntime: process.env.AGENTFORGE_RUNTIME,
    }) === "stub"
  );
}

async function liveEmbedBatch(texts: string[], model: string): Promise<number[][]> {
  const settings = loadSettings();
  const key = settings.openaiApiKey;
  if (!key) {
    return texts.map((text) => stubEmbed(text));
  }
  const base = (settings.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`embeddings ${res.status}`);
  }
  const parsed = parseEmbeddingResponse(await res.json());
  if (parsed.length !== texts.length) {
    throw new Error("embeddings response length mismatch");
  }
  return parsed;
}

export async function embedTexts(texts: string[], model: string): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  if (isStubEmbedding()) {
    return texts.map((text) => stubEmbed(text));
  }
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    try {
      out.push(...(await liveEmbedBatch(batch, model)));
    } catch {
      out.push(...batch.map((text) => stubEmbed(text)));
    }
  }
  return out;
}

export async function embedQuery(query: string, model: string): Promise<number[]> {
  const [vec] = await embedTexts([query], model);
  return vec ?? stubEmbed(query);
}

export function deleteVectorsForSource(tenant: TenantContext, sourceId: string): void {
  sql
    .prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ? AND source_id = ?")
    .run(workspaceId(tenant), sourceId);
}

export async function indexSourceVectors(
  tenant: TenantContext,
  sourceId: string,
  chunks: string[],
  model: string,
): Promise<void> {
  if (chunks.length === 0) {
    return;
  }
  try {
    const embeddings = await embedTexts(chunks, model);
    const insert = sql.prepare(
      `INSERT INTO knowledge_vectors (id, workspace_id, source_id, chunk_index, body, embedding, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const createdAt = Date.now();
    const ws = workspaceId(tenant);
    const tx = sql.transaction(() => {
      sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ? AND source_id = ?").run(ws, sourceId);
      for (let i = 0; i < chunks.length; i += 1) {
        const embedding = embeddings[i];
        if (!embedding) {
          continue;
        }
        insert.run(
          crypto.randomUUID(),
          ws,
          sourceId,
          i,
          chunks[i],
          JSON.stringify(embedding),
          model,
          createdAt,
        );
      }
    });
    tx();
  } catch {
    // Embed failure must not fail the source — FTS already indexed.
  }
}

export async function reembedWorkspaceChunks(tenant: TenantContext, model: string): Promise<void> {
  const rows = sql
    .prepare(
      `SELECT source_id, body FROM knowledge_chunks WHERE workspace_id = ? ORDER BY source_id, rowid`,
    )
    .all(workspaceId(tenant)) as Array<{ source_id: string; body: string }>;
  const bySource = new Map<string, string[]>();
  for (const row of rows) {
    const list = bySource.get(row.source_id) ?? [];
    list.push(row.body);
    bySource.set(row.source_id, list);
  }
  sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ?").run(workspaceId(tenant));
  for (const [sourceId, chunks] of bySource) {
    await indexSourceVectors(tenant, sourceId, chunks, model);
  }
}

export function countVectorsForModel(tenant: TenantContext, model: string): number {
  const row = sql
    .prepare("SELECT count(*) AS n FROM knowledge_vectors WHERE workspace_id = ? AND model = ?")
    .get(workspaceId(tenant), model) as { n: number };
  return row.n;
}

export type RetrievedChunk = {
  body: string;
  score: number;
  source: "rag" | "fts";
};

const MIN_COSINE = 0.12;

export async function retrieveVectorChunks(
  tenant: TenantContext,
  query: string,
  models: KnowledgeModels,
  limit = 4,
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  if (countVectorsForModel(tenant, models.embeddingModel) === 0) {
    return [];
  }
  const queryVec = await embedQuery(trimmed, models.embeddingModel);
  const rows = sql
    .prepare("SELECT body, embedding FROM knowledge_vectors WHERE workspace_id = ? AND model = ?")
    .all(workspaceId(tenant), models.embeddingModel) as Array<{ body: string; embedding: string }>;

  const ranked = rows
    .map((row) => {
      let embedding: number[] = [];
      try {
        const parsed = JSON.parse(row.embedding) as unknown;
        embedding = Array.isArray(parsed)
          ? parsed.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
          : [];
      } catch {
        embedding = [];
      }
      return { body: row.body, score: cosineSimilarity(queryVec, embedding) };
    })
    .filter((item) => item.score >= MIN_COSINE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return ranked.map((item) => ({ body: item.body, score: item.score, source: "rag" as const }));
}
