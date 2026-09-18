import {
  DEFAULT_OPENAI_BASE_URL,
  cosineSimilarity,
  hasLiveProvider,
  parseEmbeddingResponse,
  resolveProviderKeys,
  resolveRuntimeMode,
  stubEmbed,
  type KnowledgeModels,
  type TenantContext,
} from "@agentforge/core";
import { sql } from "@agentforge/db";
import { loadSettings } from "./settings-store";
import { log } from "./log";

const EMBED_BATCH = 16;

/**
 * Model id every locally-computed fallback vector is stored under. `stubEmbed` is a 32-dim FNV-1a
 * word hash — a different geometry from any real embedding model — so filing it under the configured
 * model id would make a workspace look embedded when it is not, and would mix two incompatible
 * spaces under one id the day the real endpoint comes back. It gets its own id instead.
 */
export const STUB_EMBED_MODEL = "stub-fnv-32";

/** Vectors plus the model id they must be stored (and later queried) under. */
export type EmbeddedTexts = { vectors: number[][]; model: string };
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

function isStubEmbedding(deskId?: string): boolean {
  const settings = loadSettings(deskId);
  return (
    resolveRuntimeMode({
      settingsHasKey: hasLiveProvider(settings),
      envRuntime: process.env.AGENTFORGE_RUNTIME,
    }) === "stub"
  );
}

