import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";

/**
 * What the retrieval backend still owes us.
 *
 * The Saved → Indexed edge of the knowledge loop must never break because a sidecar was down: the
 * FTS rows are written regardless, and the backend's half of the write is queued here instead of
 * lost. Rows are drained on the next health-OK transition and on `GET /api/v1/knowledge`.
 *
 * One row per `(workspace, source, op)`: a source indexed three times while the backend was down
 * owes one index, not three, and a delete supersedes a pending index for the same source — the
 * final state is what matters, never the sequence that produced it.
 */

export type OutboxOp = "index" | "delete";

export type OutboxEntry = {
  id: string;
  op: OutboxOp;
  sourceId: string;
  externalId: string | null;
  payload: string | null;
  attempts: number;
};

/** A row that has failed this many times is dropped: it is poison, and the source is re-indexable. */
export const MAX_ATTEMPTS = 5;

function rowsToEntries(rows: unknown[]): OutboxEntry[] {
  return (
    rows as Array<{
      id: string;
      op: string;
      source_id: string;
      external_id: string | null;
      payload: string | null;
      attempts: number;
    }>
  ).map((row) => ({
    id: row.id,
    op: row.op === "delete" ? "delete" : "index",
    sourceId: row.source_id,
    externalId: row.external_id,
    payload: row.payload,
    attempts: row.attempts,
  }));
}

/**
 * Queue one operation, collapsing what is already pending for that source. Never throws: an outbox
 * that cannot be written is a lost re-index, not a failed ingest.
 */
export function enqueueOutbox(
  tenant: TenantContext,
  entry: { op: OutboxOp; sourceId: string; externalId?: string | null; payload?: string | null },
): void {
  try {
    const tx = sql.transaction(() => {
      sql
        .prepare("DELETE FROM knowledge_backend_outbox WHERE workspace_id = ? AND source_id = ?")
        .run(tenant.workspaceId, entry.sourceId);
      sql
        .prepare(
          `INSERT INTO knowledge_backend_outbox
           (id, workspace_id, op, source_id, external_id, payload, attempts, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(
          crypto.randomUUID(),
          tenant.workspaceId,
          entry.op,
          entry.sourceId,
          entry.externalId ?? null,
          entry.payload ?? null,
          Date.now(),
        );
    });
    tx.immediate();
  } catch (error) {
    console.warn(`knowledge-outbox: ${entry.op} for ${entry.sourceId} not queued (${short(error)})`);
  }
}

export function outboxDepth(tenant: TenantContext): number {
  try {
    const row = sql
      .prepare("SELECT count(*) AS n FROM knowledge_backend_outbox WHERE workspace_id = ?")
      .get(tenant.workspaceId) as { n: number };
    return row.n;
  } catch {
    return 0;
  }
}

/**
 * Is anything queued for this source? The registry's only honest signal that a write failed: both
 * `indexSource` and `deleteSource` swallow their errors into this table by contract, so a row here
 * is what "the backend refused" looks like from the outside.
 */
export function hasOutboxEntry(tenant: TenantContext, sourceId: string): boolean {
  try {
    const row = sql
      .prepare("SELECT 1 AS ok FROM knowledge_backend_outbox WHERE workspace_id = ? AND source_id = ? LIMIT 1")
      .get(tenant.workspaceId, sourceId) as { ok: number } | undefined;
    return row !== undefined;
  } catch {
    return false;
  }
}

export function pendingOutbox(tenant: TenantContext, limit: number): OutboxEntry[] {
  try {
    const rows = sql
      .prepare(
        `SELECT id, op, source_id, external_id, payload, attempts FROM knowledge_backend_outbox
         WHERE workspace_id = ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(tenant.workspaceId, Math.max(1, limit));
    return rowsToEntries(rows);
  } catch {
    return [];
  }
}

export function removeOutbox(tenant: TenantContext, id: string): void {
  try {
    sql.prepare("DELETE FROM knowledge_backend_outbox WHERE workspace_id = ? AND id = ?").run(tenant.workspaceId, id);
  } catch (error) {
    console.warn(`knowledge-outbox: row ${id} not removed (${short(error)})`);
  }
}

/** Count a failed attempt, dropping the row once it has failed too often to be worth retrying. */
export function failOutbox(tenant: TenantContext, entry: OutboxEntry): void {
  if (entry.attempts + 1 >= MAX_ATTEMPTS) {
    console.warn(`knowledge-outbox: dropping ${entry.op} for ${entry.sourceId} after ${MAX_ATTEMPTS} attempts`);
    removeOutbox(tenant, entry.id);
    return;
  }
  try {
    sql
      .prepare("UPDATE knowledge_backend_outbox SET attempts = attempts + 1 WHERE workspace_id = ? AND id = ?")
      .run(tenant.workspaceId, entry.id);
  } catch (error) {
    console.warn(`knowledge-outbox: attempt not recorded for ${entry.id} (${short(error)})`);
  }
}

export function clearOutbox(tenant: TenantContext): void {
  try {
    sql.prepare("DELETE FROM knowledge_backend_outbox WHERE workspace_id = ?").run(tenant.workspaceId);
  } catch (error) {
    console.warn(`knowledge-outbox: not cleared (${short(error)})`);
  }
}

function short(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : "error";
}
