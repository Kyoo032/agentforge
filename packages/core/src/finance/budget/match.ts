/**
 * Which budget line is which actual line — proposed, scored, and left for the owner to confirm.
 *
 * `candidates.ts` says what a pair is worth; this file decides who gets whom. The assignment is
 * one-to-one and greedy from the best score down, inside one kind — a revenue line never pairs with a
 * cost line — and a line that finds nothing is left unmatched rather than wrongly paired.
 *
 * The rule that keeps a confident matcher honest is the margin. When a line's best partner is barely
 * ahead of its second best, the two readings are a question, not an answer: the line stays unmatched
 * and both names are handed to the reader as one-click choices. That is also what makes an embedding
 * safe to let in as a proposer — a vector space that likes everything equally produces ties, and ties
 * pair nothing. Every unmatched line carries its top candidates for the same reason: the screen should
 * offer the next-best reading rather than make the reader hunt for it in a dropdown.
 *
 * The local stages are asked first and the blend only second, which is what makes the optional stage
 * strictly additive. A line the dictionary already decides is decided; a cosine can only rescue a line
 * the local stages left open. Without that ordering a badly calibrated embedder that likes every label
 * equally would turn every decided line into a tie and quietly cost recall, which is the one way an
 * extra source of evidence can make an answer worse.
 *
 * Every proposal carries its score and the stage that produced it, so the pairing table can say *why*
 * before anyone accepts it.
 */
import {
  BUDGET_CANDIDATE_MAX,
  BUDGET_MATCH_MIN_MARGIN,
  BUDGET_MATCH_MIN_SCORE,
  rankBudgetCandidates,
  type BudgetCandidate,
  type BudgetSimilarity,
} from "./candidates";
import type { BudgetMatchStage } from "./labels";
import type { BudgetSideLine } from "./rows";

export type BudgetPairProposal = {
  readonly budgetLabel: string | null;
  readonly actualLabel: string | null;
  /** 0..1. Always 1 for a pair the owner set by hand. */
  readonly score: number;
  readonly stage: BudgetMatchStage | "manual" | "unmatched" | "ambiguous";
  /** The best partners still free for this line, for a reader who disagrees. Never more than two. */
  readonly candidates?: readonly BudgetCandidate[];
};

export type BudgetPairing = {
  readonly pairs: readonly BudgetPairProposal[];
  readonly budgetOnly: readonly string[];
  readonly actualOnly: readonly string[];
};

/** How the matcher is allowed to argue. Both are optional; the defaults are the local stages alone. */
export type BudgetProposeOptions = {
  /** Injected by the host so core stays pure: a cosine between two labels' embeddings. */
  readonly similarity?: BudgetSimilarity;
  /** Best minus second best, under which a line is left for the reader to decide. */
  readonly margin?: number;
};

type Ranked = {
  readonly budget: BudgetSideLine;
  /** What the local stages alone make of this line. */
  readonly local: readonly BudgetCandidate[];
  /** The same, blended with whatever the optional similarity said. Equal to `local` without one. */
  readonly blended: readonly BudgetCandidate[];
};

type Bound = { readonly budgetLabel: string; readonly actual: BudgetCandidate };

/** The candidates that are still free, best first. */
function free(candidates: readonly BudgetCandidate[], taken: ReadonlySet<string>): readonly BudgetCandidate[] {
  return candidates.filter((candidate) => !taken.has(candidate.label));
}

/** A pair worth proposing: strong enough on its own, and clearly ahead of the runner-up. */
function decided(candidates: readonly BudgetCandidate[], margin: number): BudgetCandidate | null {
  const best = candidates[0];
  if (!best || best.score < BUDGET_MATCH_MIN_SCORE) {
    return null;
  }
  const second = candidates[1];
  return second && best.score - second.score < margin ? null : best;
}

/**
 * One greedy pass over one reading of the evidence, from the strongest pair down.
 *
 * Re-reading the free candidates on every step is what makes the margin mean something: a runner-up
 * that has already been taken by a stronger pair is no longer a rival, so the line it was blocking
 * can still be decided.
 */
function sweep(
  ranked: readonly Ranked[],
  reading: (entry: Ranked) => readonly BudgetCandidate[],
  margin: number,
  done: Set<string>,
  takenActual: Set<string>,
  bound: Bound[],
): void {
  const queue = ranked.filter((entry) => reading(entry).length > 0);
  for (let step = 0; step < queue.length; step += 1) {
    const choices = queue
      .filter((entry) => !done.has(entry.budget.label))
      .map((entry) => ({ entry, pick: decided(free(reading(entry), takenActual), margin) }))
      .flatMap((entry) => (entry.pick ? [{ budget: entry.entry.budget, pick: entry.pick }] : []))
      .sort((left, right) => right.pick.score - left.pick.score || left.budget.label.localeCompare(right.budget.label));
    const next = choices[0];
    if (!next) {
      return;
    }
    done.add(next.budget.label);
    takenActual.add(next.pick.label);
    bound.push({ budgetLabel: next.budget.label, actual: next.pick });
  }
}

