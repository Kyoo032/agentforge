import type { TenantContext } from "@agentforge/core";

/**
 * The one retrieval seam. A knowledge backend owns vectors and scoring; it is never the system of
 * record. `knowledge_sources` / `knowledge_chunks` (FTS5), origins, soul, memories and the map stay
 * in agentforge SQLite, so a backend that is down or swapped out never loses a card.
 */

/** One retrieved piece of a source, carrying enough identity to be cited and counted. */
export type RetrievedChunk = {
  body: string;
  sourceId: string;
  /** Display name of the source row, used for the `[n] <sourceName>` citation marker. */
  sourceName: string;
  /** Higher is better, comparable only inside one result set. */
  score: number;
  /** 0-based position of this chunk inside its source. */
  chunkIndex: number;
};

/**
 * How the chunks were found. `hybrid` is Phase 2 (bm25 + cosine fused); Phase 0 returns the strict
 * fallback modes only.
 */
export type RetrieveMode = "rag" | "fts" | "hybrid" | "none";

export type RetrieveResult = {
  chunks: RetrievedChunk[];
  mode: RetrieveMode;
};

/** The source row a backend is indexing, as it exists in SQLite. */
export type BackendSource = {
  id: string;
  name: string;
  /** Row version stamp: a write that lands after a delete / re-index of this id must be a no-op. */
  createdAt: number;
};

export type BackendRetrieveOptions = {
  limit: number;
  /** Sources never returned, e.g. the card written from the thread that is asking. */
  excludeSourceIds?: string[];
};

export type BackendHealth = { ok: boolean; detail?: string };

export type KnowledgeBackendId = "builtin" | "weknora";

export type KnowledgeBackend = {
  readonly id: KnowledgeBackendId;
  /** Index (or re-index) every chunk of one source. Must be idempotent for the same source id. */
  indexSource(tenant: TenantContext, source: BackendSource, chunks: string[], model: string): Promise<void>;
  /** Forget everything the backend holds for this source. Must not throw when it holds nothing. */
  deleteSource(tenant: TenantContext, sourceId: string): Promise<void>;
  retrieve(tenant: TenantContext, query: string, opts: BackendRetrieveOptions): Promise<RetrieveResult>;
  health(): Promise<BackendHealth>;
};

export const EMPTY_RETRIEVAL: RetrieveResult = { chunks: [], mode: "none" };
