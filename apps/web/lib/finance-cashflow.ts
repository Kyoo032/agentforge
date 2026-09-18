/**
 * The cash-flow studio's own state, as pure functions.
 *
 * The studio shell owns one bag of rows and one bag of parameters and knows nothing about either, so
 * everything this task needs to read or change lives here — editing a period, moving a category
 * between variable and fixed, writing a what-if lever — and every one of them answers with a new
 * object rather than changing the one it was handed.
 *
 * Nothing here computes a figure of its own: the live preview calls the same `computeCashflow` the
 * host runs, so what the panel shows while the reader types is the arithmetic the report will use.
 */
import {
  CASHFLOW_ROW_NAMES,
  cashflowRowKind,
  cashflowRowsFromFolds,
  classifyCashflowLabel,
  computeCashflow,
  foldCategories,
  foldPeriodOrder,
  isSignedBook,
  type CashflowBreakdown,
  type CashflowCategory,
  type CashflowComputed,
  type CashflowItem,
  type CashflowParams,
  type CostBehaviour,
} from "@agentforge/core/finance";
import type { FinanceParams, LineItem } from "./finance-client";

/** One row of the periods table: the two sides, the financing, and the cost behaviour behind them. */
export type CashflowPeriodRow = {
  readonly period: string;
  readonly cashIn: number;
  readonly cashOut: number;
  readonly financingIn: number;
  readonly breakdown: CashflowBreakdown;
};

/** The three amounts of a period row a reader may retype, and the three slices under the outflow. */
export const CASHFLOW_EDIT_FIELDS = ["cashIn", "cashOut", "financingIn"] as const;
export type CashflowEditField = (typeof CASHFLOW_EDIT_FIELDS)[number];

const EMPTY_BREAKDOWN: CashflowBreakdown = { variable: 0, fixed: 0, oneOff: 0, roles: {} };

/**
 * The studio's parameter bag, read as this task's parameters.
 *
 * The shell types the bag as the brief's `FinanceParams`, because the brief is the only task it knows
 * about. Every task widens it for its own knobs; the widening is done here, once, rather than at each
 * call site.
 */
export function cashflowParamsOf(params: FinanceParams): CashflowParams {
  return (params ?? {}) as CashflowParams;
}

/** A patch onto the parameter bag. Keys left out are untouched; an undefined value clears its key. */
export function withCashflowParams(params: FinanceParams, patch: Partial<CashflowParams>): FinanceParams {
  const merged: Record<string, unknown> = { ...cashflowParamsOf(params), ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete merged[key];
    }
  }
  return merged as FinanceParams;
}

/** The rows the studio holds, seen as this task's rows. Extra fields ride along untouched. */
export function cashflowItemsOf(items: readonly LineItem[]): CashflowItem[] {
  return items as unknown as CashflowItem[];
}

/** …and back, for the shell's own setter. */
export function lineItemsOf(items: readonly CashflowItem[]): LineItem[] {
  return items as unknown as LineItem[];
}

/** The side a row is on: what the parse wrote, or what the row itself says when nothing did. */
function kindOf(item: CashflowItem): CashflowItem["kind"] {
  return item.kind ?? cashflowRowKind(item);
}

/**
 * Rows that never went through this task's parse — typed by hand, or carried over from the brief's
 * line-item read — folded into the one-row-per-side-per-period shape the panel edits.
 *
 * Without this the table would either show nothing or quietly drop a second revenue line; with it a
 * reader can start from any rows at all and still confirm a cash book. Rows the parse already shaped
 * are returned untouched, so this runs once and is idempotent.
 */
export function normaliseCashflowItems(items: readonly CashflowItem[], language: "id" | "en"): CashflowItem[] {
  if (items.length === 0 || items.every((item) => item.kind !== undefined)) {
    return [...items];
  }
  const opening = items.find((item) => kindOf(item) === "opening");
  const flows = items.filter((item) => item !== opening && kindOf(item) !== "opening");
  const categories: CashflowCategory[] = [];
  for (const item of flows) {
    const at = categories.findIndex((entry) => entry.label === item.label);
    const entry = categories[at];
    if (entry) {
      categories[at] = { ...entry, amounts: [...(entry.amounts ?? []), { period: item.period, amount: item.amount }] };
      continue;
    }
    categories.push({
      ...classifyCashflowLabel(item.label, { amount: item.amount, kind: kindOf(item) }),
      amounts: [{ period: item.period, amount: item.amount }],
    });
  }
  const rebuilt = cashflowRowsFromFolds({
    order: foldPeriodOrder(categories),
    folds: foldCategories(categories, isSignedBook(categories)),
    names: CASHFLOW_ROW_NAMES[language],
    currency: items.find((item) => item.currency.trim() !== "")?.currency ?? "",
    opening: opening ? { label: opening.label, amount: opening.amount } : null,
  });
  return rebuilt.map((item, at) => (at === 0 ? { ...item, classification: categories } : item));
}

/** The periods table, in the order the rows carry. */
export function cashflowPeriodRows(items: readonly CashflowItem[]): CashflowPeriodRow[] {
  const order: string[] = [];
  const rows = new Map<string, CashflowPeriodRow>();
  for (const item of items) {
    const kind = kindOf(item);
    if (kind === "opening" || kind === undefined) {
      continue;
    }
    if (!rows.has(item.period)) {
      order.push(item.period);
      rows.set(item.period, {
        period: item.period,
        cashIn: 0,
        cashOut: 0,
        financingIn: 0,
        breakdown: EMPTY_BREAKDOWN,
      });
    }
    const row = rows.get(item.period) as CashflowPeriodRow;
    rows.set(item.period, {
      ...row,
      cashIn: row.cashIn + (kind === "inflow" ? Math.abs(item.amount) : 0),
      cashOut: row.cashOut + (kind === "outflow" ? Math.abs(item.amount) : 0),
      financingIn: row.financingIn + (kind === "financing" ? item.amount : 0),
      breakdown: item.breakdown ?? row.breakdown,
    });
  }
  return order.map((period) => rows.get(period) as CashflowPeriodRow);
}

