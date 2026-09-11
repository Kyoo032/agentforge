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
 * How the chunks were found: `hybrid` when bm25 and cosine both returned something, `rag` or `fts`
 * when only one engine did, `weknora` when the sidecar's own hybrid search answered, `none` when
 * nothing did. It is what the context popover shows, so it names the engine the owner can act on.
 */
export type RetrieveMode = "rag" | "fts" | "hybrid" | "weknora" | "none";

export type RetrieveResult = {
  chunks: RetrievedChunk[];
  mode: RetrieveMode;
  /** Which backend produced these chunks. Recorded on every `knowledge_retrievals` row. */
  backend: KnowledgeBackendId;
  /**
   * True when the selected backend could not answer and the builtin one stood in. The Sources line
   * says so out loud — a silently degraded knowledge base is worse than an obviously degraded one.
   */
  degraded?: boolean;
  /**
   * The embedding model id whose vectors were searched — the configured model, the local
   * `stub-fnv-32` fallback, or null when the workspace has no vectors at all. Diagnostic only:
   * `mode` still describes which engines answered.
   */
  vectorModel: string | null;
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
  /**
   * Forget everything the backend holds for this source. Must not throw when it holds nothing.
   *
   * `externalId` is the backend's own handle, passed when the caller has *already* dropped the
   * `knowledge_sources` row — a delete is one SQLite transaction and the index side is a later,
   * possibly remote call, so by the time it runs there is nothing left to look the handle up from.
   */
  deleteSource(tenant: TenantContext, sourceId: string, externalId?: string | null): Promise<void>;
  retrieve(tenant: TenantContext, query: string, opts: BackendRetrieveOptions): Promise<RetrieveResult>;
  health(): Promise<BackendHealth>;
};

export const EMPTY_RETRIEVAL: RetrieveResult = { chunks: [], mode: "none", backend: "builtin", vectorModel: null };

/**
 * A backend that cannot answer right now — the sidecar is down, unreachable, or answered with
 * something that is not its own protocol. Distinct from a *failed* query: the registry treats this
 * as "fall back to builtin and count a health failure", and never as an empty result set, because
 * silently returning no chunks would look exactly like "this workspace knows nothing".
 */
export class BackendUnavailable extends Error {
  readonly backendId: KnowledgeBackendId;
  /** Short machine-readable cause (`not_staged`, `spawn_failed`, `http_502`, `bad_shape`, ...). */
  readonly reason: string;

  constructor(backendId: KnowledgeBackendId, reason: string, message?: string) {
    super(message ?? `${backendId} backend unavailable: ${reason}`);
    this.name = "BackendUnavailable";
    this.backendId = backendId;
    this.reason = reason;
  }
}

export function isBackendUnavailable(error: unknown): error is BackendUnavailable {
  return error instanceof BackendUnavailable;
}