/**
 * Two sweeps, and the order of them is the whole safety argument.
 *
 * The first sweep sees only local evidence, so every line a reader could have paired by hand is
 * paired before the optional stage is consulted at all. The second sweep sees the blend and gets
 * only what is left over. A cosine can therefore add a pair, never take one away, and an embedder
 * that likes every label equally costs nothing beyond the pairs nobody could make locally either.
 */
function assign(ranked: readonly Ranked[], margin: number): { bound: Bound[]; takenActual: Set<string> } {
  const takenActual = new Set<string>();
  const done = new Set<string>();
  const bound: Bound[] = [];
  sweep(ranked, (entry) => entry.local, margin, done, takenActual, bound);
  sweep(ranked, (entry) => entry.blended, margin, done, takenActual, bound);
  return { bound, takenActual };
}

/** An unmatched line and the two partners it would most like, if any are left. */
function unmatchedPair(ranked: Ranked, takenActual: ReadonlySet<string>, margin: number): BudgetPairProposal {
  const options = free(ranked.blended, takenActual).slice(0, BUDGET_CANDIDATE_MAX);
  const close = options.length > 1 && (options[0]?.score ?? 0) - (options[1]?.score ?? 0) < margin;
  return {
    budgetLabel: ranked.budget.label,
    actualLabel: null,
    score: 0,
    // "Too close to call" is a different sentence from "nothing here fits", and the reader needs both.
    stage: close && (options[0]?.score ?? 0) >= BUDGET_MATCH_MIN_SCORE ? "ambiguous" : "unmatched",
    ...(options.length > 0 ? { candidates: options } : {}),
  };
}

/**
 * The proposed pairing. `options.similarity` is injected by the host and everything else is local, so
 * this is the same answer offline, with a stubbed embedder, or with the circuit breaker open.
 */
export function proposeBudgetPairs(
  budget: readonly BudgetSideLine[],
  actual: readonly BudgetSideLine[],
  options: BudgetProposeOptions = {},
): BudgetPairing {
  const margin = options.margin ?? BUDGET_MATCH_MIN_MARGIN;
  const ranked: Ranked[] = budget.map((line) => {
    const local = rankBudgetCandidates(line, actual);
    return {
      budget: line,
      local,
      blended: options.similarity ? rankBudgetCandidates(line, actual, options.similarity) : local,
    };
  });
  const { bound, takenActual } = assign(ranked, margin);
  const byBudget = new Map(bound.map((entry) => [entry.budgetLabel, entry.actual]));
  const pairs = bound.map((entry) => ({
    budgetLabel: entry.budgetLabel,
    actualLabel: entry.actual.label,
    score: entry.actual.score,
    stage: entry.actual.stage,
  }));
  const loose = ranked.filter((entry) => !byBudget.has(entry.budget.label));
  const budgetOnly = loose.map((entry) => entry.budget.label);
  const actualOnly = actual.map((line) => line.label).filter((label) => !takenActual.has(label));
  return {
    pairs: [
      ...pairs,
      ...loose.map((entry) => unmatchedPair(entry, takenActual, margin)),
      ...actualOnly.map((label) => ({ budgetLabel: null, actualLabel: label, score: 0, stage: "unmatched" as const })),
    ],
    budgetOnly,
    actualOnly,
  };
}

/**
 * The pairing the owner confirmed, taken as given. Labels that no longer exist are dropped and the
 * lines they freed go back into the unmatched buckets, so an edited pairing can never invent a row.
 */
export function applyConfirmedPairs(
  budget: readonly BudgetSideLine[],
  actual: readonly BudgetSideLine[],
  confirmed: readonly { readonly budgetLabel: string | null; readonly actualLabel: string | null }[],
): BudgetPairing {
  const budgetLabels = new Set(budget.map((line) => line.label));
  const actualLabels = new Set(actual.map((line) => line.label));
  const takenBudget = new Set<string>();
  const takenActual = new Set<string>();
  const pairs: BudgetPairProposal[] = [];
  for (const entry of confirmed) {
    const left = entry.budgetLabel && budgetLabels.has(entry.budgetLabel) ? entry.budgetLabel : null;
    const right = entry.actualLabel && actualLabels.has(entry.actualLabel) ? entry.actualLabel : null;
    // A half pair says nothing a bucket does not already say, so it falls through to the buckets.
    if (!left || !right || takenBudget.has(left) || takenActual.has(right)) {
      continue;
    }
    takenBudget.add(left);
    takenActual.add(right);
    pairs.push({ budgetLabel: left, actualLabel: right, score: 1, stage: "manual" });
  }
  const budgetOnly = budget.map((line) => line.label).filter((label) => !takenBudget.has(label));
  const actualOnly = actual.map((line) => line.label).filter((label) => !takenActual.has(label));
  return {
    pairs: [
      ...pairs,
      ...budgetOnly.map((label) => ({ budgetLabel: label, actualLabel: null, score: 0, stage: "unmatched" as const })),
      ...actualOnly.map((label) => ({ budgetLabel: null, actualLabel: label, score: 0, stage: "unmatched" as const })),
    ],
    budgetOnly,
    actualOnly,
  };
}
