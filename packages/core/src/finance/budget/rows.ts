/**
 * Confirmed line items sorted into the two sides the variance is taken between.
 *
 * Two rules decide what survives. A total is never a line: a row whose name says it is a total, and a
 * row that arithmetically equals the sum of every other row in its own section and period, is set
 * aside so revenue plus "Total revenue" cannot become double the revenue. And a row whose period
 * names no scenario is set aside too, named, rather than guessed onto one of the sides.
 *
 * Nothing here computes a variance; this is only the reading of the rows, and it is pure.
 */
import type { LineItem, LineItemCategory } from "../types";
import {
  budgetKindOf,
  budgetLabelText,
  isBudgetDerivedLabel,
  readBudgetScenario,
  type BudgetKind,
  type BudgetScenario,
  type ScenarioHints,
} from "./scenario";

/** How far a sum may sit from the row it would have to equal before that row is not that sum. */
export const BUDGET_DERIVED_RELATIVE_TOLERANCE = 0.005;
export const BUDGET_DERIVED_ABSOLUTE_TOLERANCE = 1;
/** Below this many siblings, "equals the sum of the others" is a coincidence, not a subtotal. */
const DERIVED_MIN_SIBLINGS = 3;

/**
 * One amount on one side.
 *
 * `period` is the period exactly as the sheet wrote it — "Anggaran 2024", "Q1 Budget" — because that
 * is the row's own period: it is what the reader saw, what the confirmed rows carry and what a
 * workbook formula addresses. `on` is what is left once the scenario word is taken out, and that is
 * the only thing the two sides may be lined up on: a budget row's "Anggaran 2024" and an actual
 * row's "Realisasi 2024" are the same year, and nothing else in the file says so.
 */
export type BudgetAmount = { readonly period: string; readonly on: string; readonly amount: number };

/** One line on one side of the comparison, across every period it appears in. */
export type BudgetSideLine = {
  readonly label: string;
  readonly kind: BudgetKind;
  readonly category: LineItemCategory;
  readonly amounts: readonly BudgetAmount[];
};

/** A row that was read but deliberately not compared, and the reason a reader is shown. */
export type BudgetExcludedRow = {
  readonly label: string;
  readonly period: string;
  readonly reason: "derived" | "unplaced";
};

export type BudgetSides = {
  readonly budget: readonly BudgetSideLine[];
  readonly actual: readonly BudgetSideLine[];
  /** Every period both sides are lined up on, in first-seen order. */
  readonly periods: readonly string[];
  readonly excluded: readonly BudgetExcludedRow[];
};

type PlacedRow = {
  readonly scenario: BudgetScenario;
  readonly label: string;
  readonly kind: BudgetKind;
  readonly category: LineItemCategory;
  /** As the sheet wrote it. */
  readonly period: string;
  /** What the two sides are compared on, once the scenario word is gone. */
  readonly on: string;
  readonly amount: number;
};

function placeRow(item: LineItem, hints: ScenarioHints): PlacedRow | null {
  const read = readBudgetScenario(item.period, hints);
  if (!read) {
    return null;
  }
  const label = budgetLabelText(item.label);
  return {
    scenario: read.scenario,
    label,
    kind: budgetKindOf(item.category, item.label),
    category: item.category,
    period: item.period,
    on: read.period,
    amount: item.amount,
  };
}

function closeEnough(sum: number, target: number): boolean {
  const slack = Math.max(BUDGET_DERIVED_ABSOLUTE_TOLERANCE, Math.abs(target) * BUDGET_DERIVED_RELATIVE_TOLERANCE);
  return Math.abs(sum - target) <= slack;
}

function groupKey(row: PlacedRow): string {
  return `${row.scenario}|${row.category}|${row.on}`;
}

/**
 * Labels that equal the sum of every other label in their own section and period, in every period
 * they fill. That is a subtotal however it is spelled, including in a language nobody listed.
 */
