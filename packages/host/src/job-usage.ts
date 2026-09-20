import {
  asRunUsageRecord,
  type RunUsageRecord,
  type RuntimeEvent,
  type TenantContext,
  type UsageMode,
} from "@agentforge/core";
import { recordTokenUsage } from "./usage-record";

export function usageFromRuntimeEvent(event: RuntimeEvent): RunUsageRecord | null {
  if (event.type !== "run.completed" || !event.usage) {
    return null;
  }
  return asRunUsageRecord(event.usage);
}

export type JobUsageContext = {
  tenant: TenantContext;
  /** The product surface this run was made from; derived from the job's `runPrefix`. */
  mode: UsageMode;
  runId?: string;
};

/**
 * Record what one job run cost, against its tenant.
 *
 * This used to append to `desk-usage.json` — one global file with no tenant dimension, shared by
 * every tenant on a hosted deployment. It now writes a `tenant_usage` row instead (Phase 5 lane A,
 * docs/internal/web-phase5-lane-a.md). The old file is still *read* for a desktop's pre-migration
 * history; nothing writes it any more.
 */
export function rememberJobUsage(event: RuntimeEvent, context: JobUsageContext): void {
  const record = usageFromRuntimeEvent(event);
  if (!record) {
    return;
  }
  recordTokenUsage(context.tenant, record, {
    mode: context.mode,
    ...(context.runId ? { runId: context.runId } : {}),
  });
}
