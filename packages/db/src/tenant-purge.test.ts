/**
 * Phase 8 — the per-tenant purge, and the one test that will still be right next year.
 *
 * Three things have to hold and only one of them is about the rows this purge deletes today.
 *
 * 1. **Completeness.** Every table in a fresh schema is classified into exactly one bucket. This is
 *    the test that matters: a hand-written sequence of deletes is correct the day it is written and
 *    silently wrong the first time somebody adds a table, in the worst direction — rows that
 *    survive a reset the tenant asked for. Adding a table without deciding what a reset does to it
 *    fails here.
 * 2. **Isolation.** A purge of one tenant leaves another tenant's rows exactly as they were. The
 *    cascade does most of the work, so this is really a test that the cascade is wired the way the
 *    schema says and that `PRAGMA foreign_keys` is on.
 * 3. **Idempotence.** Running it twice removes what the first pass missed and reports zero for what
 *    it already took, because the storage half is not atomic and "run it again" is the answer to a
 *    partial failure.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema } from "./ensure-schema";
import {
  CASCADED_TABLES,
  CASCADE_ROOT_TABLE,
  KEPT_TENANT_TABLES,
  SHARED_TABLES,
  TENANT_SCOPED_TABLES,
  WORKSPACE_SCOPED_TABLES,
  purgeTenantRows,
  tenantWorkspaceIds,
} from "./tenant-purge";

/**
 * FTS5 creates shadow tables beside the virtual one (`<name>_data`, `_idx`, `_content`, `_docsize`,
 * `_config`). They are SQLite's internal storage for the index, never rows anybody writes, and
 * deleting from the virtual table maintains them. Classifying them would be classifying an
 * implementation detail.
 */
const FTS_TABLES = ["knowledge_chunks", "market_news_fts"] as const;
const FTS_SUFFIXES = ["_data", "_idx", "_content", "_docsize", "_config"] as const;

function isFtsShadow(name: string): boolean {
  return FTS_TABLES.some((base) => FTS_SUFFIXES.some((suffix) => name === `${base}${suffix}`));
}

