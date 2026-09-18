/**
 * Pure helpers for the Knowledge health strip — the four stat tiles, the optional Failed tile,
 * the Verified pill, and the one-line by-type breakdown that replaced the pipeline drawing.
 *
 * Every number the old six-box chart showed still comes out of here: the Saved total rides on
 * the "Added by hand" tile, chunks on "Indexed", and the graph size moved to the map header.
 */

import {
  type LoopStage,
  type LoopStageInput,
  type LoopStageState,
  type LoopTypeCount,
  type LoopVerified,
  loopStageCounts,
  summarizeLoop,
} from "@/lib/knowledge-loop";

export type HealthTileKey = "work" | "manual" | "indexed" | "retrieved" | "failed";

export type HealthTile = {
  key: HealthTileKey;
  /**
   * The loop stage this tile stands in for. The stage's testid, `data-value` and `data-state`
   * ride on the tile root, so a harness that read the old boxes still finds its numbers.
   * `null` on the Failed tile, which never was a stage.
   */
  stage: LoopStage | null;
  /** What the stage reports — wider than `value` on the Saved → "Added by hand" tile. */
  stageValue: number;
  stageState: LoopStageState;
  /** The headline number on the tile. */
  value: number;
  /** The number quoted in the subline (saved total, chunks); 0 when the subline quotes none. */
  sub: number;
  /** Failed is the only tile drawn in the danger colour, and only when it is non-zero. */
  danger: boolean;
};

/** A pass older than this reads "stale": the desk changed since anything was checked. */
export const VERIFIED_STALE_MS = 24 * 60 * 60 * 1000;

export type VerifiedTone = "pass" | "stale" | "fail" | "never";

/**
 * Dot colour for the Verified pill: green on a fresh pass, red on a fail, and a muted warm
 * dot for "never checked" or "checked a while ago" — neither is a failure, neither is proof.
 */
export function verifiedTone(verified: LoopVerified, now: number = Date.now()): VerifiedTone {
  if (!verified || typeof verified !== "object" || typeof verified.ok !== "boolean") {
    return "never";
  }
  if (!verified.ok) {
    return "fail";
  }
  const at = verified.at;
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) {
    return "stale";
  }
  return now - at > VERIFIED_STALE_MS ? "stale" : "pass";
}

/**
 * The tiles, in reading order. Failed is appended only when something failed — a permanent
 * "Failed 0" is noise on a healthy desk.
 */
export function healthTiles(input: LoopStageInput, now: number = Date.now()): HealthTile[] {
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const summary = summarizeLoop(sources);
  const stages = loopStageCounts(input, now);
  const byStage = new Map<LoopStage, (typeof stages)[number]>(stages.map((stage) => [stage.stage, stage]));
  const work = byStage.get("Work");
  const saved = byStage.get("Saved");
  const indexed = byStage.get("Indexed");
  const retrieved = byStage.get("Retrieved");
  const tiles: HealthTile[] = [
    {
      key: "work",
      stage: "Work",
      stageValue: work?.value ?? summary.work,
      stageState: work?.state ?? "neutral",
      value: summary.work,
      sub: 0,
      danger: false,
    },
    {
      key: "manual",
      stage: "Saved",
      stageValue: saved?.value ?? sources.length,
      stageState: saved?.state ?? "neutral",
      value: summary.manual,
      sub: sources.length,
      danger: false,
    },
    {
      key: "indexed",
      stage: "Indexed",
      stageValue: indexed?.value ?? summary.indexed,
      stageState: indexed?.state ?? "neutral",
      value: summary.indexed,
      sub: summary.chunks,
      danger: false,
    },
    {
      key: "retrieved",
      stage: "Retrieved",
      stageValue: retrieved?.value ?? 0,
      stageState: retrieved?.state ?? "idle",
      value: retrieved?.value ?? 0,
      sub: 0,
      danger: false,
    },
  ];
  if (summary.failed > 0) {
    tiles.push({
      key: "failed",
      stage: null,
      stageValue: summary.failed,
      stageState: "fail",
      value: summary.failed,
      sub: 0,
      danger: true,
    });
  }
  return tiles;
}

/**
 * The by-type line only earns its row when there is a mix to report. One type is already the
 * whole story the tiles tell, so the line stays off.
 */
export function shouldShowByType(counts: readonly LoopTypeCount[]): boolean {
  return Array.isArray(counts) && counts.filter((row) => row.total > 0).length > 1;
}
