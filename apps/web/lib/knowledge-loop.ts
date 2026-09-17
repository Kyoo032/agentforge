/**
 * Pure helpers for the ingest loop's numbers (Work → Saved → Indexed → Graph → Retrieved →
 * Verified). The six-box drawing is gone; `knowledge-health.ts` folds these stages into the
 * Knowledge health tiles, and the Graph stage now only feeds the map panel's header.
 */

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
  "Market",
  "Legal",
  "Images",
  "Videos",
  "Presentation",
  "Edit",
] as const;

export const LOOP_STAGES = ["Work", "Saved", "Indexed", "Graph", "Retrieved", "Verified"] as const;

export type LoopStage = (typeof LOOP_STAGES)[number];

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

/** Last planted-fact self-check reported by the host. Older hosts omit it entirely. */
export type LoopVerified = { ok: boolean; at: number; detail: string } | null | undefined;

/** Graph size reported by the host. Older hosts omit it entirely. */
export type LoopGraphCounts = { nodes: number; edges: number } | null | undefined;

export type LoopStageState = "neutral" | "ok" | "fail" | "idle";

export type LoopStageCount = {
  stage: LoopStage;
  /** The number behind the stage; 0 when the host does not report it. */
  value: number;
  /** What the node shows: a count, or pass / fail / never for Verified. */
  label: string;
  /** The sub-label under the node. */
  detail: string;
  /** Colour hint. Only Verified ever goes ok / fail. */
  state: LoopStageState;
};

export type LoopStageInput = {
  sources: readonly LoopSource[];
  retrievals?: number | null;
  graph?: LoopGraphCounts;
  verified?: LoopVerified;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const JUST_NOW = 45_000;

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function plural(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

/** Sub-label for the Verified stage: when the last self-check ran, or that none has. */
export function formatVerified(verified: LoopVerified, now: number = Date.now()): string {
  if (!verified || typeof verified !== "object") {
    return "no self-check yet";
  }
  const at = verified.at;
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) {
    return "time unknown";
  }
  const elapsed = now - at;
  if (elapsed < JUST_NOW) {
    return "just now";
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m ago`;
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h ago`;
  }
  return `${Math.floor(elapsed / DAY)}d ago`;
}

/**
 * One row per loop stage, in `LOOP_STAGES` order. Every field is optional on purpose: a host
 * older than the graph/verify build simply reports 0 / never instead of breaking the chart.
 */
export function loopStageCounts(input: LoopStageInput, now: number = Date.now()): LoopStageCount[] {
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const summary = summarizeLoop(sources);
  const nodes = count(input.graph?.nodes);
  const edges = count(input.graph?.edges);
  const retrievals = count(input.retrievals);
  const verified = input.verified && typeof input.verified === "object" ? input.verified : null;
  return [
    {
      stage: "Work",
      value: summary.work,
      label: String(summary.work),
      detail: "Chat or a job mode",
      state: "neutral",
    },
    {
      stage: "Saved",
      value: sources.length,
      label: String(sources.length),
      detail: `${summary.manual} added by hand`,
      state: "neutral",
    },
    {
      stage: "Indexed",
      value: summary.indexed,
      label: String(summary.indexed),
      detail: summary.failed > 0 ? `${summary.failed} failed` : "text cards in KB",
      state: "neutral",
    },
    {
      stage: "Graph",
      value: nodes,
      label: String(nodes),
      detail: nodes > 0 ? plural(edges, "edge") : "build map to create links",
      state: nodes > 0 ? "neutral" : "idle",
    },
    {
      stage: "Retrieved",
      value: retrievals,
      label: String(retrievals),
      detail: retrievals > 0 ? "chunks cited in runs" : "nothing retrieved yet",
      state: retrievals > 0 ? "neutral" : "idle",
    },
    {
      stage: "Verified",
      value: verified?.ok ? 1 : 0,
      label: verified ? (verified.ok ? "pass" : "fail") : "never",
      detail: formatVerified(verified, now),
      state: verified ? (verified.ok ? "ok" : "fail") : "idle",
    },
  ];
}
