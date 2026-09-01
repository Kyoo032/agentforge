import { asRunUsageRecord, type RunUsageRecord, type RuntimeEvent } from "@agentforge/core";
import { appendDeskUsage } from "./desk-usage";

export function usageFromRuntimeEvent(event: RuntimeEvent): RunUsageRecord | null {
  if (event.type !== "run.completed" || !event.usage) {
    return null;
  }
  return asRunUsageRecord(event.usage);
}

export function rememberJobUsage(event: RuntimeEvent): void {
  const record = usageFromRuntimeEvent(event);
  if (record) {
    appendDeskUsage(record);
  }
}
