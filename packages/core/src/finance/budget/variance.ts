/**
 * The arithmetic of budget against actual. Plain, pure, and the only place a variance is produced.
 *
 * Four conventions decide every number below, and all four are the ones the reader expects:
 * - `variance = actual - budget`, and `variancePct = variance / budget * 100`.
 * - A budget line that was never realised has an actual of 0, so it reads -100 %, not "missing".
 *   A line that was never budgeted has no percent at all: dividing by a budget of zero is undefined,
 *   so the percent is `null` rather than 0 or Infinity.
 * - Over the full period, each side is summed first and the two formulas are applied to the sums.
 *   Averaging four quarterly percentages is a different number and it is the wrong one.
 * - Direction is read off the line: revenue over budget is favourable, cost over budget is not, and
 *   a variance of exactly zero is neutral rather than good news.
 *
 * A line is flagged when it breaks both limits — amount AND percent — because either alone flags the
 * whole sheet. The mode is configurable, the comparison is inclusive, and a line with no percent at
 * all counts as having broken the percent limit, so only the amount decides it.
 */
import type { LineItemCategory } from "../types";
import type { BudgetPairProposal } from "./match";
import { amountIn, tagIn, type BudgetSideLine } from "./rows";
import type { BudgetKind } from "./scenario";

export type BudgetDirection = "favourable" | "unfavourable" | "neutral";

export type BudgetThresholds = {
  /** Percent, as a percent number: 10 means 10 %. */
  readonly pct: number;
  /** Amount, in the report's own currency. */
  readonly abs: number;
  /** `and` is the default: both limits have to break before a line is worth a paragraph. */
  readonly mode: "and" | "or";
};

export const DEFAULT_BUDGET_THRESHOLDS: BudgetThresholds = Object.freeze({ pct: 10, abs: 0, mode: "and" as const });

export type BudgetVarianceCell = {
  readonly period: string;
  readonly budget: number;
  readonly actual: number;
  readonly variance: number;
  readonly variancePct: number | null;
  readonly direction: BudgetDirection;
  readonly flagged: boolean;
};

export type BudgetVarianceLine = {
  readonly slug: string;
  readonly label: string;
  readonly budgetLabel: string | null;
  readonly actualLabel: string | null;
  readonly kind: BudgetKind;
  readonly category: LineItemCategory;
  readonly matchScore: number;
  readonly matchStage: BudgetPairProposal["stage"];
  /** The period tags each side arrived under, for the workbook's own formulas. */
  readonly budgetTags: readonly string[];
  readonly actualTags: readonly string[];
  readonly periods: readonly BudgetVarianceCell[];
  /** Every period summed, then divided. For a single-period sheet this is that period. */
  readonly total: BudgetVarianceCell;
};

/** The roll-ups a reader checks the lines against. `result` is revenue less every cost. */
export type BudgetAggregateId = "revenue" | "cogs" | "opex" | "cost" | "grossProfit" | "result";

export type BudgetAggregate = {
  readonly id: BudgetAggregateId;
  readonly kind: BudgetKind;
  readonly periods: readonly BudgetVarianceCell[];
  readonly total: BudgetVarianceCell;
};

function directionOf(variance: number, kind: BudgetKind): BudgetDirection {
  if (variance === 0) {
    return "neutral";
  }
  return (variance > 0) === (kind === "revenue") ? "favourable" : "unfavourable";
}

function breaks(variance: number, pct: number | null, limits: BudgetThresholds): boolean {
  const byAmount = Math.abs(variance) >= limits.abs;
  // No percent means no percent test to pass: the amount alone decides an unbudgeted line.
  const byPercent = pct === null ? true : Math.abs(pct) >= limits.pct;
  return limits.mode === "or" ? byAmount || byPercent : byAmount && byPercent;
}

/** One budget figure against one actual figure. The whole of the task's arithmetic is here. */
export function varianceCell(
  period: string,
  budget: number,
  actual: number,
  kind: BudgetKind,
  limits: BudgetThresholds,
): BudgetVarianceCell {
  const variance = actual - budget;
  const variancePct = budget === 0 ? null : (variance / budget) * 100;
  return {
    period,
    budget,
    actual,
    variance,
    variancePct,
    direction: directionOf(variance, kind),
    flagged: breaks(variance, variancePct, limits),
  };
}

function sumCells(
  cells: readonly BudgetVarianceCell[],
  kind: BudgetKind,
  limits: BudgetThresholds,
): BudgetVarianceCell {
  const budget = cells.reduce((sum, cell) => sum + cell.budget, 0);
  const actual = cells.reduce((sum, cell) => sum + cell.actual, 0);
  return varianceCell("", budget, actual, kind, limits);
}

export function budgetSlug(label: string): string {
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "line";
}

function find(lines: readonly BudgetSideLine[], label: string | null): BudgetSideLine | null {
  return label === null ? null : (lines.find((line) => line.label === label) ?? null);
}

function tagsOf(line: BudgetSideLine | null, periods: readonly string[]): string[] {
  return periods.map((period) => tagIn(line, period));
}

