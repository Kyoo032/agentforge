/**
 * What one row of a cash book is: which side, how its cost behaves, and which named slice it belongs
 * to — decided by rules, in code, with a confidence the reader is shown.
 *
 * This is deliberately not a model call. Every rule here is a keyword a bookkeeper would recognise in
 * either language, and where no rule fires the answer is "fixed, and please check" rather than a
 * guess dressed up as a fact. The studio shows every classification below
 * `CASHFLOW_CONFIRM_BELOW` for confirmation before a single number is computed, so a wrong rule costs
 * the reader one click and never a wrong report.
 */
import { isFinancingCategory } from "./ledger";
import type { CashflowCategory, CashflowRole, CashflowRowKind, CostBehaviour } from "./types";

/** A rule fired on the label itself. */
const STRONG = 1;
/** Nothing matched: the row defaulted, and the reader is asked. */
const DEFAULTED = 0.6;
/** The side came from the sheet's own section heading or from the sign, not from the words. */
const FROM_CONTEXT = 0.9;

const INFLOW_SECTION = /kas masuk|pemasukan|penerimaan|cash in|inflow|receipts|income|pendapatan|revenue/i;
const OUTFLOW_SECTION = /kas keluar|pengeluaran|cash out|outflow|payments|expense|beban|biaya/i;

const INFLOW_LABEL =
  /penjualan|pendapatan|omzet|revenue|sales|income|bunga|interest|hibah|grant|refund|pengembalian|subscription|invoice/i;

/** A single event. It is real money and it is not a monthly cost, so it never enters a per-period base. */
const ONE_OFF =
  /overhaul|renovasi|renovation|capex|one[-\s]?off|sekali|instalasi|installation|pembelian mesin|pembelian aset|equipment|peralatan|furniture|perabot|deposit|setup fee/i;

/** Cost that rides along with sales: goods, the things they are wrapped in, and per-sale fees. */
const VARIABLE =
  /bahan baku|raw material|persediaan|inventory|kemasan|packaging|perlengkapan|supplies|consumable|hpp|cogs|harga pokok|komisi|commission|merchant fee|payment fee|ongkir|shipping|freight|pengiriman/i;

const ROLE_RULES: ReadonlyArray<readonly [CashflowRole, RegExp]> = Object.freeze([
  ["rent", /sewa|rent\b|rental|lease|kontrak tempat/i],
  ["payroll", /gaji|upah|payroll|salar(y|ies)|tunjangan|\bthr\b|wages|bpjs|honor|contractor|kontraktor|freelance/i],
  ["marketing", /pemasaran|promosi|marketing|advertis|iklan|\bads\b|campaign/i],
  ["utilities", /listrik|\bair\b|utilit|electric|water|internet|telepon|phone|langganan|subscription fee/i],
]);

export type CashflowClassifyHint = {
  /** The sheet's own section heading above this row, when it had one. */
  readonly section?: string;
  /** The amount as written. A signed ledger says the direction in the sign and nowhere else. */
  readonly amount?: number;
  /**
   * The side the row already carries — from a confirmed `kind`, or from a line-item category. It
   * beats the section and the sign, because something upstream already decided this one.
   */
  readonly kind?: CashflowRowKind;
};

function roleOf(label: string): CashflowRole | undefined {
  return ROLE_RULES.find(([, pattern]) => pattern.test(label))?.[0];
}

function behaviourOf(label: string): { behaviour: CostBehaviour; confident: boolean } {
  if (ONE_OFF.test(label)) {
    return { behaviour: "oneOff", confident: true };
  }
  if (VARIABLE.test(label)) {
    return { behaviour: "variable", confident: true };
  }
  // Rent, payroll, marketing and the utilities are the fixed base every cash book has.
  return { behaviour: "fixed", confident: roleOf(label) !== undefined };
}

function kindOf(label: string, hint: CashflowClassifyHint): { kind: CashflowRowKind; confidence: number } {
  if (isFinancingCategory(label)) {
    return { kind: "financing", confidence: STRONG };
  }
  if (hint.kind !== undefined) {
    return { kind: hint.kind, confidence: FROM_CONTEXT };
  }
  const section = hint.section ?? "";
  if (OUTFLOW_SECTION.test(section)) {
    return { kind: "outflow", confidence: FROM_CONTEXT };
  }
  if (INFLOW_SECTION.test(section)) {
    return { kind: "inflow", confidence: FROM_CONTEXT };
  }
  if (hint.amount !== undefined && hint.amount !== 0) {
    return { kind: hint.amount < 0 ? "outflow" : "inflow", confidence: FROM_CONTEXT };
  }
  return INFLOW_LABEL.test(label) ? { kind: "inflow", confidence: STRONG } : { kind: "outflow", confidence: DEFAULTED };
}

/** One row classified, with the confidence the studio decides whether to ask about. */
export function classifyCashflowLabel(label: string, hint: CashflowClassifyHint = {}): CashflowCategory {
  const side = kindOf(label, hint);
  if (side.kind !== "outflow") {
    return { label, kind: side.kind, confidence: side.confidence };
  }
  const cost = behaviourOf(label);
  const role = roleOf(label);
  return {
    label,
    kind: "outflow",
    behaviour: cost.behaviour,
    ...(role ? { role } : {}),
    confidence: Math.min(side.confidence, cost.confident ? STRONG : DEFAULTED),
  };
}

/** The rows whose classification the reader should look at before anything is computed. */
export function lowConfidenceCategories(
  categories: readonly CashflowCategory[],
  below: number,
): readonly CashflowCategory[] {
  return categories.filter((category) => category.confidence < below);
}
