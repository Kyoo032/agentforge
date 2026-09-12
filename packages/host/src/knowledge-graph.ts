import { createHash } from "node:crypto";
import { sql } from "@agentforge/db";
import type { KnowledgeMap, TenantContext } from "@agentforge/core";
import { sanitizeSourceName } from "./knowledge-text";

/**
 * The Graph stage of the knowledge loop: topics, sources and threads, and the edges between them.
 *
 * The two projections are *recomputed* from their system of record — the knowledge map blob for
 * `covers`, `knowledge_retrievals` for `retrieved` — so they are idempotent by construction and the
 * edge table stays aggregated (one row per pair, `weight` carries the count) instead of per event.
 * `cites` is the one edge with no event table behind it: a citation exists only in the reply text,
 * so `recordCites` adds one to its edge per citing turn. Nothing here is on a critical path; every
 * entry point is safe to call and cheap to skip.
 */

export type GraphNodeKind = "topic" | "source" | "thread";
export type GraphEdgeKind = "covers" | "retrieved" | "cites";

export type GraphNodeInput = { id: string; kind: GraphNodeKind; label: string; payload?: unknown };
export type GraphEdgeInput = { from: string; to: string; kind: GraphEdgeKind; weight?: number };

export type GraphNode = { id: string; kind: GraphNodeKind; label: string };
export type GraphEdge = { from: string; to: string; kind: GraphEdgeKind; weight: number };
export type KnowledgeGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

/** Labels are rendered in the UI next to source names, so they get the same one-line treatment. */
const LABEL_MAX = 120;

/** How many edges are read before the highest-degree nodes are picked. Bounds a huge workspace. */
const EDGE_POOL_FACTOR = 4;

const UPSERT_NODE = `INSERT INTO knowledge_graph_nodes (id, workspace_id, kind, label, payload, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    workspace_id = excluded.workspace_id,
    kind = excluded.kind,
    label = excluded.label,
    payload = excluded.payload,
    updated_at = excluded.updated_at`;

const UPSERT_EDGE = `INSERT INTO knowledge_graph_edges (workspace_id, from_id, to_id, kind, weight, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(workspace_id, from_id, to_id, kind) DO UPDATE SET
    weight = excluded.weight,
    updated_at = excluded.updated_at`;

function label(value: string, fallback: string): string {
  return (sanitizeSourceName(value) || fallback).slice(0, LABEL_MAX);
}

/** Stable id for a topic: the map is regenerated wholesale, so the id has to come from the title. */
export function topicNodeId(workspaceId: string, title: string): string {
  const digest = createHash("sha1").update(`${workspaceId}\n${title.trim().toLowerCase()}`).digest("hex");
  return `topic:${digest.slice(0, 24)}`;
}

/** Write (or refresh) nodes. One immediate transaction; the input array is never mutated. */
export function upsertNodes(tenant: TenantContext, nodes: readonly GraphNodeInput[]): number {
  if (nodes.length === 0) {
    return 0;
  }
  const updatedAt = Date.now();
  const statement = sql.prepare(UPSERT_NODE);
  const tx = sql.transaction(() => {
    for (const node of nodes) {
      statement.run(
        node.id,
        tenant.workspaceId,
        node.kind,
        label(node.label, node.id),
        node.payload === undefined ? null : JSON.stringify(node.payload),
        updatedAt,
      );
    }
  });
  tx.immediate();
  return nodes.length;
}

/** Write (or refresh) edges. `weight` replaces the stored one: callers pass a recomputed total. */
export function upsertEdges(tenant: TenantContext, edges: readonly GraphEdgeInput[]): number {
  if (edges.length === 0) {
    return 0;
  }
  const updatedAt = Date.now();
  const statement = sql.prepare(UPSERT_EDGE);
  const tx = sql.transaction(() => {
    for (const edge of edges) {
      statement.run(tenant.workspaceId, edge.from, edge.to, edge.kind, edge.weight ?? 1, updatedAt);
    }
  });
  tx.immediate();
  return edges.length;
}

