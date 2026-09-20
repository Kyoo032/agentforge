import { asRunUsageRecord, type RunUsageRecord, type RuntimeEvent } from "@agentforge/core";
import { appendDeskUsage } from "./desk-usage";

export function usageFromRuntimeEvent(event: RuntimeEvent): RunUsageRecord | null {
  if (event.type !== "run.completed" || !event.usage) {
    return null;
  }
  return asRunUsageRecord(event.usage);
}

/** Phase 3 lane D: metered against the tenant that ran the job, not the install. */
export function rememberJobUsage(tenantId: string, event: RuntimeEvent): void {
  const record = usageFromRuntimeEvent(event);
  if (record) {
    appendDeskUsage(tenantId, record);
  }
}
