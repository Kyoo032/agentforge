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
/**
 * Embeddings sit on the hot path of every chat message and every KB write. Offline, a black-holed
 * endpoint must cost one short wait, not one per call: after a failure the endpoint is treated as
 * down for EMBED_DOWN_MS and every batch goes straight to local stub vectors.
 */
const EMBED_TIMEOUT_MS = 4_000;
const EMBED_DOWN_MS = 5 * 60 * 1000;
let embedDownUntil = 0;

/** Test hook. */
export function resetEmbedCircuit(): void {
  embedDownUntil = 0;
}

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
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
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
  if (Date.now() < embedDownUntil) {
    return texts.map((text) => stubEmbed(text));
  }
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    try {
      out.push(...(await liveEmbedBatch(batch, model)));
    } catch (error) {
      embedDownUntil = Date.now() + EMBED_DOWN_MS;
      console.warn(
        `knowledge-embed: embeddings unavailable, using local vectors for ${EMBED_DOWN_MS / 60_000} min (${error instanceof Error ? error.message.slice(0, 80) : "error"})`,
      );
      out.push(...batch.map((text) => stubEmbed(text)));
      for (let j = i + EMBED_BATCH; j < texts.length; j += EMBED_BATCH) {
        out.push(...texts.slice(j, j + EMBED_BATCH).map((text) => stubEmbed(text)));
      }
      break;
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
  /** When given, vectors are written only if the source row still exists with this created_at. */
  expectSourceCreatedAt?: number,
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
      if (expectSourceCreatedAt !== undefined) {
        const row = sql
          .prepare("SELECT created_at FROM knowledge_sources WHERE workspace_id = ? AND id = ?")
          .get(ws, sourceId) as { created_at: number } | undefined;
        if (!row || row.created_at !== expectSourceCreatedAt) {
          // Deleted or re-indexed while we were embedding: the newer version owns the vectors.
          return;
        }
      }
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
  excludeSourceIds: string[] = [],
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  if (countVectorsForModel(tenant, models.embeddingModel) === 0) {
    return [];
  }
  const queryVec = await embedQuery(trimmed, models.embeddingModel);
  const skip =
    excludeSourceIds.length > 0 ? ` AND source_id NOT IN (${excludeSourceIds.map(() => "?").join(", ")})` : "";
  const ws = workspaceId(tenant);
  // Only vectors whose source row still exists: a vector orphaned by a mid-embed delete is never served.
  const rows = sql
    .prepare(
      `SELECT body, embedding FROM knowledge_vectors
       WHERE workspace_id = ? AND model = ?
         AND source_id IN (SELECT id FROM knowledge_sources WHERE workspace_id = ?)${skip}`,
    )
    .all(ws, models.embeddingModel, ws, ...excludeSourceIds) as Array<{ body: string; embedding: string }>;

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
