/**
 * Phase 8 — erase one tenant's rows, and nobody else's.
 *
 * This is the database half of the hosted "Start over". The file half (the storage prefix, the
 * secrets, the gate verdict) lives in `packages/host/src/tenant-reset.ts`, which drives this.
 *
 * **Why this is a plan and not a list of DELETE statements.** The schema has forty-odd tables and
 * will have more. A hand-written sequence of deletes is correct on the day it is written and
 * silently wrong the first time somebody adds a table, in the worst possible direction: a table
 * nobody classified is a table whose rows survive a reset, so a tenant who asked for their data to
 * be gone keeps a copy of it and nobody finds out. So every table in the schema is classified here
 * into exactly one bucket, and `tenant-purge.test.ts` re-derives the real table list from a fresh
 * `ensureSchema` database and fails when a table is in none of them. A new table cannot ship
 * without somebody deciding what a reset does to it.
 *
 * **The four buckets.**
 *
 * - `cascade` — `organizations`. One DELETE by `tenant_id` takes workspaces, agents, threads,
 *   messages, runs, tool invocations, media and the edit trees with it, because every one of those
 *   declares `ON DELETE cascade` up to it and `client.ts` sets `PRAGMA foreign_keys = ON`. Letting
 *   SQLite do this is not laziness: the cascade is derived from the same schema the tables are, so
 *   it cannot fall out of step with them the way a hand-kept order would.
 * - `byWorkspace` — the knowledge tables, `artifacts` and `datasets`. These carry a
 *   `workspace_id` with no foreign key (they predate the tenancy work and are written by
 *   subsystems that never held an org id), so the cascade does not reach them. They are deleted
 *   **first**, while the workspace ids are still resolvable, because the cascade is what destroys
 *   the only mapping from a tenant to its desks.
 * - `byTenant` — `tenant_state` (the sealed settings envelope and the gate verdict) and
 *   `tenant_storage` (the byte counter, which must go to nothing at the same moment the bytes do).
 * - `kept` and `shared` — everything a reset must NOT touch, each with its reason on the line.
 *
 * **What is deliberately kept.** `tenants`, `tenant_plan`, `tenant_seat`, `tenant_usage` and
 * `billing_events`: a tenant must not be able to erase what they owe, what they have spent or how
 * many seats they hold by pressing a button in their own settings. `tenant_reset_audit` is kept
 * for the same reason plus one more — it is the record of this act, and a reset that erased its
 * own audit trail would be worse than one that kept nothing. `auth_sessions` is kept because a
 * reset empties an account, it does not close it: signing every colleague out of a tenant that
 * still exists is a surprise nobody asked for, and the caller driving the reset would lose the
 * session mid-request.
 *
 * **One transaction, and therefore idempotent.** Everything below runs inside a single
 * `better-sqlite3` transaction, so a process killed half way through leaves the database exactly
 * as it was and the retry starts from the same place. Every statement is a DELETE by id, so a
 * retry after a *completed* purge deletes nothing and reports zero rather than failing.
 */
import type Database from "better-sqlite3";

/** The narrow slice of a connection this module needs. Declared so a test can pass a scratch DB. */
export type PurgeSql = Pick<Database.Database, "prepare" | "transaction">;

/**
 * Tables the cascade from `organizations` reaches, listed so the completeness test can account for
 * them without a second DELETE. Nothing here is deleted by name — SQLite does it.
 */
export const CASCADED_TABLES = [
  "workspaces",
  "workspace_members",
  "organization_members",
  "agents",
  "agent_versions",
  "agent_tool_bindings",
  "threads",
  "messages",
  "runs",
  "tool_invocations",
  "media",
  "edit_projects",
  "edit_ops",
  "edit_snapshots",
  "edit_jobs",
  "edit_cards",
  "edit_unplaced",
] as const;

/**
 * Tables keyed by a bare `workspace_id` with no foreign key, so the cascade never reaches them.
 * Deleted before the cascade runs, while the tenant's workspace ids can still be resolved.
 *
 * `knowledge_chunks` is an FTS5 virtual table and is deleted the same way the rest of the host
 * already deletes from it (`ensure-local-owner.ts:221`, `knowledge-reindex.ts:238`): a plain
 * `WHERE workspace_id = ?`, which fts5 answers with a scan.
 */
export const WORKSPACE_SCOPED_TABLES = [
  "knowledge_soul",
  "knowledge_memories",
  "knowledge_sources",
  "knowledge_chunks",
  "knowledge_workspace_backend",
  "knowledge_backend_outbox",
  "knowledge_settings",
  "knowledge_vectors",
  "knowledge_retrievals",
  "knowledge_graph_nodes",
  "knowledge_graph_edges",
  "knowledge_verify",
  "knowledge_maps",
  "artifacts",
  "datasets",
] as const;