function arithmeticTotals(rows: readonly PlacedRow[]): ReadonlySet<string> {
  const groups = new Map<string, PlacedRow[]>();
  for (const row of rows) {
    groups.set(groupKey(row), [...(groups.get(groupKey(row)) ?? []), row]);
  }
  const verdicts = new Map<string, boolean>();
  for (const group of groups.values()) {
    const total = group.reduce((sum, row) => sum + row.amount, 0);
    for (const row of group) {
      const others = group.length - 1;
      const isTotal = others >= DERIVED_MIN_SIBLINGS && closeEnough(total - row.amount, row.amount);
      verdicts.set(row.label, (verdicts.get(row.label) ?? true) && isTotal);
    }
  }
  return new Set([...verdicts].filter(([, isTotal]) => isTotal).map(([label]) => label));
}

function addAmount(line: BudgetSideLine, amount: BudgetAmount): BudgetSideLine {
  const at = line.amounts.findIndex((entry) => entry.on === amount.on);
  if (at === -1) {
    return { ...line, amounts: [...line.amounts, amount] };
  }
  const merged = { ...amount, amount: (line.amounts[at]?.amount ?? 0) + amount.amount };
  return { ...line, amounts: line.amounts.map((entry, index) => (index === at ? merged : entry)) };
}

/** One line per label, in the order the sheet had them, with every period it filled folded in. */
function collect(rows: readonly PlacedRow[]): BudgetSideLine[] {
  const order: string[] = [];
  const byLabel = new Map<string, BudgetSideLine>();
  for (const row of rows) {
    const amount: BudgetAmount = { period: row.period, on: row.on, amount: row.amount };
    const seen = byLabel.get(row.label);
    if (!seen) {
      order.push(row.label);
      byLabel.set(row.label, { label: row.label, kind: row.kind, category: row.category, amounts: [amount] });
      continue;
    }
    byLabel.set(row.label, addAmount(seen, amount));
  }
  return order.flatMap((label) => {
    const line = byLabel.get(label);
    return line ? [line] : [];
  });
}

/**
 * The confirmed rows as two sides plus what was left out. `hints` lets the owner name the two
 * periods outright when the sheet's own words do not.
 *
 * `periods` are the periods the sides are COMPARED on, so a two-sheet workbook lines up on "2024"
 * and a quarterly one on "Q1" … "Q4"; each row still carries its own period as the sheet wrote it.
 */
export function readBudgetSides(items: readonly LineItem[], hints: ScenarioHints = {}): BudgetSides {
  const named = items.filter((item) => !isBudgetDerivedLabel(item.label));
  const derived: BudgetExcludedRow[] = items
    .filter((item) => isBudgetDerivedLabel(item.label))
    .map((item) => ({ label: budgetLabelText(item.label), period: item.period, reason: "derived" as const }));
  const placed = named.map((item) => ({ item, row: placeRow(item, hints) }));
  const unplaced: BudgetExcludedRow[] = placed
    .filter((entry) => entry.row === null)
    .map((entry) => ({ label: budgetLabelText(entry.item.label), period: entry.item.period, reason: "unplaced" as const }));
  const rows = placed.flatMap((entry) => (entry.row ? [entry.row] : []));
  const totals = arithmeticTotals(rows);
  const kept = rows.filter((row) => !totals.has(row.label));
  const summed: BudgetExcludedRow[] = rows
    .filter((row) => totals.has(row.label))
    .map((row) => ({ label: row.label, period: row.period, reason: "derived" as const }));
  const periods: string[] = [];
  for (const row of kept) {
    if (!periods.includes(row.on)) {
      periods.push(row.on);
    }
  }
  return {
    budget: collect(kept.filter((row) => row.scenario === "budget")),
    actual: collect(kept.filter((row) => row.scenario === "actual")),
    periods,
    excluded: [...derived, ...summed, ...unplaced],
  };
}

/** One side's amount on that comparison period, or 0 — a line never realised is zero, not missing. */
export function amountIn(line: BudgetSideLine | null, on: string): number {
  return line?.amounts.find((entry) => entry.on === on)?.amount ?? 0;
}

/** The period this side wrote for that comparison period, for a formula that addresses the rows. */
export function tagIn(line: BudgetSideLine | null, on: string): string {
  return line?.amounts.find((entry) => entry.on === on)?.period ?? "";
}
