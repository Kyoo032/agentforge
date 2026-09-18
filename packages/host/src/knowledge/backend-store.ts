import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { log } from "../log";

/**
 * The SQLite side of a remote retrieval backend: which knowledge base a workspace is bound to,
 * which of our sources the backend already holds, and what it still owes us.
 *
 * All of it is *derived* state. `knowledge_sources` / `knowledge_chunks` remain the system of
 * record, so dropping every row here costs a re-index and never a card — which is exactly why the
 * backfill can be resumed and the outbox can be drained out of order.
 */

export type WorkspaceBinding = {
  backendId: string;
  kbId: string | null;
  modelId: string | null;
  embeddingModel: string | null;
  /** The gateway base URL the backend-side model row was created against. */
  gatewayBaseUrl: string | null;
  /** sha256 of the gateway key that model row holds; see bootstrap.ts `fingerprintKey`. */
  gatewayKeyFp: string | null;
};

export function getWorkspaceBinding(tenant: TenantContext, backendId: string): WorkspaceBinding | null {
  const row = sql
    .prepare(
      `SELECT backend_id, kb_id, model_id, embedding_model, gateway_base_url, gateway_key_fp
       FROM knowledge_workspace_backend WHERE workspace_id = ?`,
    )
    .get(tenant.workspaceId) as
    | {
        backend_id: string;
        kb_id: string | null;
        model_id: string | null;
        embedding_model: string | null;
        gateway_base_url: string | null;
        gateway_key_fp: string | null;
      }
    | undefined;
  if (!row || row.backend_id !== backendId) {
    return null;
  }
  return {
    backendId: row.backend_id,
    kbId: row.kb_id,
    modelId: row.model_id,
    embeddingModel: row.embedding_model,
    gatewayBaseUrl: row.gateway_base_url,
    gatewayKeyFp: row.gateway_key_fp,
  };
}

const UPSERT_BINDING = `INSERT INTO knowledge_workspace_backend
  (workspace_id, backend_id, kb_id, model_id, embedding_model, gateway_base_url, gateway_key_fp, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(workspace_id) DO UPDATE SET
    backend_id = excluded.backend_id,
    kb_id = excluded.kb_id,
    model_id = excluded.model_id,
    embedding_model = excluded.embedding_model,
    gateway_base_url = excluded.gateway_base_url,
    gateway_key_fp = excluded.gateway_key_fp,
    updated_at = excluded.updated_at`;

export function putWorkspaceBinding(tenant: TenantContext, binding: WorkspaceBinding): WorkspaceBinding {
  sql
    .prepare(UPSERT_BINDING)
    .run(
      tenant.workspaceId,
      binding.backendId,
      binding.kbId,
      binding.modelId,
      binding.embeddingModel,
      binding.gatewayBaseUrl,
      binding.gatewayKeyFp,
      Date.now(),
    );
  return { ...binding };
}

/**
 * Forget the backend-side model row this desk was bound to, without touching its knowledge base.
 *
 * Used when the gateway key that row holds has been revoked: the cached id must not be handed to a
 * new knowledge base, and the next bootstrap has to mint a row against the current credentials.
 */
export function clearWorkspaceModelId(tenant: TenantContext): void {
  try {
    sql
      .prepare(
        `UPDATE knowledge_workspace_backend
         SET model_id = NULL, gateway_base_url = NULL, gateway_key_fp = NULL, updated_at = ?
         WHERE workspace_id = ?`,
      )
      .run(Date.now(), tenant.workspaceId);
  } catch (error) {
    log.warn("knowledge_backend_binding_not_cleared", {
      detail: error instanceof Error ? error.message.slice(0, 120) : "error",
    });
  }
}

/** The backend's handle on one of our sources, or null when it holds nothing for it. */
export function getExternalId(tenant: TenantContext, sourceId: string): string | null {
  const row = sql
    .prepare("SELECT external_id FROM knowledge_sources WHERE workspace_id = ? AND id = ?")
    .get(tenant.workspaceId, sourceId) as { external_id: string | null } | undefined;
  return row?.external_id ?? null;
}

export function setExternalId(tenant: TenantContext, sourceId: string, externalId: string | null): void {
  sql
    .prepare("UPDATE knowledge_sources SET external_id = ? WHERE workspace_id = ? AND id = ?")
    .run(externalId, tenant.workspaceId, sourceId);
}

export type SourceIdentity = { id: string; name: string };

/** Our source row for an id, scoped to this workspace. The name is the citation marker's source. */
export function sourceById(tenant: TenantContext, sourceId: string): SourceIdentity | null {
  const row = sql
    .prepare("SELECT id, name FROM knowledge_sources WHERE workspace_id = ? AND id = ?")
    .get(tenant.workspaceId, sourceId) as SourceIdentity | undefined;
  return row ?? null;
}

/** Our source row for a backend handle, scoped to this workspace. */
export function sourceByExternalId(tenant: TenantContext, externalId: string): SourceIdentity | null {
  const row = sql
    .prepare("SELECT id, name FROM knowledge_sources WHERE workspace_id = ? AND external_id = ?")
    .get(tenant.workspaceId, externalId) as SourceIdentity | undefined;
  return row ?? null;
}

/** Sources this backend does not hold yet. Ordered oldest first so a backfill makes visible progress. */
export function sourcesMissingExternalId(tenant: TenantContext, limit: number): string[] {
  const rows = sql
    .prepare(
      `SELECT id FROM knowledge_sources
       WHERE workspace_id = ? AND status = 'Indexed' AND (external_id IS NULL OR external_id = '')
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(tenant.workspaceId, Math.max(1, limit)) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function countSourcesMissingExternalId(tenant: TenantContext): number {
  const row = sql
    .prepare(
      `SELECT count(*) AS n FROM knowledge_sources
       WHERE workspace_id = ? AND status = 'Indexed' AND (external_id IS NULL OR external_id = '')`,
    )
    .get(tenant.workspaceId) as { n: number };
  return row.n;
}
