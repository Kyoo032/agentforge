import { sql } from "@agentforge/db";
import type { KnowledgeModels, TenantContext } from "@agentforge/core";
import {
  deleteVectorsForSource,
  indexSourceVectors,
  resolveVectorModel,
  searchVectors,
} from "../../knowledge-embed";
import { getKnowledgeModels } from "../../knowledge";
import { ftsSourceFilter, knowledgeFtsQuery } from "../../knowledge-text";
import type {
  BackendHealth,
  BackendRetrieveOptions,
  BackendSource,
  KnowledgeBackend,
  RetrievedChunk,
  RetrieveMode,
  RetrieveResult,
} from "../backend";
import { log } from "../../log";

/**
 * The in-process backend: FTS5 (`knowledge_chunks`) plus JSON cosine vectors (`knowledge_vectors`),
 * both in the workspace SQLite file. Both engines run on every query and their rankings are fused
 * with RRF, so a hit only one of them can see still reaches the prompt.
 */

/** A hit that scored 0 would look like "no match", so a real bm25 row never falls below this. */
const MIN_FTS_SCORE = 1e-6;

/**
 * FTS5 `bm25()` returns a *negative* relevance (more negative = better match). We flip the sign and
 * squash it: `score = raw / (1 + raw)` with `raw = max(-bm25, 0)`, which is monotonic in relevance
 * and lands in (0, 1] — comparable inside one result set, never across queries.
 */
function bm25Score(rank: number): number {
  const raw = Math.max(-rank, 0);
  return Math.max(raw / (1 + raw), MIN_FTS_SCORE);
}

function notInClause(ids: string[]): string {
  return ids.length > 0 ? ` AND source_id NOT IN (${ids.map(() => "?").join(", ")})` : "";
}

function placeholders(ids: string[]): string {
  return ids.map(() => "?").join(", ");
}