/** One proposed (or confirmed) pair turned into its variance across every period and in total. */
function lineFrom(
  pair: BudgetPairProposal,
  budgetLines: readonly BudgetSideLine[],
  actualLines: readonly BudgetSideLine[],
  periods: readonly string[],
  limits: BudgetThresholds,
): BudgetVarianceLine {
  const left = find(budgetLines, pair.budgetLabel);
  const right = find(actualLines, pair.actualLabel);
  const anchor = left ?? right;
  const kind: BudgetKind = anchor?.kind ?? "cost";
  const cells = periods.map((period) =>
    varianceCell(period, amountIn(left, period), amountIn(right, period), kind, limits),
  );
  const label = pair.budgetLabel ?? pair.actualLabel ?? "";
  return {
    slug: budgetSlug(label),
    label,
    budgetLabel: pair.budgetLabel,
    actualLabel: pair.actualLabel,
    kind,
    category: anchor?.category ?? "other",
    matchScore: pair.score,
    matchStage: pair.stage,
    budgetTags: tagsOf(left, periods),
    actualTags: tagsOf(right, periods),
    periods: cells,
    total: periods.length === 1 ? { ...(cells[0] as BudgetVarianceCell), period: "" } : sumCells(cells, kind, limits),
  };
}

/**
 * Lines in the order a reader met them: the budget sheet's own order, then whatever the actuals
 * added. A pairing sorted by confidence is useful in the pairing table and confusing everywhere else.
 */
function inSheetOrder(
  pairs: readonly BudgetPairProposal[],
  budgetLines: readonly BudgetSideLine[],
  actualLines: readonly BudgetSideLine[],
): BudgetPairProposal[] {
  const budgetAt = new Map(budgetLines.map((line, index) => [line.label, index]));
  const actualAt = new Map(actualLines.map((line, index) => [line.label, index]));
  const rank = (pair: BudgetPairProposal): number =>
    pair.budgetLabel === null
      ? budgetLines.length + (actualAt.get(pair.actualLabel ?? "") ?? 0)
      : (budgetAt.get(pair.budgetLabel) ?? 0);
  return [...pairs].sort((left, right) => rank(left) - rank(right));
}

export function budgetVarianceLines(
  pairs: readonly BudgetPairProposal[],
  budgetLines: readonly BudgetSideLine[],
  actualLines: readonly BudgetSideLine[],
  periods: readonly string[],
  limits: BudgetThresholds,
): BudgetVarianceLine[] {
  const ordered = inSheetOrder(pairs, budgetLines, actualLines);
  return ordered.map((pair) => lineFrom(pair, budgetLines, actualLines, periods, limits));
}

const AGGREGATE_KIND: Readonly<Record<BudgetAggregateId, BudgetKind>> = Object.freeze({
  revenue: "revenue",
  cogs: "cost",
  opex: "cost",
  cost: "cost",
  grossProfit: "revenue",
  result: "revenue",
});

type Pick = (line: BudgetVarianceLine) => boolean;

function rollUp(
  id: BudgetAggregateId,
  lines: readonly BudgetVarianceLine[],
  periods: readonly string[],
  limits: BudgetThresholds,
  add: Pick,
  subtract: Pick = () => false,
): BudgetAggregate {
  const kind = AGGREGATE_KIND[id];
  const side = (at: number, read: (cell: BudgetVarianceCell) => number): number =>
    lines.reduce((sum, line) => {
      const cell = line.periods[at];
      if (!cell) {
        return sum;
      }
      return add(line) ? sum + read(cell) : subtract(line) ? sum - read(cell) : sum;
    }, 0);
  const cells = periods.map((period, at) =>
    varianceCell(
      period,
      side(at, (cell) => cell.budget),
      side(at, (cell) => cell.actual),
      kind,
      limits,
    ),
  );
  return {
    id,
    kind,
    periods: cells,
    total: periods.length === 1 ? { ...(cells[0] as BudgetVarianceCell), period: "" } : sumCells(cells, kind, limits),
  };
}

/**
 * The roll-ups this sheet can honestly carry. A sheet that never separates cost of sales from
 * operating cost gets one `cost` row and no gross profit, rather than a gross profit of nothing.
 */
export function budgetAggregates(
  lines: readonly BudgetVarianceLine[],
  periods: readonly string[],
  limits: BudgetThresholds,
): BudgetAggregate[] {
  const isRevenue: Pick = (line) => line.kind === "revenue";
  const isCogs: Pick = (line) => line.category === "cogs";
  const isOpex: Pick = (line) => line.kind === "cost" && line.category !== "cogs";
  const split = lines.some(isCogs) && lines.some(isOpex);
  const costRows: BudgetAggregate[] = split
    ? [rollUp("cogs", lines, periods, limits, isCogs), rollUp("opex", lines, periods, limits, isOpex)]
    : [rollUp("cost", lines, periods, limits, (line) => line.kind === "cost")];
  const grossProfit = split
    ? [rollUp("grossProfit", lines, periods, limits, isRevenue, isCogs)]
    : [];
  return [
    rollUp("revenue", lines, periods, limits, isRevenue),
    ...costRows,
    ...grossProfit,
    rollUp("result", lines, periods, limits, isRevenue, (line) => line.kind === "cost"),
  ];
}

/** How many lines broke the limit in each period, and over the whole period. */
export function budgetFlagCounts(
  lines: readonly BudgetVarianceLine[],
  periods: readonly string[],
): { readonly byPeriod: readonly { readonly period: string; readonly count: number }[]; readonly total: number } {
  return {
    byPeriod: periods.map((period, at) => ({
      period,
      count: lines.filter((line) => line.periods[at]?.flagged === true).length,
    })),
    total: lines.filter((line) => line.total.flagged).length,
  };
}
