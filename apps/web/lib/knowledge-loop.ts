/** Pure helpers for the Knowledge loop chart (Work → Saved → Indexed → Retrieved → Work). */

export type LoopSource = {
  type: string;
  status: "Indexed" | "Indexing" | "Failed";
  chunks: number;
};

export type LoopTypeCount = {
  type: string;
  total: number;
  indexed: number;
  failed: number;
  chunks: number;
};

/** Source types written by the ingest loop, in rail order. Manual types (File / URL / Paste…) follow. */
export const WORK_SOURCE_ORDER = [
  "Chat",
  "Documents",
  "Research",
  "Finance",
  "Data",
  "Images",
  "Videos",
  "Presentation",
  "Edit",
] as const;

export const LOOP_STAGES = ["Work", "Saved", "Indexed", "Retrieved"] as const;

const workRank = new Map<string, number>(WORK_SOURCE_ORDER.map((type, index) => [type, index]));

export function isWorkSourceType(type: string): boolean {
  return workRank.has(type);
}

/** Counts by source type. Work types first in rail order, then everything else by count desc, then name. */
export function countSourcesByType(sources: readonly LoopSource[]): LoopTypeCount[] {
  const byType = new Map<string, LoopTypeCount>();
  for (const source of sources) {
    const type = source.type || "Other";
    const current = byType.get(type) ?? { type, total: 0, indexed: 0, failed: 0, chunks: 0 };
    byType.set(type, {
      type,
      total: current.total + 1,
      indexed: current.indexed + (source.status === "Indexed" ? 1 : 0),
      failed: current.failed + (source.status === "Failed" ? 1 : 0),
      chunks: current.chunks + (Number.isFinite(source.chunks) ? source.chunks : 0),
    });
  }
  return [...byType.values()].sort((a, b) => {
    const aWork = workRank.get(a.type);
    const bWork = workRank.get(b.type);
    if (aWork !== undefined && bWork !== undefined) {
      return aWork - bWork;
    }
    if (aWork !== undefined) {
      return -1;
    }
    if (bWork !== undefined) {
      return 1;
    }
    return b.total - a.total || a.type.localeCompare(b.type);
  });
}

export type LoopSummary = {
  /** Sources written by a mode finishing work. */
  work: number;
  /** Sources added by hand (File / URL / Paste and the legacy Dossier / Analysis / Brief labels). */
  manual: number;
  indexed: number;
  failed: number;
  chunks: number;
};

export function summarizeLoop(sources: readonly LoopSource[]): LoopSummary {
  return sources.reduce<LoopSummary>(
    (acc, source) => ({
      work: acc.work + (isWorkSourceType(source.type) ? 1 : 0),
      manual: acc.manual + (isWorkSourceType(source.type) ? 0 : 1),
      indexed: acc.indexed + (source.status === "Indexed" ? 1 : 0),
      failed: acc.failed + (source.status === "Failed" ? 1 : 0),
      chunks: acc.chunks + (Number.isFinite(source.chunks) ? source.chunks : 0),
    }),
    { work: 0, manual: 0, indexed: 0, failed: 0, chunks: 0 },
  );
}

/** Bar width in [0, 1] relative to the largest count; 0 when there is nothing. */
export function barFraction(total: number, max: number): number {
  if (max <= 0 || total <= 0) {
    return 0;
  }
  return Math.min(1, total / max);
}
