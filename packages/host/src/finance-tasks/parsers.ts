/**
 * Which parse hook `/api/v1/finance/parse` runs for a task.
 *
 * One import per task file and nothing else: a worker adds `parse-<task>.ts` and its row here is
 * already written. A `null` means the task reuses the brief's line-item read until its own parse
 * exists — the endpoint never has to grow a switch, and never has to guess.
 */
import { isFinanceTask, type FinanceTask } from "@agentforge/core/finance";
import { parseAppraisalInput } from "./parse-appraisal";
import { parseBriefInput } from "./parse-brief";
import { parseBudgetInput } from "./parse-budget";
import { parseCashflowInput } from "./parse-cashflow";
import { parseRatiosInput } from "./parse-ratios";
import type { FinanceTaskParser } from "./types";

const PARSERS: Readonly<Record<FinanceTask, FinanceTaskParser | null>> = Object.freeze({
  brief: parseBriefInput,
  cashflow: parseCashflowInput,
  budget: parseBudgetInput,
  appraisal: parseAppraisalInput,
  ratios: parseRatiosInput,
});

export const FINANCE_TASK_PARSERS = PARSERS;

/** The task's own parser, or the brief's — which is what a task without one still means. */
export function financeTaskParser(task: unknown): FinanceTaskParser {
  const parser = isFinanceTask(task) ? PARSERS[task] : null;
  return parser ?? parseBriefInput;
}
