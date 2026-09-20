import type Database from "better-sqlite3";
import { sql } from "@agentforge/db";
import {
  isUnpricedReason,
  isUsageMode,
  isUsageUnit,
  type RunUsageRecord,
  type TenantContext,
  type TimestampedRunUsage,
  type UnpricedReason,
  type UsageEvent,
  type UsageMode,
  type UsageUnit,
} from "@agentforge/core";
import { log } from "./log";

/**
 * The tenant usage ledger (Phase 5 lane A). One row per gateway call, for every mode.
 *
 * Synchronous on purpose. Every caller is inside a runtime `onEvent` or a generate handler, and a
 * fire-and-forget promise there is a row that silently does not exist when the process exits. This
 * is the same `better-sqlite3` handle `artifacts.ts` writes through, so a write is one statement on
 * the same connection the rest of the request already used.
 *
 * A failed write is logged and swallowed: metering must never fail a generation the tenant has
 * already paid the gateway for. The cost of that choice is a lost row, which is why
 * `usage_write_failed` is a warning and not a debug line.
 */

/** A ledger row as it comes back out: the event, plus what the store gave it. */
export type TenantUsageRow = UsageEvent & {
  id: string;
  tenantId: string;
  organizationId: string;
  workspaceId: string | null;
  userId: string | null;
  /** Epoch milliseconds, as everywhere else in this schema. */
  at: number;
};

export type UsageQuery = {
  /** Inclusive lower bound, epoch ms. */
  from?: number;
  /** Exclusive upper bound, epoch ms. */
  to?: number;
  /** Only these modes. */
  modes?: readonly UsageMode[];
  /** Everything but these modes. Applied after `modes`, and both may be given. */
  excludeModes?: readonly UsageMode[];
  /** Newest first. Defaults to `USAGE_LIST_LIMIT`. */
  limit?: number;
};

/** Hard cap on one ledger read, so a long-lived tenant cannot page the whole ledger into memory. */
export const USAGE_LIST_LIMIT = 5_000;

export type UsageTotals = {
  /** Summed cost of the priced rows, in integer micros. */
  costUsdMicros: number;
  /** Rows that carried a cost. */
  pricedCount: number;
  /** Rows that did not. These are the ones an allowance must not silently ignore. */
  unpricedCount: number;
  /** Unpriced rows broken down by why, so the fix is visible rather than just the gap. */
  unpricedByReason: Partial<Record<UnpricedReason, number>>;
};

export type UsageStore = {
  record(tenant: TenantContext, event: UsageEvent): TenantUsageRow | null;
  list(tenant: TenantContext, query?: UsageQuery): TenantUsageRow[];
  totals(tenant: TenantContext, query?: UsageQuery): UsageTotals;
};

type Row = {
  id: string;
  tenant_id: string;
  organization_id: string;
  workspace_id: string | null;
  user_id: string | null;
  mode: string;
  model: string;
  unit: string;
  quantity: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd_micros: number | null;
  unpriced_reason: string | null;
  run_id: string | null;
  at: number;
};

function nonNegativeInt(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.round(numeric));
}

/**
 * A row is only worth writing if it names a tenant, an organization and a model. Anything else is
 * a bug upstream, and a ledger row that cannot be attributed is worse than no row: it inflates the
 * unpriced count without telling anybody whose call it was.
 */
function validate(tenant: TenantContext, event: UsageEvent): TenantUsageRow | null {
  const model = typeof event.model === "string" ? event.model.trim() : "";
  if (!tenant?.tenantId?.trim() || !tenant?.organizationId?.trim() || !model) {
    return null;
  }
  if (!isUsageMode(event.mode) || !isUsageUnit(event.unit)) {
    return null;
  }
  const costUsdMicros =
    typeof event.costUsdMicros === "number" && Number.isFinite(event.costUsdMicros) && event.costUsdMicros >= 0
      ? Math.round(event.costUsdMicros)
      : null;
  // The two must agree: a priced row carries no reason, an unpriced row always carries one. A row
  // with neither a cost nor a reason is the silent hole this whole lane exists to close.
  let unpricedReason: UnpricedReason | undefined;
  if (costUsdMicros === null) {
    unpricedReason = isUnpricedReason(event.unpricedReason) ? event.unpricedReason : "catalog_unavailable";
  }
  return {
    id: crypto.randomUUID(),
    tenantId: tenant.tenantId.trim(),
    organizationId: tenant.organizationId.trim(),
    workspaceId: tenant.workspaceId?.trim() || null,
    userId: tenant.userId?.trim() || null,
    mode: event.mode,
    model,
    unit: event.unit,
    quantity: nonNegativeInt(event.quantity),
    inputTokens: nonNegativeInt(event.inputTokens),
    outputTokens: nonNegativeInt(event.outputTokens),
    costUsdMicros,
    ...(unpricedReason ? { unpricedReason } : {}),
    ...(event.runId?.trim() ? { runId: event.runId.trim() } : {}),
    at: Date.now(),
  };
}

