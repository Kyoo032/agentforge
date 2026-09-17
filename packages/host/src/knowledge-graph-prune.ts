import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";

/**
 * The delete side of the two knowledge projections that outlive their subject.
 *
 * `knowledge_graph_nodes` / `_edges` and `knowledge_retrievals` are written by every reply and were
 * never read back by a delete, so a removed source or thread kept a node, its edges and its
 * retrieval rows forever: the Graph stage of the loop chart counted knowledge that no longer
 * existed and the Retrieved stage could only ever go up.
 *
 * Two entry points, both workspace-scoped and both safe to call from anywhere:
 *
 * - `removeGraphForSource` / `removeGraphForThread` — the cascade. Called inside the same
 *   transaction as the row delete, so the projection can never survive its subject.
 * - `sweepOrphanGraph` — the self-heal, for rows left by builds that had no cascade. Nodes are
 *   pruned by kind: a `source` node needs a `knowledge_sources` row, a `thread` node needs a
 *   `threads` row, and a `topic` node is owned by the map blob and is never touched here.
 *
 * Nothing here throws. Every caller is on a path the user has already been told succeeded.
 */

export type GraphPruneCounts = {
  nodes: number;
  edges: number;
  retrievals: number;
};

const NO_CHANGES: GraphPruneCounts = { nodes: 0, edges: 0, retrievals: 0 };

function warn(what: string, error: unknown): void {
  console.warn(
    `knowledge-graph-prune: ${what} skipped (${error instanceof Error ? error.message.slice(0, 120) : "error"})`,
  );
}

/** The node itself plus every edge with it at either end. Statements only: the caller owns the transaction. */
function removeNode(workspaceId: string, nodeId: string): { nodes: number; edges: number } {
  const edges = sql
    .prepare("DELETE FROM knowledge_graph_edges WHERE workspace_id = ? AND (from_id = ? OR to_id = ?)")
    .run(workspaceId, nodeId, nodeId).changes;
  const nodes = sql
    .prepare("DELETE FROM knowledge_graph_nodes WHERE workspace_id = ? AND id = ?")
    .run(workspaceId, nodeId).changes;
  return { nodes, edges };
}

/**
 * Forget one source in both projections: its `source` node, every `covers` / `retrieved` / `cites`
 * edge that touches it, and every retrieval row that names it.
 *
 * Safe to call inside an open transaction (the statements take part in it) and safe to call outside
 * one. A source that was never retrieved simply removes nothing.
 */
export function removeGraphForSource(tenant: TenantContext, sourceId: string): GraphPruneCounts {
  try {
    const { nodes, edges } = removeNode(tenant.workspaceId, sourceId);
    const retrievals = sql
      .prepare("DELETE FROM knowledge_retrievals WHERE workspace_id = ? AND source_id = ?")
      .run(tenant.workspaceId, sourceId).changes;
    return { nodes, edges, retrievals };
  } catch (error) {
    warn(`source ${sourceId}`, error);
    return NO_CHANGES;
  }
}

/**
 * The same for a deleted Chat thread: its `thread` node, every edge pointing at it, and the
 * retrieval rows recorded against it. The thread's own work card is removed by `deleteSourceByOrigin`
 * on the source side, which cascades through `removeGraphForSource` for that card's node.
 */
export function removeGraphForThread(tenant: TenantContext, threadId: string): GraphPruneCounts {
  try {
    const { nodes, edges } = removeNode(tenant.workspaceId, threadId);
    const retrievals = sql
      .prepare("DELETE FROM knowledge_retrievals WHERE workspace_id = ? AND thread_id = ?")
      .run(tenant.workspaceId, threadId).changes;
    return { nodes, edges, retrievals };
  } catch (error) {
    warn(`thread ${threadId}`, error);
    return NO_CHANGES;
  }
}

/** True when the table can be read at all; a kind whose owner table is unreachable is never pruned. */
function readable(select: string, ...params: unknown[]): boolean {
  try {
    sql.prepare(select).get(...(params as never[]));
    return true;
  } catch (error) {
    warn(`owner lookup for ${select.slice(0, 40)}`, error);
    return false;
  }
}

/**
 * Remove projection rows whose subject is already gone.
 *
 * This is the repair pass for desks that accumulated orphans before the cascade existed — the
 * owner's own desk carried a graph of 18 nodes against one live source. It is cheap (four indexed
 * deletes), workspace-scoped, idempotent, and runs in one transaction.
 *
 * `topic` nodes are deliberately exempt: they are keyed off the map blob's titles, not off a row in
 * any table, so "no matching source" is not evidence that a topic is dead. Their dangling `covers`
 * edges are still removed by the edge pass below.
 */
export function sweepOrphanGraph(tenant: TenantContext): GraphPruneCounts {
  const ws = tenant.workspaceId;
  const hasThreads = readable("SELECT id FROM threads WHERE workspace_id = ? LIMIT 1", ws);
  try {
    const tx = sql.transaction(() => {
      let nodes = sql
        .prepare(
          `DELETE FROM knowledge_graph_nodes
           WHERE workspace_id = ? AND kind = 'source'
             AND id NOT IN (SELECT id FROM knowledge_sources WHERE workspace_id = ?)`,
        )
        .run(ws, ws).changes;
      if (hasThreads) {
        nodes += sql
          .prepare(
            `DELETE FROM knowledge_graph_nodes
             WHERE workspace_id = ? AND kind = 'thread'
               AND id NOT IN (SELECT id FROM threads WHERE workspace_id = ?)`,
          )
          .run(ws, ws).changes;
      }
      // After the node pass, so an edge left dangling by it goes in the same sweep. This also
      // collects `covers` edges from a live topic to a source that was deleted.
      const edges = sql
        .prepare(
          `DELETE FROM knowledge_graph_edges
           WHERE workspace_id = ?
             AND (from_id NOT IN (SELECT id FROM knowledge_graph_nodes WHERE workspace_id = ?)
               OR to_id NOT IN (SELECT id FROM knowledge_graph_nodes WHERE workspace_id = ?))`,
        )
        .run(ws, ws, ws).changes;
      let retrievals = sql
        .prepare(
          `DELETE FROM knowledge_retrievals
           WHERE workspace_id = ?
             AND source_id NOT IN (SELECT id FROM knowledge_sources WHERE workspace_id = ?)`,
        )
        .run(ws, ws).changes;
      if (hasThreads) {
        retrievals += sql
          .prepare(
            `DELETE FROM knowledge_retrievals
             WHERE workspace_id = ? AND thread_id IS NOT NULL
               AND thread_id NOT IN (SELECT id FROM threads WHERE workspace_id = ?)`,
          )
          .run(ws, ws).changes;
      }
      return { nodes, edges, retrievals };
    });
    return tx.immediate();
  } catch (error) {
    warn("orphan sweep", error);
    return NO_CHANGES;
  }
}
