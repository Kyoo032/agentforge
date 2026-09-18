import { z } from "zod";
import { financeBriefSchema, type ArtifactMeta, type FinanceBrief } from "@agentforge/core/artifacts";

/**
 * The structured brief a saved finance artifact carries beside its markdown.
 *
 * A stored brief is prose by then, so an export that only has the artifact id used to lose every
 * computed table and chart series. The brief JSON rides on the artifact's `meta` — the free-form
 * bag every mode already stamps its provenance on — so no column moves, and an artifact saved
 * before this still exports through the markdown reader.
 */
export const FINANCE_META_BRIEF_KEY = "brief";
export const FINANCE_META_GUARD_KEY = "guard";

/**
 * Cap on the stored JSON. Meta comes back with every artifact the list returns, so a runaway brief
 * would weigh on lists that never asked for it; past this size the artifact keeps its markdown alone.
 */
export const FINANCE_META_MAX_BYTES = 256 * 1024;

const guardSchema = z.object({
  flagged: z.array(z.object({ section: z.number().int(), text: z.string() })).default([]),
  total: z.number().int().default(0),
});

export type FinanceStoredGuard = z.infer<typeof guardSchema>;

export type FinanceStoredBrief = {
  readonly brief: FinanceBrief;
  readonly guard?: FinanceStoredGuard;
  readonly task?: string;
};

/** Provenance plus the structured brief, or provenance alone when the brief is too big to carry. */
export function financeArtifactMeta(
  provenance: Record<string, unknown>,
  brief: FinanceBrief,
  guard: FinanceStoredGuard,
): Record<string, unknown> {
  const stored = { [FINANCE_META_BRIEF_KEY]: brief, [FINANCE_META_GUARD_KEY]: guard };
  if (Buffer.byteLength(JSON.stringify(stored), "utf8") > FINANCE_META_MAX_BYTES) {
    console.warn(`finance: brief over ${FINANCE_META_MAX_BYTES} bytes; its export will fall back to the markdown`);
    return { ...provenance };
  }
  return { ...provenance, ...stored };
}

/** The finance task stamped on an artifact, when the generate that saved it knew one. */
export function financeTaskFromMeta(meta: ArtifactMeta | undefined): string | undefined {
  const task = meta?.task;
  return typeof task === "string" && task.trim() ? task.trim() : undefined;
}

/** The structured brief, or null for an artifact that was saved without one. */
export function readStoredFinanceBrief(meta: ArtifactMeta | undefined): FinanceStoredBrief | null {
  const brief = financeBriefSchema.safeParse(meta?.[FINANCE_META_BRIEF_KEY]);
  if (!brief.success) {
    return null;
  }
  const guard = guardSchema.safeParse(meta?.[FINANCE_META_GUARD_KEY]);
  const task = financeTaskFromMeta(meta);
  return {
    brief: brief.data,
    ...(guard.success ? { guard: guard.data } : {}),
    ...(task ? { task } : {}),
  };
}