function rowFrom(raw: Row): TenantUsageRow {
  return {
    id: raw.id,
    tenantId: raw.tenant_id,
    organizationId: raw.organization_id,
    workspaceId: raw.workspace_id,
    userId: raw.user_id,
    mode: isUsageMode(raw.mode) ? raw.mode : "other",
    model: raw.model,
    unit: isUsageUnit(raw.unit) ? raw.unit : "tokens",
    quantity: raw.quantity,
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    costUsdMicros: typeof raw.cost_usd_micros === "number" ? raw.cost_usd_micros : null,
    ...(isUnpricedReason(raw.unpriced_reason) ? { unpricedReason: raw.unpriced_reason } : {}),
    ...(raw.run_id ? { runId: raw.run_id } : {}),
    at: raw.at,
  };
}

function whereFor(tenantId: string, query: UsageQuery): { clause: string; params: unknown[] } {
  const parts = ["tenant_id = ?"];
  const params: unknown[] = [tenantId];
  if (typeof query.from === "number" && Number.isFinite(query.from)) {
    parts.push("at >= ?");
    params.push(Math.round(query.from));
  }
  if (typeof query.to === "number" && Number.isFinite(query.to)) {
    parts.push("at < ?");
    params.push(Math.round(query.to));
  }
  const modes = (query.modes ?? []).filter(isUsageMode);
  if (modes.length > 0) {
    parts.push(`mode IN (${modes.map(() => "?").join(", ")})`);
    params.push(...modes);
  }
  const excluded = (query.excludeModes ?? []).filter(isUsageMode);
  if (excluded.length > 0) {
    parts.push(`mode NOT IN (${excluded.map(() => "?").join(", ")})`);
    params.push(...excluded);
  }
  return { clause: parts.join(" AND "), params };
}