/** Display names for the sources a result set touched (the FTS table holds ids only). */
function sourceNames(workspaceId: string, sourceIds: string[]): Map<string, string> {
  if (sourceIds.length === 0) {
    return new Map();
  }
  const rows = sql
    .prepare(`SELECT id, name FROM knowledge_sources WHERE workspace_id = ? AND id IN (${placeholders(sourceIds)})`)
    .all(workspaceId, ...sourceIds) as Array<{ id: string; name: string }>;
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * The two ways a hit's chunk index is resolved. Exported so a test can prove with
 * `EXPLAIN QUERY PLAN` that neither one scans a whole table.
 *
 * `vectors` rides `knowledge_vectors_ws_source_idx`; `ftsBySource` uses an FTS5 column filter, which
 * is what makes the read index-driven — an unqualified `SELECT ... FROM knowledge_chunks` has no
 * MATCH for FTS5 to plan against and degrades to a full scan of the whole workspace's chunks.
 */
export const CHUNK_INDEX_QUERIES = {
  vectors: (count: number) =>
    `SELECT source_id, chunk_index, body FROM knowledge_vectors
     WHERE workspace_id = ? AND source_id IN (${new Array(count).fill("?").join(", ")})`,
  ftsBySource: `SELECT rowid AS rid FROM knowledge_chunks
     WHERE knowledge_chunks MATCH ? AND workspace_id = ? ORDER BY rowid`,
} as const;

/**
 * Key for "this exact body, in this source". The separator is a unit separator written as an
 * escape: an actual control byte in the source file makes git treat the whole file as binary, which
 * costs every future review of it a readable diff.
 */
function chunkKey(sourceId: string, body: string): string {
  return `${sourceId}${body}`;
}

/**
 * `knowledge_vectors` holds `(workspace_id, source_id, chunk_index, body)` for every indexed source
 * — an embed failure still writes local stub vectors (see knowledge-embed) — so the chunk index of
 * an FTS hit is normally a straight indexed lookup on the body text.
 *
 * One body can occur more than once in a source (a repeated paragraph, an overlap window), so the
 * value is *every* index that body holds, ascending. Keeping only the last one collapsed two real
 * chunks onto one fuse key, which both lost a result and double-counted it in the fusion.
 */
function vectorChunkIndexes(workspaceId: string, sourceIds: string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (sourceIds.length === 0) {
    return out;
  }
  const rows = sql
    .prepare(CHUNK_INDEX_QUERIES.vectors(sourceIds.length))
    .all(workspaceId, ...sourceIds) as Array<{ source_id: string; chunk_index: number; body: string }>;
  for (const row of rows) {
    const key = chunkKey(row.source_id, row.body);
    out.set(key, [...(out.get(key) ?? []), row.chunk_index]);
  }
  for (const [key, indexes] of out) {
    out.set(key, [...indexes].sort((a, b) => a - b));
  }
  return out;
}

/**
 * Fallback for a source whose vectors are missing (deleted by hand, or a re-index in flight). Chunk
 * order inside a source is insert order, so the index is the rank of a hit's rowid among that one
 * source's rowids — read through the FTS index, one source at a time, never the whole table.
 */
function rowidRanks(workspaceId: string, sourceId: string): Map<number, number> {
  const out = new Map<number, number>();
  const match = ftsSourceFilter(sourceId);
  try {
    const rows = sql.prepare(CHUNK_INDEX_QUERIES.ftsBySource).all(match, workspaceId) as Array<{ rid: number }>;
    rows.forEach((row, rank) => {
      out.set(row.rid, rank);
    });
  } catch (error) {
    log.warn("knowledge_backend_chunk_index_fallback_failed", {
      detail: error instanceof Error ? error.message.slice(0, 120) : "error",
    });
  }
  return out;
}

/** The RRF constant. 60 is the value from the original Cormack/Clarke/Buettcher paper. */
export const RRF_K = 60;

/** One fused document is one chunk: the same body can be reached by either engine. */
function fuseKey(chunk: RetrievedChunk): string {
  return `${chunk.sourceId}#${chunk.chunkIndex}`;
}

/**
 * Reciprocal Rank Fusion over ranked lists keyed by `(sourceId, chunkIndex)`:
 *
 *     raw(d)   = Σ over lists containing d of 1 / (RRF_K + rank(d))     // rank is 1-based
 *     score(d) = raw(d) / (contributingLists / (RRF_K + 1))
 *
 * The divisor is the largest raw score any document could have reached in this query, so scores
 * land in (0, 1] and a chunk ranked first by every engine that answered scores exactly 1. Ties are
 * broken by source id then chunk index, so the order is a pure function of the inputs.
 *
 * Each list is deduplicated by fuse key first, best (lowest) rank winning. A key that appeared
 * twice in *one* list otherwise contributed twice — `1/61 + 1/62` against a `1/61` ceiling scores
 * 1.98, above a ceiling that is supposed to be unreachable — and cost the result set a slot.
 */
export function fuseRrf(lists: RetrievedChunk[][], limit: number, k = RRF_K): RetrievedChunk[] {
  const fused = new Map<string, { chunk: RetrievedChunk; raw: number }>();
  for (const list of lists.map(dedupeByKey)) {
    list.forEach((chunk, index) => {
      const key = fuseKey(chunk);
      const previous = fused.get(key);
      fused.set(key, {
        chunk: previous?.chunk ?? chunk,
        raw: (previous?.raw ?? 0) + 1 / (k + index + 1),
      });
    });
  }
  const contributing = lists.filter((list) => list.length > 0).length;
  if (contributing === 0) {
    return [];
  }
  const ceiling = contributing / (k + 1);
  return [...fused.values()]
    .map((entry) => ({ ...entry.chunk, score: Math.min(entry.raw / ceiling, 1) }))
    .sort(compareFused)
    .slice(0, Math.max(0, limit));
}

/** One list, one entry per fuse key: the first (best-ranked) occurrence, in its original order. */
function dedupeByKey(list: RetrievedChunk[]): RetrievedChunk[] {
  const best = new Map<string, RetrievedChunk>();
  for (const chunk of list) {
    const key = fuseKey(chunk);
    if (!best.has(key)) {
      best.set(key, chunk);
    }
  }
  return [...best.values()];
}

function compareFused(a: RetrievedChunk, b: RetrievedChunk): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.sourceId !== b.sourceId) {
    return a.sourceId < b.sourceId ? -1 : 1;
  }
  return a.chunkIndex - b.chunkIndex;
}

function fusedMode(ftsCount: number, vectorCount: number): RetrieveMode {
  if (ftsCount > 0 && vectorCount > 0) {
    return "hybrid";
  }
  if (vectorCount > 0) {
    return "rag";
  }
  return ftsCount > 0 ? "fts" : "none";
}

type FtsRow = { rid: number; source_id: string; body: string; rank: number };

function ftsRows(workspaceId: string, query: string, limit: number, exclude: string[]): FtsRow[] {
  try {
    return sql
      .prepare(
        `SELECT rowid AS rid, source_id, body, bm25(knowledge_chunks) AS rank FROM knowledge_chunks
         WHERE workspace_id = ? AND knowledge_chunks MATCH ?${notInClause(exclude)}
         ORDER BY bm25(knowledge_chunks) LIMIT ?`,
      )
      .all(workspaceId, query, ...exclude, limit) as FtsRow[];
  } catch (error) {
    // A malformed MATCH expression or a missing FTS table must degrade to "no results", never a 500.
    log.warn("knowledge_backend_fts_query_failed", {
      detail: error instanceof Error ? error.message.slice(0, 120) : "error",
    });
    return [];
  }
}

export class SqliteBuiltinBackend implements KnowledgeBackend {
  readonly id = "builtin" as const;

  async indexSource(
    tenant: TenantContext,
    source: BackendSource,
    chunks: string[],
    model: string,
  ): Promise<void> {
    // `createdAt` ties the vectors to this exact row version: a delete or re-index that lands while
    // the (possibly remote) embed is in flight makes the vector write a no-op instead of an orphan.
    await indexSourceVectors(tenant, source.id, chunks, model, source.createdAt);
  }