async function liveEmbedBatch(texts: string[], model: string, deskId?: string): Promise<number[][]> {
  const settings = loadSettings(deskId);
  const key = settings.openaiApiKey;
  if (!key) {
    return texts.map((text) => stubEmbed(text));
  }
  // Pinned endpoint only: the gateway key rides this request, so a stored `openaiBaseUrl` must
  // never decide where it goes. `resolveProviderKeys` is the single source of that URL.
  const base = (resolveProviderKeys(settings).openaiBaseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
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

function allStubbed(texts: string[]): EmbeddedTexts {
  return { vectors: texts.map((text) => stubEmbed(text)), model: STUB_EMBED_MODEL };
}

/**
 * Embed a batch and say which model id the result belongs to. A run that falls back part-way is
 * re-stubbed whole: one source's vectors must share one geometry, or cosine across them is noise.
 *
 * `deskId` is the workspace whose gateway key pays for the call; without it the read falls back to
 * the machine-wide selection, which is the wrong desk's key (or none at all).
 */
export async function embedTextsWithModel(texts: string[], model: string, deskId?: string): Promise<EmbeddedTexts> {
  if (texts.length === 0) {
    return { vectors: [], model };
  }
  if (isStubEmbedding(deskId) || Date.now() < embedDownUntil) {
    return allStubbed(texts);
  }
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    try {
      out.push(...(await liveEmbedBatch(batch, model, deskId)));
    } catch (error) {
      embedDownUntil = Date.now() + EMBED_DOWN_MS;
      log.warn("knowledge_embed_unavailable", {
        localVectorMinutes: EMBED_DOWN_MS / 60_000,
        detail: error instanceof Error ? error.message.slice(0, 80) : "error",
      });
      return allStubbed(texts);
    }
  }
  return { vectors: out, model };
}

export async function embedTexts(texts: string[], model: string, deskId?: string): Promise<number[][]> {
  return (await embedTextsWithModel(texts, model, deskId)).vectors;
}

/** A query vector plus the model id it was actually produced by. */
export type EmbeddedQuery = { vector: number[]; model: string };

/**
 * Embed one query and say which model produced the vector.
 *
 * The model id is the whole point: offline (no key, or the circuit open) the answer is a 32-dim
 * `stub-fnv-32` vector, and `cosineSimilarity` truncates to the shorter side — so comparing it
 * against 1536-dim rows would score 32 of 1536 dimensions and call the noise a match. Callers use
 * the returned id to pick the rows this vector may legally be compared against.
 */
export async function embedQuery(query: string, model: string, deskId?: string): Promise<EmbeddedQuery> {
  if (model === STUB_EMBED_MODEL) {
    return { vector: stubEmbed(query), model: STUB_EMBED_MODEL };
  }
  const { vectors, model: used } = await embedTextsWithModel([query], model, deskId);
  const vec = vectors[0];
  return vec ? { vector: vec, model: used } : { vector: stubEmbed(query), model: STUB_EMBED_MODEL };
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
    // The id the vectors are *stored* under is the one the embedder actually used, which is
    // `stub-fnv-32` whenever the live endpoint was unavailable — never the configured model.
    const { vectors: embeddings, model: storedModel } = await embedTextsWithModel(chunks, model, workspaceId(tenant));
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
          storedModel,
          createdAt,
        );
      }
    });
    // BEGIN IMMEDIATE: this transaction reads then writes. A deferred transaction would take the
    // write lock only at the first write, and that read-to-write upgrade fails instantly with
    // SQLITE_BUSY under a second writer. IMMEDIATE takes the write lock up front, so a busy
    // database makes it wait on the busy handler instead of failing.
    tx.immediate();
  } catch (error) {
    // Embed / write failure must not fail the source — FTS already indexed it — but it is never silent.
    log.warn("knowledge_embed_vectors_not_written", {
      sourceId,
      detail: error instanceof Error ? error.message.slice(0, 120) : "error",
    });
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

/**
 * Which set of vectors answers a query for `model`: its own rows when it has any, otherwise the
 * local `stub-fnv-32` rows so an offline workspace still retrieves, and null when there are neither.
 */
export function resolveVectorModel(tenant: TenantContext, model: string): string | null {
  if (countVectorsForModel(tenant, model) > 0) {
    return model;
  }
  if (model !== STUB_EMBED_MODEL && countVectorsForModel(tenant, STUB_EMBED_MODEL) > 0) {
    return STUB_EMBED_MODEL;
  }
  return null;
}

/** A cosine hit from `knowledge_vectors`. The backend adds the source name before serving it. */
export type VectorHit = {
  body: string;
  sourceId: string;
  chunkIndex: number;
  score: number;
  source: "rag" | "fts";
};

const MIN_COSINE = 0.12;

/** Vector hits plus the model id whose rows were searched (null when none were). */
export type VectorSearch = { hits: VectorHit[]; model: string | null };

/**
 * Cosine search over `knowledge_vectors`, answered from one geometry only.
 *
 * The model the query *asked* for and the model it was *embedded* with are two different things
 * offline. Rows are chosen by the latter: a stub query searches stub rows or nothing at all, and a
 * real-model query searches that model's rows or nothing at all. Mixing them compares a truncated
 * prefix of two unrelated spaces, which reliably clears the cosine floor with pure noise.
 *
 * `preferredModel` lets a caller that already paid for `resolveVectorModel` skip the second lookup.
 */
export async function searchVectors(
  tenant: TenantContext,
  query: string,
  models: KnowledgeModels,
  limit = 4,
  excludeSourceIds: string[] = [],
  preferredModel?: string | null,
): Promise<VectorSearch> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { hits: [], model: null };
  }
  const preferred =
    preferredModel === undefined ? resolveVectorModel(tenant, models.embeddingModel) : preferredModel;
  if (!preferred) {
    return { hits: [], model: null };
  }
  const { vector: queryVec, model } = await embedQuery(trimmed, preferred, workspaceId(tenant));
  // The embedder fell back (or was already down) while this workspace holds rows of another model:
  // there is nothing here this vector can be compared against, so the answer is "no vector hits".
  if (model !== preferred && countVectorsForModel(tenant, model) === 0) {
    return { hits: [], model: null };
  }
  const skip =
    excludeSourceIds.length > 0 ? ` AND source_id NOT IN (${excludeSourceIds.map(() => "?").join(", ")})` : "";
  const ws = workspaceId(tenant);
  // Only vectors whose source row still exists: a vector orphaned by a mid-embed delete is never served.
  const rows = sql
    .prepare(
      `SELECT body, embedding, source_id, chunk_index FROM knowledge_vectors
       WHERE workspace_id = ? AND model = ?
         AND source_id IN (SELECT id FROM knowledge_sources WHERE workspace_id = ?)${skip}`,
    )
    .all(ws, model, ws, ...excludeSourceIds) as Array<{
    body: string;
    embedding: string;
    source_id: string;
    chunk_index: number;
  }>;

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
      return {
        body: row.body,
        sourceId: row.source_id,
        chunkIndex: row.chunk_index,
        score: cosineSimilarity(queryVec, embedding),
      };
    })
    .filter((item) => item.score >= MIN_COSINE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { hits: ranked.map((item) => ({ ...item, source: "rag" as const })), model };
}

/** `searchVectors` for callers that only want the hits. */
export async function retrieveVectorChunks(
  tenant: TenantContext,
  query: string,
  models: KnowledgeModels,
  limit = 4,
  excludeSourceIds: string[] = [],
): Promise<VectorHit[]> {
  return (await searchVectors(tenant, query, models, limit, excludeSourceIds)).hits;
}
