/**
 * What one budget line's possible partners are worth, and in which order.
 *
 * Four readings are blended into one number on one scale. An exact label, the finance dictionary and
 * character trigrams are local and always available; a cosine between the two labels' embeddings is
 * optional and is handed in from outside, because core opens no socket. The blend is a maximum — the
 * strongest argument wins — so an embedding can raise a pair the dictionary under-read but can never
 * lower one it already recognised.
 *
 * Two rails keep the optional stage honest. A cosine is first calibrated onto the local scale, where
 * the band it may occupy starts at the weakest score any pair is allowed and stops below a dictionary
 * hit: vector agreement is real evidence, just never the best evidence in the room. And a revenue
 * line may never be scored against a cost line at all, whatever any stage says about the words.
 */
import { budgetLabelSimilarity, type BudgetMatchStage } from "./labels";
import type { BudgetSideLine } from "./rows";

/** Below this, nothing on the table is a pair. */
export const BUDGET_MATCH_MIN_SCORE = 0.4;
/**
 * Best minus second best. Under this the two readings are too close to call, and a coin toss dressed
 * as a proposal is worse than an honest question: the line is left unmatched with both names shown.
 */
export const BUDGET_MATCH_MIN_MARGIN = 0.08;
/** Under this cosine two labels are not arguing for each other, they are merely both finance words. */
export const BUDGET_EMBED_MIN_COSINE = 0.78;
/** What a cosine of exactly 1 is worth: below an exact label and below a full dictionary hit. */
export const BUDGET_EMBED_MAX_SCORE = 0.9;
/** How many partners an unmatched line offers the reader to choose from. */
export const BUDGET_CANDIDATE_MAX = 2;

/** A cosine between one budget label and one actual label, as the host measured it. */
export type BudgetSimilarity = (budgetLabel: string, actualLabel: string) => number;

/** One possible partner for one line, with the score and the stage that argued for it. */
export type BudgetCandidate = {
  readonly label: string;
  readonly score: number;
  readonly stage: BudgetMatchStage;
};

/**
 * A cosine read onto the local 0..1 scale.
 *
 * The band is deliberate rather than linear from zero: cosines between two short finance labels sit
 * high and close together, so the interesting range is the top fifth. A cosine that only just clears
 * the floor is worth exactly the weakest score a pair may have, and a perfect one stops short of a
 * dictionary hit.
 */
export function calibrateEmbedScore(cosine: number): number {
  if (!Number.isFinite(cosine) || cosine < BUDGET_EMBED_MIN_COSINE) {
    return 0;
  }
  const reach = Math.min(1, (cosine - BUDGET_EMBED_MIN_COSINE) / (1 - BUDGET_EMBED_MIN_COSINE));
  return BUDGET_MATCH_MIN_SCORE + reach * (BUDGET_EMBED_MAX_SCORE - BUDGET_MATCH_MIN_SCORE);
}

/** Revenue is never cost. This gate holds for every stage, including the one that reads meaning. */
export function budgetKindsAgree(left: BudgetSideLine, right: BudgetSideLine): boolean {
  return left.kind === right.kind;
}

/**
 * Whether the two sheets filed these lines under the same kind of section. A sheet that printed no
 * heading says "other" and argues with nobody, so it is allowed through.
 */
function sectionsAgree(left: BudgetSideLine, right: BudgetSideLine): boolean {
  return left.category === "other" || right.category === "other" || left.category === right.category;
}

/**
 * The blended score for one possible pair, or nothing when the two lines may not be compared at all.
 *
 * Sub-threshold scores are returned rather than dropped: they are what an unmatched line offers the
 * reader as a one-click choice, and hiding them would make the screen look more certain than it is.
 */
export function scoreBudgetPair(
  budget: BudgetSideLine,
  actual: BudgetSideLine,
  similarity?: BudgetSimilarity,
): BudgetCandidate | null {
  if (!budgetKindsAgree(budget, actual)) {
    return null;
  }
  const local = sectionsAgree(budget, actual)
    ? budgetLabelSimilarity(budget.label, actual.label)
    : { score: 0, stage: "dictionary" as const };
  const meaning = similarity ? calibrateEmbedScore(similarity(budget.label, actual.label)) : 0;
  const best = meaning > local.score ? { score: meaning, stage: "embedding" as const } : local;
  return best.score <= 0 ? null : { label: actual.label, score: best.score, stage: best.stage };
}

/** Ties break on the label so the same input always ranks the same way, on any machine. */
function byScore(left: BudgetCandidate, right: BudgetCandidate): number {
  return right.score - left.score || left.label.localeCompare(right.label);
}

/** Every partner one budget line could have, best first. */
export function rankBudgetCandidates(
  budget: BudgetSideLine,
  actual: readonly BudgetSideLine[],
  similarity?: BudgetSimilarity,
): BudgetCandidate[] {
  return actual
    .flatMap((line) => {
      const scored = scoreBudgetPair(budget, line, similarity);
      return scored ? [scored] : [];
    })
    .sort(byScore);
}
