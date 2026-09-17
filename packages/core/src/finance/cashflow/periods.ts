/**
 * Confirmed rows to a running cash book.
 *
 * Two rules decide every number below. A period's **net** is its own cash in less its own cash out —
 * never a figure summed across periods. A period's **closing balance** is the previous balance plus
 * that period's whole movement, financing included: a funding round lifts the bank balance even though
 * it is not revenue, so it counts here and nowhere else.
 */
import { cashflowBreakdownSchema, type CashflowBreakdown, type CashflowItem } from "./types";

/** One period as the confirm step holds it: the two sides, any financing, and the cost behaviour. */
export type CashflowPeriodInput = {
  readonly period: string;
  readonly cashIn: number;
  readonly cashOut: number;
  readonly financingIn: number;
  readonly breakdown: CashflowBreakdown;
};

/** One period once the book has been walked. Every figure carries its own period, always. */
export type CashflowPeriod = CashflowPeriodInput & {
  /** Cash in less cash out. Financing is deliberately outside it: it is not trade. */
  readonly netOperating: number;
  /** What the bank balance actually moved by: the operating net plus financing. */
  readonly netTotal: number;
  readonly openingCash: number;
  readonly closingCash: number;
};

const EMPTY_BREAKDOWN: CashflowBreakdown = Object.freeze({
  variable: 0,
  fixed: 0,
  oneOff: 0,
  roles: Object.freeze({}),
});

function addBreakdown(left: CashflowBreakdown, right: CashflowBreakdown): CashflowBreakdown {
  return {
    variable: left.variable + right.variable,
    fixed: left.fixed + right.fixed,
    oneOff: left.oneOff + right.oneOff,
    roles: {
      rent: (left.roles.rent ?? 0) + (right.roles.rent ?? 0),
      payroll: (left.roles.payroll ?? 0) + (right.roles.payroll ?? 0),
      marketing: (left.roles.marketing ?? 0) + (right.roles.marketing ?? 0),
      utilities: (left.roles.utilities ?? 0) + (right.roles.utilities ?? 0),
    },
  };
}

const OPENING_LABEL = /saldo\s*awal|kas\s*awal|opening\s*(cash|balance)|beginning\s*(cash|balance)/i;
const INFLOW_CATEGORY = new Set(["revenue"]);
const OUTFLOW_CATEGORY = new Set(["cogs", "opex", "liability"]);
const FINANCING_CATEGORY = new Set(["equity", "debt"]);
const INFLOW_LABEL = /cash in|kas masuk|pemasukan|penerimaan|inflow|receipts/i;
const OUTFLOW_LABEL = /cash out|kas keluar|pengeluaran|outflow|payments|spend/i;

/**
 * Which side a confirmed row is on.
 *
 * `kind` is what the parse wrote and the user confirmed, so it wins. Rows typed by hand or carried
 * over from the brief's line-item read have no `kind`, and are read from the category and the label
 * rather than refused — a row the reader can see on screen should still compute.
 */
export function cashflowRowKind(item: CashflowItem): CashflowItem["kind"] {
  if (item.kind) {
    return item.kind;
  }
  if (OPENING_LABEL.test(item.label)) {
    return "opening";
  }
  if (FINANCING_CATEGORY.has(item.category)) {
    return "financing";
  }
  if (OUTFLOW_LABEL.test(item.label) || OUTFLOW_CATEGORY.has(item.category)) {
    return "outflow";
  }
  if (INFLOW_LABEL.test(item.label) || INFLOW_CATEGORY.has(item.category)) {
    return "inflow";
  }
  // A signed row with nothing else to go on: the sign is the only honest evidence of direction.
  return item.amount < 0 ? "outflow" : "inflow";
}

/** The opening balance the rows carry, when one of them is the book's own "Saldo awal" line. */
export function openingCashFromItems(items: readonly CashflowItem[]): number | null {
  const row = items.find((item) => cashflowRowKind(item) === "opening");
  return row ? row.amount : null;
}

/** The classification list the parse attached, wherever on the rows it rode along. */
export function classificationFromItems(items: readonly CashflowItem[]) {
  return items.find((item) => item.classification && item.classification.length > 0)?.classification ?? [];
}

/**
 * Confirmed rows grouped into periods, in the order the periods first appear.
 *
 * Amounts are read as magnitudes on the side the row is on: a cash book writes its outflows as
 * positive numbers under "KAS KELUAR" and a bank export writes them negative, and both mean the same
 * money left. Opening rows are not a flow and never enter a side.
 */
export function periodInputsFromItems(items: readonly CashflowItem[]): CashflowPeriodInput[] {
  const order: string[] = [];
  const byPeriod = new Map<string, CashflowPeriodInput>();
  for (const item of items) {
    const kind = cashflowRowKind(item);
    if (kind === "opening") {
      continue;
    }
    const period = item.period.trim();
    const current = byPeriod.get(period);
    if (!current) {
      order.push(period);
    }
    const base = current ?? { period, cashIn: 0, cashOut: 0, financingIn: 0, breakdown: EMPTY_BREAKDOWN };
    const magnitude = Math.abs(item.amount);
    const breakdown = item.breakdown ? cashflowBreakdownSchema.parse(item.breakdown) : EMPTY_BREAKDOWN;
    byPeriod.set(period, {
      ...base,
      cashIn: base.cashIn + (kind === "inflow" ? magnitude : 0),
      cashOut: base.cashOut + (kind === "outflow" ? magnitude : 0),
      financingIn: base.financingIn + (kind === "financing" ? item.amount : 0),
      breakdown: addBreakdown(base.breakdown, breakdown),
    });
  }
  return order.map((period) => byPeriod.get(period) as CashflowPeriodInput);
}

/** The running cash book: net per period, then the balance each period opens and closes on. */
export function walkPeriods(inputs: readonly CashflowPeriodInput[], openingCash: number): CashflowPeriod[] {
  const walked: CashflowPeriod[] = [];
  for (const input of inputs) {
    const opening = walked.at(-1)?.closingCash ?? openingCash;
    const netOperating = input.cashIn - input.cashOut;
    const netTotal = netOperating + input.financingIn;
    walked.push({ ...input, netOperating, netTotal, openingCash: opening, closingCash: opening + netTotal });
  }
  return walked;
}

/** Σ of one column over every period. Used only where the metric itself is a total. */
export function totalOver(periods: readonly CashflowPeriod[], read: (period: CashflowPeriod) => number): number {
  return periods.reduce((sum, period) => sum + read(period), 0);
}
