import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import type { RetrievedChunk } from "./knowledge/backend";
import { projectRetrievalsToGraph } from "./knowledge-graph";
import { log } from "./log";

/**
 * The measured Retrieved stage of the knowledge loop: one row per chunk a run was actually given.
 * Also the first retrieval graph edge (source → thread), which Phase 2 projects into the graph.
 */
export type RetrievalEvent = {
  /** The Chat thread the chunks were injected into, when there is one. */
  threadId?: string | null;
  runId?: string | null;
  /** Which engine served the chunks (`builtin` today). */
  backend: string;
  chunks: RetrievedChunk[];
};

/**
 * Whether a finished run should have its Retrieved edge counted.
 *
 * A run that broke mid-stream but still saved partial assistant text is finished as `completed`, and
 * it was handed exactly the same chunks the clean path was. Both call sites in `runs.ts` ask here so
 * the two branches cannot drift apart and undercount retrieval where it matters most.
 */
export function recordsRetrievals(finished: boolean, status: "completed" | "failed"): boolean {
  return finished && status === "completed";
}

const INSERT_RETRIEVAL = `INSERT INTO knowledge_retrievals
  (id, workspace_id, thread_id, run_id, source_id, chunk_index, score, backend, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Record what one run retrieved. Never throws: a run that already answered the user must not fail
 * because a counter could not be written. All rows land in one transaction or none do.
 */
export function recordRetrievals(tenant: TenantContext, event: RetrievalEvent): number {
  if (event.chunks.length === 0) {
    return 0;
  }
  try {
    const createdAt = Date.now();
    const insert = sql.prepare(INSERT_RETRIEVAL);
    const tx = sql.transaction(() => {
      for (const chunk of event.chunks) {
        insert.run(
          crypto.randomUUID(),
          tenant.workspaceId,
          event.threadId ?? null,
          event.runId ?? null,
          chunk.sourceId,
          chunk.chunkIndex,
          chunk.score,
          event.backend,
          createdAt,
        );
      }
    });
    tx.immediate();
    // The rows are the record; the graph is a projection of them. Recomputed for the sources this
    // event touched, so the `retrieved` edge weight is a count and never double-adds on a retry.
    projectRetrievalsToGraph(tenant, [...new Set(event.chunks.map((chunk) => chunk.sourceId))]);
    return event.chunks.length;
  } catch (error) {
    log.warn("knowledge_retrievals_not_recorded", {
      detail: error instanceof Error ? error.message.slice(0, 120) : "error",
    });
    return 0;
  }
}

/** How many chunks this workspace has ever been served. 0 when the counter table is unreachable. */
export function countRetrievals(tenant: TenantContext): number {
  try {
    const row = sql
      .prepare("SELECT count(*) AS n FROM knowledge_retrievals WHERE workspace_id = ?")
      .get(tenant.workspaceId) as { n: number } | undefined;
    return row?.n ?? 0;
  } catch (error) {
    log.warn("knowledge_retrievals_count_failed", {
      detail: error instanceof Error ? error.message.slice(0, 120) : "error",
    });
    return 0;
  }
}