/** Tables keyed directly by `tenant_id` that a reset clears. */
export const TENANT_SCOPED_TABLES = [
  // The sealed settings envelope and the gate verdict (Phase 4). Erasing a tenant's content and
  // leaving their saved gateway key behind would be the one surprise nobody wants from this button.
  "tenant_state",
  // The byte counter (Phase 6). It has to reach zero in the same transaction the rows do, or the
  // tenant is billed storage for objects that no longer exist until somebody runs a recompute.
  "tenant_storage",
] as const;

/**
 * Tables keyed by `tenant_id` that a reset deliberately LEAVES, each with the reason.
 *
 * Read this list as policy, not as an oversight: every entry is something a tenant would benefit
 * from erasing, which is exactly why they may not.
 */
export const KEPT_TENANT_TABLES: Readonly<Record<string, string>> = Object.freeze({
  tenants: "the account itself; a reset empties it, it does not close it",
  tenant_plan: "what the tenant is entitled to and has spent — not theirs to erase",
  tenant_seat: "seats held; erasing them would reset the seat cap from inside the product",
  tenant_usage: "the spend ledger the invoice is built from",
  billing_events: "the provider's own record, idempotency keys included",
  tenant_reset_audit: "the record of this act; a reset that erased it would explain nothing",
  auth_sessions: "a reset empties an account, it does not sign its people out",
});

/**
 * Tables that belong to no tenant. Not kept *for* the tenant — there is nothing of theirs in them.
 */
export const SHARED_TABLES: Readonly<Record<string, string>> = Object.freeze({
  user: "portal identities, shared across orgs and tenants",
  tools: "the tool catalogue; the per-tenant bindings go with the cascade",
  market_cache: "a read-through cache of public market data, keyed by ticker",
  market_news_fts: "the FTS index over that same public cache",
  __drizzle_migrations: "the migration journal",
});

/** The root delete. Everything in `CASCADED_TABLES` goes with it. */
export const CASCADE_ROOT_TABLE = "organizations";

export type TenantPurgeResult = {
  /** Rows this purge actually removed, summed over every statement it ran. */
  readonly rowsDeleted: number;
  /** The workspace ids the tenant held, resolved before the cascade destroyed the mapping. */
  readonly workspaceIds: readonly string[];
};

function workspaceIdsOf(sql: PurgeSql, tenantId: string): string[] {
  const rows = sql
    .prepare(
      `SELECT w.id AS id
         FROM workspaces w
         JOIN organizations o ON o.id = w.organization_id
        WHERE o.tenant_id = ?`,
    )
    .all(tenantId) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

/**
 * Every workspace id this tenant holds. Exported because the host half needs the same list to
 * decide which on-disk job trees belong to the tenant, and it has to read it **before** the purge.
 */
export function tenantWorkspaceIds(sql: PurgeSql, tenantId: string): string[] {
  return workspaceIdsOf(sql, tenantId);
}

/**
 * Delete one tenant's content. Synchronous and transactional; see the module comment for what is
 * removed, what is kept and why.
 *
 * `tenantId` is used only as a bound parameter, never interpolated. The table names below are
 * compile-time constants from the arrays above and never come from a caller.
 */
export function purgeTenantRows(sql: PurgeSql, tenantId: string): TenantPurgeResult {
  const run = sql.transaction((): TenantPurgeResult => {
    const workspaceIds = workspaceIdsOf(sql, tenantId);
    let rowsDeleted = 0;

    // Workspace-scoped first: the cascade below deletes `workspaces`, and after that there is no
    // way left to tell this tenant's knowledge rows from anybody else's.
    for (const table of WORKSPACE_SCOPED_TABLES) {
      const statement = sql.prepare(`DELETE FROM ${table} WHERE workspace_id = ?`);
      for (const workspaceId of workspaceIds) {
        rowsDeleted += Number(statement.run(workspaceId).changes ?? 0);
      }
    }

    // The cascade root. One statement, and SQLite takes `CASCADED_TABLES` with it. `changes`
    // counts only the organizations rows, which is why `rowsDeleted` is a floor and the audit row
    // says so rather than claiming a total nobody measured.
    rowsDeleted += Number(
      sql.prepare(`DELETE FROM ${CASCADE_ROOT_TABLE} WHERE tenant_id = ?`).run(tenantId).changes ?? 0,
    );

    for (const table of TENANT_SCOPED_TABLES) {
      rowsDeleted += Number(sql.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(tenantId).changes ?? 0);
    }

    return { rowsDeleted, workspaceIds };
  });
  return run();
}
