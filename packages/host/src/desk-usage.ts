import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { asRunUsageRecord, type RunUsageRecord } from "@agentforge/core";
import { localDataDir } from "@agentforge/db/vault-key";

function usagePath(): string {
  return resolve(localDataDir(), "desk-usage.json");
}

function readEntries(): RunUsageRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(usagePath(), "utf8")) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)
        ? (parsed as { entries: unknown[] }).entries
        : [];
    const records: RunUsageRecord[] = [];
    for (const item of items) {
      const record = asRunUsageRecord(item);
      if (record) {
        records.push(record);
      }
    }
    return records;
  } catch {
    return [];
  }
}

export function listDeskUsage(): RunUsageRecord[] {
  return readEntries();
}

export function appendDeskUsage(raw: unknown): void {
  const record = asRunUsageRecord(raw);
  if (!record) {
    return;
  }
  const next = [...readEntries(), record];
  const dir = localDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(usagePath(), `${JSON.stringify({ entries: next })}\n`, "utf8");
}

export function deskUsageFileExists(): boolean {
  return existsSync(usagePath());
}
