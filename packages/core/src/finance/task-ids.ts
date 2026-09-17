/**
 * The named Finance tasks. Finance used to be one job — figures in, one brief
 * out — and is really many: each task owns its own phases, its own math and its
 * own report, the way each Market desk owns its own harness. The id is what the
 * rail links (`/finance?task=<id>`), what the host validates, and what the
 * artifact is stamped with.
 *
 * Adding a task is an entry here plus one in the meta and one in the rules —
 * never a second pipeline.
 */

export const FINANCE_TASKS = ["brief", "cashflow", "budget", "appraisal", "ratios"] as const;
export type FinanceTask = (typeof FINANCE_TASKS)[number];

/** The task Finance has always done; an absent or unknown `task` resolves here. */
export const DEFAULT_FINANCE_TASK: FinanceTask = "brief";

const IDS: ReadonlySet<string> = new Set(FINANCE_TASKS);

export function isFinanceTask(value: unknown): value is FinanceTask {
  return typeof value === "string" && IDS.has(value);
}
