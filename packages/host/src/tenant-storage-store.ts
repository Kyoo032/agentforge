/**
 * Phase 6 — the `tenant_storage` counter row.
 *
 * One row per tenant holding how many object bytes this host has stored for it. It exists because
 * the quota check runs on the upload path, and the two honest alternatives to a counter both cost
 * a scan there: summing `media.size_bytes` misses every byte that is not a media row and still
 * scans, and listing the tenant's COS prefix is a billed, paginated API call per upload.
 *
 * It is the same shape Phase 5 lane B gave `tenant_plan.spent_usd_micros`, and it inherits that
 * lane's lesson: **the counter is a cache of the backend, never the authority.** `measured_at`
 * records the last time it was reconciled against a real measure, a tenant with no row is seeded by
 * one on first use rather than starting at zero, and `recomputeTenantStorage` overwrites both
 * columns from the backend whenever an operator asks.
 *
 * **Why the connection is injected rather than imported.** The same reason as
 * `tenant-state-store.ts` and `entitlement-store.ts`: `@agentforge/db`'s entry point OPENS the
 * SQLite file as an import side effect, and this module is reached from `media.ts`, which is
 * reached from `runs.ts` and from half the host's unit tests. `tenant-storage-db.ts` holds the
 * import and installs itself from `router.ts`, which every request already goes through.
 */
import { ApiError } from "@agentforge/core";

/**
 * The narrow slice of a `better-sqlite3` connection this module needs. Declared rather than
 * imported, so nothing here depends on `@agentforge/db`'s import-time database open.
 */
export type TenantStorageSql = {
  prepare(source: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
};

/** What one tenant's counter row holds. `measuredAt` is null until something reconciles it. */
export type TenantStorageCounter = {
  readonly bytesUsed: number;
  readonly objectCount: number;
  readonly measuredAt: number | null;
};

let connection: TenantStorageSql | null = null;

/** Called by `tenant-storage-db.ts`, which `router.ts` pulls in. Idempotent. */
export function registerTenantStorageSql(sql: TenantStorageSql): void {
  connection = sql;
}

/** Test seam: go back to "nothing registered", which is what a fresh process looks like. */
export function resetTenantStorageSqlForTests(): void {
  connection = null;
}

function requireSql(): TenantStorageSql {
  if (!connection) {
    throw new ApiError(
      "tenant_storage_backend_missing",
      "The hosted storage accounting backend was never installed, so this tenant's usage cannot be " +
        "read or written. `packages/host/src/router.ts` imports `tenant-storage-db.ts`, which installs it.",
      500,
    );
  }
  return connection;
}

type Row = { bytes_used: number; object_count: number; measured_at: number | null };

function fromRow(row: Row | undefined): TenantStorageCounter | null {
  if (!row) {
    return null;
  }
  return {
    // Clamped on read as well as on write: a row edited by hand must not be able to hand a tenant
    // an unbounded allowance through a negative number.
    bytesUsed: Math.max(0, Math.trunc(row.bytes_used)),
    objectCount: Math.max(0, Math.trunc(row.object_count)),
    measuredAt: typeof row.measured_at === "number" ? row.measured_at : null,
  };
}

/** This tenant's counter, or null when nothing has ever been counted for it. */
export function readTenantStorageCounter(tenantId: string): TenantStorageCounter | null {
  const row = requireSql()
    .prepare("SELECT bytes_used, object_count, measured_at FROM tenant_storage WHERE tenant_id = ?")
    .get(tenantId) as Row | undefined;
  return fromRow(row);
}

/**
 * Replace the counter with a measure of the backend. This is the only writer of `measured_at`, and
 * the only write that does not go through the clamped arithmetic below, because a measure is not a
 * delta — it is the answer.
 */
export function setTenantStorageCounter(
  tenantId: string,
  use: { bytesUsed: number; objectCount: number },
  measuredAtMs: number = Date.now(),
): TenantStorageCounter {
  const bytesUsed = Math.max(0, Math.trunc(use.bytesUsed));
  const objectCount = Math.max(0, Math.trunc(use.objectCount));
  requireSql()
    .prepare(
      `INSERT INTO tenant_storage (tenant_id, bytes_used, object_count, measured_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET
         bytes_used = excluded.bytes_used,
         object_count = excluded.object_count,
         measured_at = excluded.measured_at,
         updated_at = excluded.updated_at`,
    )
    .run(tenantId, bytesUsed, objectCount, measuredAtMs, Date.now());
  return { bytesUsed, objectCount, measuredAt: measuredAtMs };
}

/**
 * Move the counter by a delta, in one statement.
 *
 * `max(0, …)` is inside the SQL rather than around it on purpose: two uploads landing in the same
 * millisecond from two processes behind the proxy would otherwise read, add and write over each
 * other, and a read-modify-write in JavaScript has no lock to hold between the two halves. Doing
 * the arithmetic in the UPDATE makes each delta atomic against the row.
 *
 * The clamp at zero is the other half: a delete replayed twice, or a delete of an object whose
 * `put` was never counted, must not drive the counter negative and hand the tenant free space.
 */
export function addTenantStorageBytes(
  tenantId: string,
  delta: { bytes: number; objects: number },
): TenantStorageCounter {
  const bytes = Math.trunc(delta.bytes);
  const objects = Math.trunc(delta.objects);
  requireSql()
    .prepare(
      `INSERT INTO tenant_storage (tenant_id, bytes_used, object_count, measured_at, updated_at)
       VALUES (?, max(0, ?), max(0, ?), NULL, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET
         bytes_used = max(0, tenant_storage.bytes_used + ?),
         object_count = max(0, tenant_storage.object_count + ?),
         updated_at = excluded.updated_at`,
    )
    .run(tenantId, bytes, objects, Date.now(), bytes, objects);
  // Read back rather than computing the new value here: the row may have moved under us between
  // the two statements, and the caller logs what the row says, not what this process hoped.
  return readTenantStorageCounter(tenantId) ?? { bytesUsed: 0, objectCount: 0, measuredAt: null };
}

/** Drop a tenant's counter. Used by the reset path and by the tests; idempotent. */
export function clearTenantStorageCounter(tenantId: string): void {
  requireSql().prepare("DELETE FROM tenant_storage WHERE tenant_id = ?").run(tenantId);
}

/** Every tenant this host has counted bytes for, for an operator's recompute sweep. */
export function tenantsWithStorage(): string[] {
  const rows = requireSql().prepare("SELECT tenant_id FROM tenant_storage ORDER BY tenant_id").all() as Array<{
    tenant_id: string;
  }>;
  return rows.map((row) => row.tenant_id);
}