function tableNames(sqlite: Database.Database): string[] {
  return (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
    .map((row) => row.name)
    .filter((name) => !isFtsShadow(name));
}

type Seeded = { tenantId: string; orgId: string; workspaceId: string; agentId: string; threadId: string };

/** One tenant with a row in every table the purge touches, so "deleted" and "kept" both mean something. */
function seedTenant(sqlite: Database.Database, id: string): Seeded {
  const now = Date.now();
  const orgId = `${id}-org`;
  const workspaceId = `${id}-ws`;
  const agentId = `${id}-agent`;
  const threadId = `${id}-thread`;
  const userId = `${id}-user`;

  sqlite
    .prepare("INSERT INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, 'active', ?)")
    .run(id, id, id, now);
  sqlite
    .prepare("INSERT INTO organizations (id, tenant_id, name, slug, industry_pack, created_at) VALUES (?, ?, ?, ?, 'generic', ?)")
    .run(orgId, id, orgId, orgId, now);
  sqlite
    .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)")
    .run(userId, userId, `${userId}@portal.invalid`, now, now);
  sqlite
    .prepare("INSERT INTO organization_members (id, organization_id, user_id, role) VALUES (?, ?, ?, 'owner')")
    .run(`${id}-member`, orgId, userId);
  sqlite
    .prepare("INSERT INTO workspaces (id, organization_id, name, slug, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(workspaceId, orgId, workspaceId, workspaceId, now);
  sqlite
    .prepare(
      "INSERT INTO agents (id, organization_id, workspace_id, name, slug, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(agentId, orgId, workspaceId, agentId, agentId, userId, now, now);
  sqlite
    .prepare(
      "INSERT INTO threads (id, organization_id, workspace_id, agent_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(threadId, orgId, workspaceId, agentId, userId, now);
  sqlite
    .prepare(
      "INSERT INTO messages (id, organization_id, thread_id, role, content, created_at) VALUES (?, ?, ?, 'user', 'hello', ?)",
    )
    .run(`${id}-msg`, orgId, threadId, now);
  sqlite
    .prepare(
      "INSERT INTO media (id, organization_id, user_id, kind, mime, size_bytes, storage_path, url, created_at) VALUES (?, ?, ?, 'image', 'image/png', 10, ?, ?, ?)",
    )
    .run(`${id}-media`, orgId, userId, `tenants/${id}/a.png`, "/api/v1/media/x/file", now);

  // Workspace-keyed, no foreign key: the tables the cascade cannot reach.
  sqlite
    .prepare("INSERT INTO knowledge_memories (id, workspace_id, text, created_at) VALUES (?, ?, 'm', ?)")
    .run(`${id}-mem`, workspaceId, now);
  sqlite
    .prepare("INSERT INTO knowledge_chunks (source_id, workspace_id, body) VALUES (?, ?, 'chunk')")
    .run(`${id}-src`, workspaceId);
  sqlite
    .prepare(
      "INSERT INTO artifacts (id, workspace_id, mode, kind, title, mime, body, meta, size_bytes, created_at, updated_at) VALUES (?, ?, 'research', 'doc', 't', 'text/plain', 'b', '{}', 1, ?, ?)",
    )
    .run(`${id}-artifact`, workspaceId, now, now);
  sqlite
    .prepare(
      "INSERT INTO datasets (id, workspace_id, name, filename, rows, cols, columns, storage_path, size_bytes, created_at) VALUES (?, ?, 'd', 'd.csv', 1, 1, '[]', ?, 1, ?)",
    )
    .run(`${id}-dataset`, workspaceId, `datasets/tenants/${id}/d.csv`, now);

  // Tenant-keyed: two that go, five that stay.
  sqlite
    .prepare("INSERT INTO tenant_state (tenant_id, key, value, updated_at) VALUES (?, 'settings', 'sealed', ?)")
    .run(id, now);
  sqlite
    .prepare(
      "INSERT INTO tenant_storage (tenant_id, bytes_used, object_count, measured_at, updated_at) VALUES (?, 4096, 2, NULL, ?)",
    )
    .run(id, now);
  sqlite
    .prepare(
      "INSERT INTO tenant_usage (id, tenant_id, organization_id, mode, model, unit, quantity, at) VALUES (?, ?, ?, 'chat', 'm', 'token', 1, ?)",
    )
    .run(`${id}-usage`, id, orgId, now);
  sqlite
    .prepare("INSERT INTO tenant_plan (tenant_id, period_start, period_end, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, now, now + 1000, now);
  sqlite
    .prepare("INSERT INTO tenant_seat (tenant_id, user_id, organization_id, claimed_at) VALUES (?, ?, ?, ?)")
    .run(id, userId, orgId, now);
  sqlite
    .prepare(
      "INSERT INTO billing_events (event_id, tenant_id, kind, occurred_at, received_at) VALUES (?, ?, 'paid', ?, ?)",
    )
    .run(`${id}-event`, id, now, now);
  sqlite
    .prepare(
      "INSERT INTO auth_sessions (id, tenant_id, user_id, org_id, created_at, last_seen_at, expires_at, absolute_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(`${id}-session`, id, userId, orgId, now, now, now + 1000, now + 2000);

  return { tenantId: id, orgId, workspaceId, agentId, threadId };
}

function count(sqlite: Database.Database, table: string, column: string, value: string): number {
  const row = sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`).get(value) as { n: number };
  return row.n;
}

describe("the purge plan covers the whole schema", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ensureSchema(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("classifies every table into exactly one bucket", () => {
    const buckets = new Map<string, string>();
    const add = (name: string, bucket: string) => {
      const already = buckets.get(name);
      if (already) {
        throw new Error(`${name} is in both "${already}" and "${bucket}"`);
      }
      buckets.set(name, bucket);
    };
    for (const name of CASCADED_TABLES) add(name, "cascaded");
    for (const name of WORKSPACE_SCOPED_TABLES) add(name, "byWorkspace");
    for (const name of TENANT_SCOPED_TABLES) add(name, "byTenant");
    for (const name of Object.keys(KEPT_TENANT_TABLES)) add(name, "kept");
    for (const name of Object.keys(SHARED_TABLES)) add(name, "shared");
    add(CASCADE_ROOT_TABLE, "cascadeRoot");

    const real = tableNames(sqlite).sort();
    const unclassified = real.filter((name) => !buckets.has(name));
    const phantom = [...buckets.keys()].filter((name) => !real.includes(name));

    // A new table with no decision behind it lands here. The fix is to put it in a bucket in
    // `tenant-purge.ts` — including `SHARED_TABLES`, if a reset genuinely must not touch it.
    expect(unclassified, "tables nobody decided about").toEqual([]);
    // And a bucket entry for a table that no longer exists is just as wrong: a DELETE against it
    // would throw mid-transaction and take the whole reset with it.
    expect(phantom, "classified tables that are not in the schema").toEqual([]);
  });

  it("every table it names by hand really exists, so a DELETE cannot throw mid-transaction", () => {
    const real = new Set(tableNames(sqlite));
    for (const name of [...WORKSPACE_SCOPED_TABLES, ...TENANT_SCOPED_TABLES, CASCADE_ROOT_TABLE]) {
      expect(real.has(name), `${name} is missing from the schema`).toBe(true);
    }
  });
});

describe("purgeTenantRows", () => {
  let sqlite: Database.Database;
  let alpha: Seeded;
  let beta: Seeded;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    sqlite.pragma("foreign_keys = ON");
    alpha = seedTenant(sqlite, "alpha");
    beta = seedTenant(sqlite, "beta");
  });

  afterEach(() => {
    sqlite.close();
  });

  it("resolves the tenant's desks before the cascade destroys the mapping", () => {
    expect(tenantWorkspaceIds(sqlite, alpha.tenantId)).toEqual([alpha.workspaceId]);
    const result = purgeTenantRows(sqlite, alpha.tenantId);
    expect(result.workspaceIds).toEqual([alpha.workspaceId]);
    // After the purge there is no mapping left at all, which is exactly why it is read first.
    expect(tenantWorkspaceIds(sqlite, alpha.tenantId)).toEqual([]);
  });

  it("takes the tenant's content, through the cascade and by hand", () => {
    purgeTenantRows(sqlite, alpha.tenantId);
    expect(count(sqlite, "organizations", "tenant_id", alpha.tenantId)).toBe(0);
    // Cascaded.
    expect(count(sqlite, "workspaces", "organization_id", alpha.orgId)).toBe(0);
    expect(count(sqlite, "agents", "organization_id", alpha.orgId)).toBe(0);
    expect(count(sqlite, "threads", "organization_id", alpha.orgId)).toBe(0);
    expect(count(sqlite, "messages", "organization_id", alpha.orgId)).toBe(0);
    expect(count(sqlite, "media", "organization_id", alpha.orgId)).toBe(0);
    expect(count(sqlite, "organization_members", "organization_id", alpha.orgId)).toBe(0);
    // By hand, because no foreign key reaches them.
    expect(count(sqlite, "knowledge_memories", "workspace_id", alpha.workspaceId)).toBe(0);
    expect(count(sqlite, "knowledge_chunks", "workspace_id", alpha.workspaceId)).toBe(0);
    expect(count(sqlite, "artifacts", "workspace_id", alpha.workspaceId)).toBe(0);
    expect(count(sqlite, "datasets", "workspace_id", alpha.workspaceId)).toBe(0);
    // Tenant-keyed, and these two go.
    expect(count(sqlite, "tenant_state", "tenant_id", alpha.tenantId)).toBe(0);
    expect(count(sqlite, "tenant_storage", "tenant_id", alpha.tenantId)).toBe(0);
  });

  it("keeps what a tenant must not be able to erase", () => {
    purgeTenantRows(sqlite, alpha.tenantId);
    expect(count(sqlite, "tenants", "id", alpha.tenantId)).toBe(1);
    expect(count(sqlite, "tenant_plan", "tenant_id", alpha.tenantId)).toBe(1);
    expect(count(sqlite, "tenant_seat", "tenant_id", alpha.tenantId)).toBe(1);
    expect(count(sqlite, "tenant_usage", "tenant_id", alpha.tenantId)).toBe(1);
    expect(count(sqlite, "billing_events", "tenant_id", alpha.tenantId)).toBe(1);
    // A reset empties an account; it does not sign its people out.
    expect(count(sqlite, "auth_sessions", "tenant_id", alpha.tenantId)).toBe(1);
  });

  it("leaves every other tenant exactly as it was", () => {
    purgeTenantRows(sqlite, alpha.tenantId);
    expect(count(sqlite, "organizations", "tenant_id", beta.tenantId)).toBe(1);
    expect(count(sqlite, "workspaces", "organization_id", beta.orgId)).toBe(1);
    expect(count(sqlite, "threads", "organization_id", beta.orgId)).toBe(1);
    expect(count(sqlite, "messages", "organization_id", beta.orgId)).toBe(1);
    expect(count(sqlite, "media", "organization_id", beta.orgId)).toBe(1);
    expect(count(sqlite, "knowledge_memories", "workspace_id", beta.workspaceId)).toBe(1);
    expect(count(sqlite, "knowledge_chunks", "workspace_id", beta.workspaceId)).toBe(1);
    expect(count(sqlite, "artifacts", "workspace_id", beta.workspaceId)).toBe(1);
    expect(count(sqlite, "datasets", "workspace_id", beta.workspaceId)).toBe(1);
    expect(count(sqlite, "tenant_state", "tenant_id", beta.tenantId)).toBe(1);
    expect(count(sqlite, "tenant_storage", "tenant_id", beta.tenantId)).toBe(1);
  });

  it("is idempotent: a second pass removes nothing and does not throw", () => {
    const first = purgeTenantRows(sqlite, alpha.tenantId);
    expect(first.rowsDeleted).toBeGreaterThan(0);
    const second = purgeTenantRows(sqlite, alpha.tenantId);
    expect(second.rowsDeleted).toBe(0);
    expect(second.workspaceIds).toEqual([]);
    // And beta is still whole after both passes.
    expect(count(sqlite, "organizations", "tenant_id", beta.tenantId)).toBe(1);
  });

  it("a tenant this host has never seen is a no-op, not an error", () => {
    const result = purgeTenantRows(sqlite, "never-provisioned");
    expect(result.rowsDeleted).toBe(0);
    expect(count(sqlite, "organizations", "tenant_id", alpha.tenantId)).toBe(1);
  });

  it("rolls the whole purge back when a statement fails", () => {
    // Drop a table the purge names: the DELETE against it throws inside the transaction, which is
    // the shape a schema drift would take. Nothing may be half-deleted afterwards.
    sqlite.exec("DROP TABLE artifacts");
    expect(() => purgeTenantRows(sqlite, alpha.tenantId)).toThrow();
    expect(count(sqlite, "organizations", "tenant_id", alpha.tenantId)).toBe(1);
    expect(count(sqlite, "knowledge_memories", "workspace_id", alpha.workspaceId)).toBe(1);
    expect(count(sqlite, "tenant_state", "tenant_id", alpha.tenantId)).toBe(1);
  });
});
