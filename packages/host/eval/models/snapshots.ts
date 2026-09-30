import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogSnapshot } from "./catalog-report";

const FILE = /^catalog-.+\.json$/;

/** `catalog-2026-09-30T10-00-00-000Z.json`: no colons, and it sorts by time. */
export function snapshotFileName(generatedAt: string): string {
  return `catalog-${generatedAt.replace(/[:.]/g, "-")}.json`;
}

function isSnapshot(value: unknown): value is CatalogSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.generatedAt === "string" &&
    Array.isArray(record.ids) &&
    record.ids.every((id) => typeof id === "string") &&
    Array.isArray(record.chatIds) &&
    record.chatIds.every((id) => typeof id === "string")
  );
}

/**
 * Write one run's snapshot. The full report may ride along under `report`; reading a snapshot back
 * takes only the snapshot's own fields, so the report can change shape without breaking the diff.
 */
export function writeSnapshot(dir: string, snapshot: CatalogSnapshot, report?: unknown): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, snapshotFileName(snapshot.generatedAt));
  const body = report === undefined ? snapshot : { ...snapshot, report };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return path;
}

/**
 * The newest snapshot in `dir` that reads as one. Files that are not snapshots (a probe trace, a half
 * written file, a folder) are skipped, so a bad file never blocks a run. `before` leaves out a run at or
 * after that time, so a run never diffs against itself.
 */
export function readLatestSnapshot(dir: string, options: { before?: string } = {}): CatalogSnapshot | undefined {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => FILE.test(name));
  } catch {
    return undefined;
  }
  for (const name of names.sort().reverse()) {
    const path = join(dir, name);
    try {
      if (!statSync(path).isFile()) {
        continue;
      }
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (!isSnapshot(parsed)) {
        continue;
      }
      if (options.before !== undefined && parsed.generatedAt >= options.before) {
        continue;
      }
      return {
        version: 1,
        generatedAt: parsed.generatedAt,
        ids: parsed.ids,
        chatIds: parsed.chatIds,
      };
    } catch {
      // Unreadable or not JSON: not a snapshot.
    }
  }
  return undefined;
}