  // `async`, not `return Promise.resolve(...)`: the SQLite delete is synchronous, so a non-async
  // method would throw *before* returning a promise and slip past the caller's `.catch`.
  async deleteSource(tenant: TenantContext, sourceId: string): Promise<void> {
    deleteVectorsForSource(tenant, sourceId);
  }

  async retrieve(tenant: TenantContext, query: string, opts: BackendRetrieveOptions): Promise<RetrieveResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      return { chunks: [], mode: "none", backend: this.id, vectorModel: null };
    }
    const exclude = opts.excludeSourceIds ?? [];
    // Settings and the vector model are resolved once per query and handed down: each
    // `resolveVectorModel` costs up to two COUNT scans of `knowledge_vectors`, and the pre-fix path
    // paid for four of them to answer one question.
    const models = getKnowledgeModels(tenant);
    const preferredModel = resolveVectorModel(tenant, models.embeddingModel);
    // Both engines always run: a keyword-only hit and a semantic-only hit are both real answers, and
    // the pre-Phase-2 "vectors won, skip FTS" branch threw one of them away on every query.
    const vectors = await this.retrieveVectors(tenant, trimmed, opts.limit, exclude, models, preferredModel);
    const ftsHits = this.retrieveFts(tenant, trimmed, opts.limit, exclude);
    return {
      chunks: fuseRrf([ftsHits, vectors.chunks], opts.limit),
      mode: fusedMode(ftsHits.length, vectors.chunks.length),
      backend: this.id,
      // The model whose rows were actually searched, which is null when the query's own geometry
      // has no rows here — not the model the workspace merely wishes it had.
      vectorModel: vectors.model,
    };
  }

  // Same reason as `deleteSource`: every method that touches SQLite is `async`, so a driver-level
  // throw always arrives as a rejection the caller can handle uniformly.
  async health(): Promise<BackendHealth> {
    try {
      sql.prepare("SELECT 1 FROM knowledge_sources LIMIT 1").get();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message.slice(0, 200) : "knowledge tables unavailable",
      };
    }
  }

  private async retrieveVectors(
    tenant: TenantContext,
    query: string,
    limit: number,
    exclude: string[],
    models: KnowledgeModels,
    preferredModel: string | null,
  ): Promise<{ chunks: RetrievedChunk[]; model: string | null }> {
    const { hits, model } = await searchVectors(tenant, query, models, limit, exclude, preferredModel);
    const names = sourceNames(tenant.workspaceId, [...new Set(hits.map((hit) => hit.sourceId))]);
    return {
      chunks: hits.map((hit) => ({
        body: hit.body,
        sourceId: hit.sourceId,
        sourceName: names.get(hit.sourceId) ?? hit.sourceId,
        score: hit.score,
        chunkIndex: hit.chunkIndex,
      })),
      model,
    };
  }

  private retrieveFts(tenant: TenantContext, query: string, limit: number, exclude: string[]): RetrievedChunk[] {
    const match = knowledgeFtsQuery(query);
    if (!match) {
      return [];
    }
    const ws = tenant.workspaceId;
    const rows = ftsRows(ws, match, limit, exclude);
    const ids = [...new Set(rows.map((row) => row.source_id))];
    const names = sourceNames(ws, ids);
    const indexes = vectorChunkIndexes(ws, ids);
    // Rows arrive in bm25 order and are consumed in that order, so a repeated body hands out its
    // indexes one at a time: two copies of one paragraph stay two chunks instead of one.
    const taken = new Map<string, number>();
    const ranks = new Map<string, Map<number, number>>();
    return rows.map((row) => ({
      body: row.body,
      sourceId: row.source_id,
      sourceName: names.get(row.source_id) ?? row.source_id,
      score: bm25Score(row.rank),
      chunkIndex: takeIndex(indexes, taken, row) ?? this.rankOf(ws, row, ranks),
    }));
  }

  /**
   * Per-source rowid ranking, computed at most once per source in a result set.
   *
   * A rowid the ranking cannot see — the FTS column filter failed, or the row landed after it was
   * read — still gets an index of its own rather than a shared 0, or two distinct chunks would fuse
   * into one entry and be scored as if two engines had voted for it.
   */
  private rankOf(workspaceId: string, row: FtsRow, cache: Map<string, Map<number, number>>): number {
    let ranks = cache.get(row.source_id);
    if (!ranks) {
      ranks = rowidRanks(workspaceId, row.source_id);
      cache.set(row.source_id, ranks);
    }
    const known = ranks.get(row.rid);
    if (known !== undefined) {
      return known;
    }
    const synthetic = ranks.size;
    ranks.set(row.rid, synthetic);
    return synthetic;
  }
}

/** The next unused chunk index recorded for this body, or undefined when there is none. */
function takeIndex(
  indexes: Map<string, number[]>,
  taken: Map<string, number>,
  row: FtsRow,
): number | undefined {
  const key = chunkKey(row.source_id, row.body);
  const available = indexes.get(key);
  if (!available || available.length === 0) {
    return undefined;
  }
  const used = taken.get(key) ?? 0;
  taken.set(key, used + 1);
  return available[Math.min(used, available.length - 1)];
}