/** Repository over the `tenant_usage` table. Nothing here reaches the network or prices anything. */
export function createUsageStore(db: Database.Database): UsageStore {
  return {
    record(tenant, event) {
      const row = validate(tenant, event);
      if (!row) {
        return null;
      }
      db.prepare(
        `INSERT INTO tenant_usage
           (id, tenant_id, organization_id, workspace_id, user_id, mode, model, unit, quantity,
            input_tokens, output_tokens, cost_usd_micros, unpriced_reason, run_id, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id,
        row.tenantId,
        row.organizationId,
        row.workspaceId,
        row.userId,
        row.mode,
        row.model,
        row.unit,
        row.quantity,
        row.inputTokens,
        row.outputTokens,
        row.costUsdMicros,
        row.unpricedReason ?? null,
        row.runId ?? null,
        row.at,
      );
      return row;
    },

    list(tenant, query = {}) {
      const { clause, params } = whereFor(tenant.tenantId, query);
      const limit = Math.min(Math.max(1, Math.round(query.limit ?? USAGE_LIST_LIMIT)), USAGE_LIST_LIMIT);
      const rows = db
        .prepare(`SELECT * FROM tenant_usage WHERE ${clause} ORDER BY at DESC LIMIT ?`)
        .all(...params, limit) as Row[];
      return rows.map(rowFrom);
    },

    totals(tenant, query = {}) {
      const { clause, params } = whereFor(tenant.tenantId, query);
      // Summed in SQL rather than in JS: this is the query an allowance check runs, and the
      // ledger is the one table in this schema that only ever grows.
      const priced = db
        .prepare(
          `SELECT COALESCE(SUM(cost_usd_micros), 0) AS micros, COUNT(*) AS n
           FROM tenant_usage WHERE ${clause} AND cost_usd_micros IS NOT NULL`,
        )
        .get(...params) as { micros: number; n: number };
      const unpriced = db
        .prepare(
          `SELECT COALESCE(unpriced_reason, 'catalog_unavailable') AS reason, COUNT(*) AS n
           FROM tenant_usage WHERE ${clause} AND cost_usd_micros IS NULL
           GROUP BY reason`,
        )
        .all(...params) as Array<{ reason: string; n: number }>;
      const unpricedByReason: Partial<Record<UnpricedReason, number>> = {};
      let unpricedCount = 0;
      for (const item of unpriced) {
        unpricedCount += item.n;
        const reason: UnpricedReason = isUnpricedReason(item.reason) ? item.reason : "catalog_unavailable";
        unpricedByReason[reason] = (unpricedByReason[reason] ?? 0) + item.n;
      }
      return {
        costUsdMicros: Math.round(priced.micros ?? 0),
        pricedCount: priced.n ?? 0,
        unpricedCount,
        unpricedByReason,
      };
    },
  };
}

let defaultStore: UsageStore | null = null;

/** Store bound to the app database. */
export function usageStore(): UsageStore {
  if (!defaultStore) {
    defaultStore = createUsageStore(sql);
  }
  return defaultStore;
}

/**
 * Point the module-level store at another database. **Tests only** — it exists so a test can drive
 * the real recording path (`rememberJobUsage`, `recordImageUsage`, …) against an in-memory
 * database instead of the app's. Passing `null` restores the app database.
 */
export function setUsageStoreForTests(store: UsageStore | null): void {
  defaultStore = store;
}

/**
 * Write one ledger row. Never throws: a metering failure must not fail the generation the tenant
 * has already been charged for by the gateway. Returns the row when it landed, `null` when it did
 * not — the callers ignore it, the tests do not.
 */
export function recordUsage(tenant: TenantContext, event: UsageEvent): TenantUsageRow | null {
  try {
    return usageStore().record(tenant, event);
  } catch (error) {
    log.warn("usage_write_failed", {
      mode: event.mode,
      unit: event.unit,
      detail: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

/** Ledger rows for this tenant, newest first. Never throws; an unreadable ledger reads as empty. */
export function listTenantUsage(tenant: TenantContext, query: UsageQuery = {}): TenantUsageRow[] {
  try {
    return usageStore().list(tenant, query);
  } catch (error) {
    log.warn("usage_read_failed", { detail: error instanceof Error ? error.message : "unknown" });
    return [];
  }
}

/** Period totals for this tenant, including what could not be priced. Never throws. */
export function tenantUsageTotals(tenant: TenantContext, query: UsageQuery = {}): UsageTotals {
  try {
    return usageStore().totals(tenant, query);
  } catch (error) {
    log.warn("usage_totals_failed", { detail: error instanceof Error ? error.message : "unknown" });
    return { costUsdMicros: 0, pricedCount: 0, unpricedCount: 0, unpricedByReason: {} };
  }
}

/** The modes the account screen already counted as "desk" spend — everything that is not chat. */
const DESK_MODES: readonly UsageMode[] = ["chat"];

function tokenRows(rows: readonly TenantUsageRow[]): TenantUsageRow[] {
  return rows.filter((row) => row.unit === "tokens");
}

/**
 * Job and edit-agent token spend as the account screen's existing estimator wants it. This is the
 * replacement for `listDeskUsage()`: same shape, now scoped to a tenant instead of read from one
 * global `desk-usage.json`.
 *
 * Media rows are left out because a `RunUsageRecord` has nowhere to put an image or a second —
 * their cost is already persisted in micros on the row, and surfacing it is the account-screen
 * work that lane A deliberately does not do (see docs/internal/web-phase5-lane-a.md).
 */
export function listJobUsageRecords(tenant: TenantContext, query: UsageQuery = {}): RunUsageRecord[] {
  return tokenRows(listTenantUsage(tenant, { ...query, excludeModes: DESK_MODES })).map((row) => ({
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    ...(row.unpricedReason === "usage_unknown" ? { unknown: true } : {}),
  }));
}

/** The same rows with their timestamps, for the usage-over-time buckets. */
export function listTimedJobUsage(tenant: TenantContext, query: UsageQuery = {}): TimestampedRunUsage[] {
  return tokenRows(listTenantUsage(tenant, { ...query, excludeModes: DESK_MODES })).map((row) => ({
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    ...(row.unpricedReason === "usage_unknown" ? { unknown: true } : {}),
    startedAt: new Date(row.at),
  }));
}

export type { UsageUnit, UsageMode };
