/**
 * The phases a Finance task walks through. Each task has its own flow — not one
 * pipeline with different labels — so a phase id belongs to whichever tasks
 * actually draw it, and the six or seven a task lists are exactly the steps in
 * its graph.
 *
 * The kind is the graph legend: `shared` is a step several tasks share,
 * `input` is a step only that task asks the user for, and `math` is a step
 * computed in code. Whatever the task, numbers are computed in code, the model
 * only narrates, and the number guard runs last.
 */

export const FINANCE_PHASES = [
  // Financial brief
  "paste-figures",
  "parse-items",
  "confirm-rows",
  "core-metrics",
  "narrate-sections",
  "number-guard-export",
  // Cash flow and runway
  "monthly-flows",
  "parse-periods",
  "confirm-periods",
  "runway-math",
  "scenario",
  "narrate-guard-export",
  // Budget versus actual
  "budget-and-actuals",
  "parse-both-sets",
  "match-pairs",
  "variance-math",
  "flag-over-limit",
  "explain-flagged",
  "guard-export",
  // Investment appraisal
  "outlay-and-flows",
  "discount-rate",
  "confirm-flows",
  "appraisal-math",
  "sensitivity-grid",
  "memo-guard-export",
  // Ratio health check
  "balance-and-pl",
  "classify-buckets",
  "ratio-math",
  "bands-vs-thresholds",
  "scorecard-guard-export",
] as const;
export type FinancePhaseId = (typeof FINANCE_PHASES)[number];

/** `[x]` shared step · `[/x/]` task-only user step · `[[x]]` task-only code math. */
export type FinancePhaseKind = "shared" | "input" | "math";

export const FINANCE_PHASE_KINDS: Readonly<Record<FinancePhaseId, FinancePhaseKind>> = Object.freeze({
  "paste-figures": "shared",
  "parse-items": "shared",
  "confirm-rows": "shared",
  "core-metrics": "math",
  "narrate-sections": "shared",
  "number-guard-export": "shared",
  "monthly-flows": "input",
  "parse-periods": "math",
  "confirm-periods": "shared",
  "runway-math": "math",
  scenario: "input",
  "narrate-guard-export": "shared",
  "budget-and-actuals": "input",
  "parse-both-sets": "shared",
  "match-pairs": "input",
  "variance-math": "math",
  "flag-over-limit": "math",
  "explain-flagged": "input",
  "guard-export": "shared",
  "outlay-and-flows": "input",
  "discount-rate": "input",
  "confirm-flows": "shared",
  "appraisal-math": "math",
  "sensitivity-grid": "math",
  "memo-guard-export": "shared",
  "balance-and-pl": "input",
  "classify-buckets": "input",
  "ratio-math": "math",
  "bands-vs-thresholds": "math",
  "scorecard-guard-export": "shared",
});

const PHASE_IDS: ReadonlySet<string> = new Set(FINANCE_PHASES);

export function isFinancePhase(value: unknown): value is FinancePhaseId {
  return typeof value === "string" && PHASE_IDS.has(value);
}
