import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isServerMode, type TenantContext } from "@agentforge/core";
import { log } from "../log";
import { isLocalTenant, tenantDataDir } from "../tenant-paths";
import { workerProjectScope } from "./ops";

/** Whose Edit metrics a read may return: one organization, inside its tenant. */
export type EditMetricScope = Pick<TenantContext, "tenantId" | "organizationId">;

export type EditMetricEvent = {
  at: string;
  /** Absent only on a line written before metrics were scoped. See `belongsTo`. */
  tenantId?: string;
  organizationId?: string;
  projectId?: string;
  runId?: string;
  cardId?: string;
  jobId?: string;
  event: string;
  data?: Record<string, unknown>;
};

/** What a caller records. The scope is not in it: it is read off the project. */
export type EditMetricInput = {
  projectId: string;
  runId?: string;
  cardId?: string;
  jobId?: string;
  event: string;
  data?: Record<string, unknown>;
  at?: string;
};

export type EditMetricsRange = "day" | "week" | "month";

export type FoldEditMetricsOptions = {
  /** Injected by the tests; otherwise `isServerMode()`. */
  serverMode?: boolean;
};

const RANGES: Record<EditMetricsRange, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

/**
 * One file per tenant, in that tenant's own data directory.
 *
 * The local tenant's is the file every desk has always had (`<dataDir>/edit/metrics.jsonl`), so a
 * desktop keeps its history. A hosted tenant's is `<dataDir>/tenants/<id>/edit/metrics.jsonl`, which
 * the per-tenant purge removes with the rest of the tenant (`tenant-reset.ts`). It used to be one
 * machine-wide file for everyone, and every line in it carries project, run, card and job ids.
 */
function metricsFile(tenantId: string): string {
  return path.join(tenantDataDir(tenantId), "edit", "metrics.jsonl");
}

/**
 * Record one Edit event against the project it is about.
 *
 * The tenant and organization are read off the project row (`workerProjectScope`) rather than taken
 * from the caller, so a line cannot be filed under anyone but the project's owner. Every caller has
 * already scoped the project to its own desk before it gets here.
 *
 * Telemetry never fails the action it describes: an undo, a keep or a cancel that has already
 * happened must not answer an error because its metric could not be written. The miss is logged.
 */
export async function appendEditMetric(input: EditMetricInput): Promise<void> {
  try {
    const scope = await workerProjectScope(input.projectId);
    const row: EditMetricEvent = {
      at: input.at ?? new Date().toISOString(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      event: input.event,
      projectId: input.projectId,
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.cardId ? { cardId: input.cardId } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.data ? { data: input.data } : {}),
    };
    const file = metricsFile(scope.tenantId);
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
  } catch (error) {
    log.warn("edit_metric_not_recorded", {
      event: input.event,
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Whether a stored line may be shown to `scope`.
 *
 * A stamped line belongs to exactly one tenant and organization. The organization matters as much as
 * the tenant: a tenant is a whitelabel partner and its organizations are separate customers.
 *
 * An unstamped line was written before metrics were scoped. On a desk it sits in the local tenant's
 * file and there has only ever been one owner, so it is theirs. On the hosted server nothing says
 * whose it was — the old file held every tenant's — so it is nobody's to read.
 */
function belongsTo(line: EditMetricEvent, scope: EditMetricScope, serverMode: boolean): boolean {
  if (line.tenantId !== undefined || line.organizationId !== undefined) {
    return line.tenantId === scope.tenantId && line.organizationId === scope.organizationId;
  }
  return !serverMode && isLocalTenant(scope.tenantId);
}

function parseLine(line: string): EditMetricEvent | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as EditMetricEvent;
    return typeof record.at === "string" && typeof record.event === "string" ? record : null;
  } catch {
    return null;
  }
}

/** The caller's own Edit events in `range`, and a count per event name. */
export function foldEditMetrics(
  scope: EditMetricScope,
  range: EditMetricsRange = "week",
  options: FoldEditMetricsOptions = {},
): {
  range: string;
  counts: Record<string, number>;
  events: EditMetricEvent[];
} {
  const serverMode = options.serverMode ?? isServerMode();
  const since = Date.now() - (RANGES[range] ?? RANGES.week);
  const file = metricsFile(scope.tenantId);
  const events: EditMetricEvent[] = [];
  if (existsSync(file)) {
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      if (!raw.trim()) {
        continue;
      }
      const line = parseLine(raw);
      if (line && belongsTo(line, scope, serverMode) && new Date(line.at).getTime() >= since) {
        events.push(line);
      }
    }
  }
  const counts: Record<string, number> = {};
  for (const item of events) {
    counts[item.event] = (counts[item.event] ?? 0) + 1;
  }
  return { range, counts, events };
}