/** Display names for the source ids a projection touched. Missing ids are simply absent. */
function sourceLabels(workspaceId: string, ids: readonly string[]): Map<string, string> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = sql
    .prepare(
      `SELECT id, name FROM knowledge_sources WHERE workspace_id = ? AND id IN (${ids.map(() => "?").join(", ")})`,
    )
    .all(workspaceId, ...ids) as Array<{ id: string; name: string }>;
  return new Map(rows.map((row) => [row.id, row.name]));
}

function threadLabels(workspaceId: string, ids: readonly string[]): Map<string, string> {
  if (ids.length === 0) {
    return new Map();
  }
  try {
    const rows = sql
      .prepare(`SELECT id, title FROM threads WHERE workspace_id = ? AND id IN (${ids.map(() => "?").join(", ")})`)
      .all(workspaceId, ...ids) as Array<{ id: string; title: string }>;
    return new Map(rows.map((row) => [row.id, row.title]));
  } catch {
    // A thread title is a nicety; the id is always a usable label.
    return new Map();
  }
}

/**
 * Topic nodes plus `covers` edges (topic → source) from `topics[].sourceIds`. Source ids the
 * workspace no longer holds are dropped rather than drawn as dangling nodes.
 */
export function projectMapToGraph(tenant: TenantContext, map: KnowledgeMap): { nodes: number; edges: number } {
  const topics = Array.isArray(map.topics) ? map.topics : [];
  const referenced = [...new Set(topics.flatMap((topic) => topic.sourceIds ?? []))];
  const names = sourceLabels(tenant.workspaceId, referenced);
  const nodes: GraphNodeInput[] = [];
  const edges: GraphEdgeInput[] = [];
  for (const [id, name] of names) {
    nodes.push({ id, kind: "source", label: name });
  }
  for (const topic of topics) {
    const title = topic.title?.trim();
    if (!title) {
      continue;
    }
    const id = topicNodeId(tenant.workspaceId, title);
    nodes.push({ id, kind: "topic", label: title, payload: { verdict: topic.verdict } });
    for (const sourceId of topic.sourceIds ?? []) {
      if (names.has(sourceId)) {
        edges.push({ from: id, to: sourceId, kind: "covers", weight: 1 });
      }
    }
  }
  return { nodes: upsertNodes(tenant, nodes), edges: upsertEdges(tenant, edges) };
}

type RetrievalPair = { source_id: string; thread_id: string; n: number };

/**
 * How far back a `retrieved` edge weight counts. This aggregation runs after *every* reply, so an
 * all-time GROUP BY would make each answer pay for the workspace's entire retrieval history and
 * grow slower for the rest of the install's life. Ninety days is the window the graph describes;
 * `knowledge_retrievals` keeps the full record, and `countRetrievals` still reports all of it.
 */
export const RETRIEVAL_GRAPH_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function retrievalPairs(workspaceId: string, since: number, sourceIds?: readonly string[]): RetrievalPair[] {
  const scope = sourceIds && sourceIds.length > 0 ? ` AND source_id IN (${sourceIds.map(() => "?").join(", ")})` : "";
  return sql
    .prepare(
      `SELECT source_id, thread_id, count(*) AS n FROM knowledge_retrievals
       WHERE workspace_id = ? AND created_at >= ? AND thread_id IS NOT NULL${scope}
       GROUP BY source_id, thread_id`,
    )
    .all(workspaceId, since, ...(sourceIds ?? [])) as RetrievalPair[];
}

/**
 * `knowledge_retrievals` aggregated into `retrieved` edges (source → thread) whose weight is how
 * many chunks of that source that thread has been served in the last `RETRIEVAL_GRAPH_WINDOW_MS`.
 * Bounded twice over — by the window and by the sources of the run that called — and it never
 * throws: this runs right after a reply the user already has.
 */
