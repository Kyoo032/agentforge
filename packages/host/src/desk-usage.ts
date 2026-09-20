import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { asRunUsageRecord, type RunUsageRecord, type TimestampedRunUsage } from "@agentforge/core";
import { tenantDataDir } from "./tenant-paths";

type StoredDeskUsage = RunUsageRecord & { at?: string };

/**
 * Phase 3 lane D: `<dataDir>/desk-usage.json` for the local tenant, under `tenants/<tenantId>/`
 * for anyone else. One file for everybody meant tenant B's spend showed up in tenant A's usage
 * panel, and every tenant appended to the same file.
 *
 * The spec (§3e) wants this in a `tenant_usage` row rather than a file. That is a schema change
 * Phase 5 owns end to end, and §4 says Phase 3 creates the table only if this lane lands the move;
 * it does not, so the file stays and gains the tenant. See `docs/internal/web-phase3-lane-d.md`.
 */
function usagePath(tenantId: string): string {
  return resolve(tenantDataDir(tenantId), "desk-usage.json");
}

function readAt(item: unknown): string | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const at = (item as { at?: unknown }).at;
  return typeof at === "string" && at.trim() ? at.trim() : undefined;
}

function readEntries(tenantId: string): StoredDeskUsage[] {
  try {
    const parsed = JSON.parse(readFileSync(usagePath(tenantId), "utf8")) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)
        ? (parsed as { entries: unknown[] }).entries
        : [];
    const records: StoredDeskUsage[] = [];
    for (const item of items) {
      const record = asRunUsageRecord(item);
      if (record) {
        records.push({ ...record, ...(readAt(item) ? { at: readAt(item) } : {}) });
      }
    }
    return records;
  } catch {
    return [];
  }
}

export function listDeskUsage(tenantId: string): RunUsageRecord[] {
  return readEntries(tenantId).map(({ at: _at, ...record }) => record);
}

export function listTimedDeskUsage(tenantId: string): TimestampedRunUsage[] {
  const timed: TimestampedRunUsage[] = [];
  for (const row of readEntries(tenantId)) {
    if (!row.at) {
      continue;
    }
    const startedAt = new Date(row.at);
    if (Number.isNaN(startedAt.getTime())) {
      continue;
    }
    timed.push({
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      ...(row.unknown ? { unknown: true } : {}),
      startedAt,
    });
  }
  return timed;
}

export function appendDeskUsage(tenantId: string, raw: unknown): void {
  const record = asRunUsageRecord(raw);
  if (!record) {
    return;
  }
  const at = readAt(raw) ?? new Date().toISOString();
  const next = [...readEntries(tenantId), { ...record, at }];
  const dir = tenantDataDir(tenantId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(usagePath(tenantId), `${JSON.stringify({ entries: next })}\n`, "utf8");
}

export function deskUsageFileExists(tenantId: string): boolean {
  return existsSync(usagePath(tenantId));
}
