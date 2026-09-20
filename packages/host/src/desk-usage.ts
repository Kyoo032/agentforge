import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { asRunUsageRecord, type RunUsageRecord, type TimestampedRunUsage } from "@agentforge/core";
import { localDataDir } from "@agentforge/db/vault-key";

/**
 * LEGACY, READ-ONLY since Phase 5 lane A (docs/internal/web-phase5-lane-a.md).
 *
 * `desk-usage.json` was one global file with no tenant dimension: every tenant on a hosted
 * deployment appended job and edit-agent spend to the same array, and no allowance could be
 * enforced against it. Job spend now goes to the tenant-scoped `tenant_usage` ledger
 * (`tenant-usage.ts`) and **nothing in the app writes this file any more**.
 *
 * The readers stay so a desktop that has been generating since before the migration keeps the
 * history the account screen already showed it. `appendDeskUsage` stays only because the reader
 * tests need a writer; no production call site uses it, and none should be added — a new writer
 * here is a usage record with no tenant on it, which is the exact hole this lane closed.
 */
type StoredDeskUsage = RunUsageRecord & { at?: string };

function usagePath(): string {
  return resolve(localDataDir(), "desk-usage.json");
}

function readAt(item: unknown): string | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const at = (item as { at?: unknown }).at;
  return typeof at === "string" && at.trim() ? at.trim() : undefined;
}

function readEntries(): StoredDeskUsage[] {
  try {
    const parsed = JSON.parse(readFileSync(usagePath(), "utf8")) as unknown;
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

export function listDeskUsage(): RunUsageRecord[] {
  return readEntries().map(({ at: _at, ...record }) => record);
}

export function listTimedDeskUsage(): TimestampedRunUsage[] {
  const timed: TimestampedRunUsage[] = [];
  for (const row of readEntries()) {
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

export function appendDeskUsage(raw: unknown): void {
  const record = asRunUsageRecord(raw);
  if (!record) {
    return;
  }
  const at = readAt(raw) ?? new Date().toISOString();
  const next = [...readEntries(), { ...record, at }];
  const dir = localDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(usagePath(), `${JSON.stringify({ entries: next })}\n`, "utf8");
}

export function deskUsageFileExists(): boolean {
  return existsSync(usagePath());
}