export function projectRetrievalsToGraph(
  tenant: TenantContext,
  sourceIds?: readonly string[],
  since = Date.now() - RETRIEVAL_GRAPH_WINDOW_MS,
): { nodes: number; edges: number } {
  try {
    const pairs = retrievalPairs(tenant.workspaceId, since, sourceIds);
    if (pairs.length === 0) {
      return { nodes: 0, edges: 0 };
    }
    const names = sourceLabels(tenant.workspaceId, [...new Set(pairs.map((pair) => pair.source_id))]);
    const titles = threadLabels(tenant.workspaceId, [...new Set(pairs.map((pair) => pair.thread_id))]);
    const nodes: GraphNodeInput[] = [];
    const edges: GraphEdgeInput[] = [];
    for (const pair of pairs) {
      nodes.push({ id: pair.source_id, kind: "source", label: names.get(pair.source_id) ?? pair.source_id });
      nodes.push({ id: pair.thread_id, kind: "thread", label: titles.get(pair.thread_id) ?? pair.thread_id });
      edges.push({ from: pair.source_id, to: pair.thread_id, kind: "retrieved", weight: pair.n });
    }
    return { nodes: upsertNodes(tenant, nodes), edges: upsertEdges(tenant, edges) };
  } catch (error) {
    console.warn(
      `knowledge-graph: retrieval projection skipped (${error instanceof Error ? error.message.slice(0, 120) : "error"})`,
    );
    return { nodes: 0, edges: 0 };
  }
}

/**
 * `cites` edges (source → thread) for one completed Chat reply.
 *
 * The `[n]` markers are the only signal that a chunk was *used* rather than merely offered, and the
 * plan records them separately from `retrieved` for exactly that reason. There is no event table
 * behind this edge — a citation exists only in the reply text, which is never re-scanned — so the
 * aggregation happens here: each call adds 1 to the stored weight of every source it names. Call it
 * exactly once per completed turn (`runs.ts` does, next to `recordRetrievals`); a reply naming three
 * sources adds one to each of them, not three to one. Never throws: the reply is already on screen.
 */
const UPSERT_CITE = `INSERT INTO knowledge_graph_edges (workspace_id, from_id, to_id, kind, weight, updated_at)
  VALUES (?, ?, ?, 'cites', 1, ?)
  ON CONFLICT(workspace_id, from_id, to_id, kind) DO UPDATE SET
    weight = weight + 1,
    updated_at = excluded.updated_at`;

export type CiteInput = {
  /** The Chat thread the reply belongs to. */
  threadId: string;
  /** Source ids the reply cited, from `citedSources` / `parseCiteMarkers` in `knowledge-cites`. */
  sourceIds: readonly string[];
};

export function recordCites(tenant: TenantContext, cite: CiteInput): number {
  const sourceIds = [...new Set(cite.sourceIds)].filter((id) => id.length > 0);
  if (!cite.threadId || sourceIds.length === 0) {
    return 0;
  }
  try {
    const updatedAt = Date.now();
    const names = sourceLabels(tenant.workspaceId, sourceIds);
    const titles = threadLabels(tenant.workspaceId, [cite.threadId]);
    // The nodes are written first so the edge is always drawable (`getGraph` only returns edges
    // whose ends are in the node set). Missing rows fall back to the id, like the retrieval
    // projection: the graph is a view, never the system of record.
    upsertNodes(tenant, [
      ...sourceIds.map((id): GraphNodeInput => ({ id, kind: "source", label: names.get(id) ?? id })),
      { id: cite.threadId, kind: "thread", label: titles.get(cite.threadId) ?? cite.threadId },
    ]);
    const statement = sql.prepare(UPSERT_CITE);
    const tx = sql.transaction(() => {
      for (const id of sourceIds) {
        statement.run(tenant.workspaceId, id, cite.threadId, updatedAt);
      }
    });
    tx.immediate();
    return sourceIds.length;
  } catch (error) {
    console.warn(
      `knowledge-graph: cites not recorded (${error instanceof Error ? error.message.slice(0, 120) : "error"})`,
    );
    return 0;
  }
}