const FIELD_KIND: Readonly<Record<CashflowEditField, NonNullable<CashflowItem["kind"]>>> = {
  cashIn: "inflow",
  cashOut: "outflow",
  financingIn: "financing",
};

/**
 * One amount retyped.
 *
 * Changing a period's cash out keeps its cost behaviour in step by scaling the slices it is made of:
 * a reader who corrects a total should not silently be left with a breakdown that no longer adds up
 * to it. When the old total was zero there is nothing to scale, so the change lands on the fixed base.
 */
export function withPeriodAmount(
  items: readonly CashflowItem[],
  period: string,
  field: CashflowEditField,
  value: number,
): CashflowItem[] {
  const kind = FIELD_KIND[field];
  return items.map((item) => {
    if (item.period !== period || kindOf(item) !== kind) {
      return item;
    }
    return kind === "outflow" ? { ...item, amount: value, breakdown: scaleBreakdown(item, value) } : { ...item, amount: value };
  });
}

function scaleBreakdown(item: CashflowItem, next: number): CashflowBreakdown {
  const current = item.breakdown ?? EMPTY_BREAKDOWN;
  const total = current.variable + current.fixed + current.oneOff;
  if (total === 0) {
    return { ...current, fixed: next };
  }
  const factor = next / total;
  const roles = Object.fromEntries(Object.entries(current.roles).map(([role, amount]) => [role, (amount ?? 0) * factor]));
  return {
    variable: current.variable * factor,
    fixed: current.fixed * factor,
    oneOff: current.oneOff * factor,
    roles,
  };
}

/** One slice of one period's outflow retyped. The period's total moves with it, because it is its sum. */
export function withBreakdownSlice(
  items: readonly CashflowItem[],
  period: string,
  slice: CostBehaviour,
  value: number,
): CashflowItem[] {
  return items.map((item) => {
    if (item.period !== period || kindOf(item) !== "outflow") {
      return item;
    }
    const breakdown = { ...(item.breakdown ?? EMPTY_BREAKDOWN), [slice]: value };
    return { ...item, breakdown, amount: breakdown.variable + breakdown.fixed + breakdown.oneOff };
  });
}

/** The classification the parse attached, wherever on the rows it rode along. */
export function cashflowClassification(items: readonly CashflowItem[]): CashflowCategory[] {
  return [...(items.find((item) => item.classification && item.classification.length > 0)?.classification ?? [])];
}

function rowNames(items: readonly CashflowItem[]) {
  const cashIn = items.find((item) => kindOf(item) === "inflow")?.label;
  const cashOut = items.find((item) => kindOf(item) === "outflow")?.label;
  const financing = items.find((item) => kindOf(item) === "financing")?.label;
  const fallback = cashIn === CASHFLOW_ROW_NAMES.id.cashIn ? CASHFLOW_ROW_NAMES.id : CASHFLOW_ROW_NAMES.en;
  return {
    cashIn: cashIn ?? fallback.cashIn,
    cashOut: cashOut ?? fallback.cashOut,
    financing: financing ?? fallback.financing,
  };
}

/**
 * A category moved between variable, fixed and one-off — and every period folded again from its own
 * figures, so the breakeven base the report quotes is the one the reader just agreed to.
 */
export function withCategoryBehaviour(
  items: readonly CashflowItem[],
  label: string,
  behaviour: CostBehaviour,
): CashflowItem[] {
  const classification = cashflowClassification(items).map((entry) =>
    entry.label === label ? { ...entry, behaviour, confidence: 1 } : entry,
  );
  if (classification.length === 0 || !classification.some((entry) => (entry.amounts ?? []).length > 0)) {
    return [...items];
  }
  const opening = items.find((item) => kindOf(item) === "opening");
  const rebuilt = cashflowRowsFromFolds({
    order: foldPeriodOrder(classification),
    folds: foldCategories(classification, isSignedBook(classification)),
    names: rowNames(items),
    currency: items[0]?.currency ?? "",
    opening: opening ? { label: opening.label, amount: opening.amount } : null,
  });
  return rebuilt.map((item, at) => (at === 0 ? { ...item, classification } : item));
}

/** The opening balance the studio shows: the typed parameter first, then the book's own row. */
export function openingCashOf(items: readonly CashflowItem[], params: FinanceParams): number {
  const typed = cashflowParamsOf(params).openingCash;
  return typed ?? items.find((item) => kindOf(item) === "opening")?.amount ?? 0;
}

/** The live preview the panel recomputes on every keystroke, or null while there is nothing to read. */
export function cashflowPreview(items: readonly CashflowItem[], params: FinanceParams): CashflowComputed | null {
  const rows = items.filter((item) => item.label.trim() !== "" && Number.isFinite(item.amount));
  if (rows.length === 0) {
    return null;
  }
  try {
    return computeCashflow({ items: rows, params: cashflowParamsOf(params) });
  } catch {
    // A half-typed row is not an error the reader needs shouting about; the panel simply waits.
    return null;
  }
}
