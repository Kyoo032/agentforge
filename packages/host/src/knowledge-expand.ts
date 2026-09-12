import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import type { RetrievedChunk, RetrieveResult } from "./knowledge/backend";
import { getGraph } from "./knowledge-graph";

/**
 * Phase 4: the Graph stage feeding retrieval back.
 *
 * After a retrieval, when the *top* hit is weak (scored below `EXPAND_TOP_SCORE_THRESHOLD`) the
 * graph gets one vote: the topics that `covers` the top hit's source name sibling sources, and the
 * first chunk of each sibling rides along, labelled `via graph`, capped at `EXPAND_CHUNK_CAP`. The
 * label is the caller's handle on what the graph added — the Sources line renders it and the
 * retrieval counter records it — so the feature can be measured rather than vibed. Behind
 * `knowledge.graphExpand`, off by default; the planted-pair test decides whether it flips.
 *
 * A chunk the graph contributes is *not* scored: nothing embedded it against the query, so it
 * carries score 0 and lands after every real hit, where it cannot outrank one.
 */

/** How many chunks one expansion may add. The plan fixes this at 2 (risk register item 9). */
export const EXPAND_CHUNK_CAP = 2;

/**
 * The top-score ceiling for expansion. 0.5 is the placeholder the flag flip validates: the
 * planted-pair test (two related facts, two sources, one topic) decides the final number, and this
 * constant is the one place to change it.
 */
export const EXPAND_TOP_SCORE_THRESHOLD = 0.5;

/** A chunk the graph expansion added. `via` is what marks it for the caller. */
export type GraphExpandedChunk = RetrievedChunk & { via: "graph" };

/** Whether a retrieved chunk rode along from the graph rather than from the query itself. */
export function isGraphExpandedChunk(chunk: RetrievedChunk): chunk is GraphExpandedChunk {
  return (chunk as { via?: unknown }).via === "graph";
}

export type GraphExpandOptions = {
  /** `knowledge.graphExpand`. Off unless explicitly true: this changes what every Chat is given. */
  expand?: boolean;
  /** Expand only when the top chunk scored *below* this (strictly). */
  threshold?: number;
  /** Max chunks one call may add. Defaults to the plan's cap; a parameter so tests can vary it. */
  cap?: number;
  /** Never expand into these sources — the same anti-loop list the retrieval was given. */
  excludeSourceIds?: readonly string[];
};

/**
 * The result a caller should use: the retrieval's own chunks plus at most `cap` chunks the graph
 * contributed, each labelled `via graph`. Returns the input untouched when the flag is off, the top
 * score does not fire the threshold, or the graph names no sibling with chunks to serve — so
 * wiring this in cannot change a workspace that never runs a map.
 */
export function expandRetrievedChunks(
  tenant: TenantContext,
  result: RetrieveResult,
  options: GraphExpandOptions = {},
): RetrieveResult {
  const top = result.chunks[0];
  if (options.expand !== true || !top) {
    return result;
  }
  const threshold = options.threshold ?? EXPAND_TOP_SCORE_THRESHOLD;
  if (!(top.score < threshold)) {
    return result;
  }
  const cap = Math.max(0, Math.floor(options.cap ?? EXPAND_CHUNK_CAP));
  if (cap === 0) {
    return result;
  }
  const blocked = new Set<string>(options.excludeSourceIds ?? []);
  for (const chunk of result.chunks) {
    blocked.add(chunk.sourceId);
  }
  const added: GraphExpandedChunk[] = [];
  for (const sourceId of siblingSources(tenant, top.sourceId, blocked)) {
    if (added.length >= cap) {
      break;
    }
    const first = firstChunkOf(tenant, sourceId);
    if (!first) {
      continue;
    }
    added.push({
      body: first.body,
      sourceId,
      sourceName: first.name,
      score: 0,
      chunkIndex: 0,
      via: "graph",
    });
  }
  return added.length === 0 ? result : { ...result, chunks: [...result.chunks, ...added] };
}

/**
 * The sources the graph offers as siblings: everything covered by a topic that also covers the top
 * hit's source, one hop over `covers`, in the graph's own deterministic edge order. Empty when no
 * topic covers the top source — an unmapped workspace expands nothing.
 */
function siblingSources(tenant: TenantContext, topSourceId: string, blocked: ReadonlySet<string>): string[] {
  const graph = getGraph(tenant);
  const topics = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === "covers" && edge.to === topSourceId) {
      topics.add(edge.from);
    }
  }
  if (topics.size === 0) {
    return [];
  }
  const siblings: string[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind !== "covers" || !topics.has(edge.from) || blocked.has(edge.to) || seen.has(edge.to)) {
      continue;
    }
    seen.add(edge.to);
    siblings.push(edge.to);
  }
  return siblings;
}

/**
 * The first chunk of a source, in insert order — the order the chunker produced, which is what
 * `indexableSource` documents as load-bearing. Null when the source has no servable chunks (a
 * Failed card) or the FTS table cannot answer; either way the walk moves on to the next sibling.
 */
function firstChunkOf(tenant: TenantContext, sourceId: string): { body: string; name: string } | null {
  try {
    // A `MATCH` with the `source_id` column filter, never an unqualified select: without MATCH,
    // FTS5 has no plan but a scan of every chunk in the workspace (see `chunkBodies`).
    const row = sql
      .prepare(
        `SELECT body FROM knowledge_chunks
         WHERE knowledge_chunks MATCH ? AND workspace_id = ? ORDER BY rowid LIMIT 1`,
      )
      .get(`source_id:"${sourceId.replace(/"/g, "")}"`, tenant.workspaceId) as { body: string } | undefined;
    if (!row || row.body.trim().length === 0) {
      return null;
    }
    const source = sql
      .prepare("SELECT name FROM knowledge_sources WHERE workspace_id = ? AND id = ?")
      .get(tenant.workspaceId, sourceId) as { name: string } | undefined;
    return { body: row.body, name: source?.name ?? sourceId };
  } catch (error) {
    console.warn(
      `knowledge-expand: chunk read failed for ${sourceId} (${
        error instanceof Error ? error.message.slice(0, 120) : "error"
      })`,
    );
    return null;
  }
}