/**
 * The `limit` highest-degree nodes of one workspace, ordered and capped by SQLite.
 *
 * Degree is counted once, in a single grouped pass over this workspace's edges (`workspace_id` is
 * the leading column of the edge primary key, so that pass is index-driven), then joined onto the
 * node rows. The alternative — select every node row and sort in JS — made a 50-node answer read a
 * whole workspace. Ties break on `id` so the answer is a pure function of the database.
 */
export const GRAPH_NODE_QUERY = `SELECT n.id AS id, n.kind AS kind, n.label AS label
  FROM knowledge_graph_nodes n
  LEFT JOIN (
    SELECT id, count(*) AS degree FROM (
      SELECT from_id AS id FROM knowledge_graph_edges WHERE workspace_id = ?
      UNION ALL
      SELECT to_id AS id FROM knowledge_graph_edges WHERE workspace_id = ?
    ) GROUP BY id
  ) d ON d.id = n.id
  WHERE n.workspace_id = ?
  ORDER BY coalesce(d.degree, 0) DESC, n.id ASC
  LIMIT ?`;

/**
 * The graph a client can draw: the `limit` highest-degree nodes and the edges wholly inside that
 * set, so no edge points at a node the caller was not given. Deterministic for a given database.
 */
export function getGraph(tenant: TenantContext, options: { limit?: number } = {}): KnowledgeGraph {
  const limit = Math.max(0, Math.min(Math.floor(options.limit ?? 500), 5_000));
  try {
    const pool = sql
      .prepare(
        `SELECT from_id, to_id, kind, weight FROM knowledge_graph_edges
         WHERE workspace_id = ? ORDER BY weight DESC, kind, from_id, to_id LIMIT ?`,
      )
      .all(tenant.workspaceId, limit * EDGE_POOL_FACTOR) as Array<{
      from_id: string;
      to_id: string;
      kind: GraphEdgeKind;
      weight: number;
    }>;
    const pooled: GraphEdge[] = pool.map((row) => ({
      from: row.from_id,
      to: row.to_id,
      kind: row.kind,
      weight: row.weight,
    }));
    const ws = tenant.workspaceId;
    const nodes = sql.prepare(GRAPH_NODE_QUERY).all(ws, ws, ws, limit) as GraphNode[];
    const kept = new Set(nodes.map((node) => node.id));
    const edges = pooled.filter((edge) => kept.has(edge.from) && kept.has(edge.to)).slice(0, limit);
    return { nodes, edges };
  } catch (error) {
    console.warn(
      `knowledge-graph: read failed (${error instanceof Error ? error.message.slice(0, 120) : "error"})`,
    );
    return { nodes: [], edges: [] };
  }
}

/** Cheap counts for the loop chart's Graph stage. 0 when the tables are unreachable. */
export function graphCounts(tenant: TenantContext): { nodes: number; edges: number } {
  try {
    const nodes = sql
      .prepare("SELECT count(*) AS n FROM knowledge_graph_nodes WHERE workspace_id = ?")
      .get(tenant.workspaceId) as { n: number } | undefined;
    const edges = sql
      .prepare("SELECT count(*) AS n FROM knowledge_graph_edges WHERE workspace_id = ?")
      .get(tenant.workspaceId) as { n: number } | undefined;
    return { nodes: nodes?.n ?? 0, edges: edges?.n ?? 0 };
  } catch (error) {
    console.warn(
      `knowledge-graph: counts failed (${error instanceof Error ? error.message.slice(0, 120) : "error"})`,
    );
    return { nodes: 0, edges: 0 };
  }
}
