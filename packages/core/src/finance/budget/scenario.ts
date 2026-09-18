/**
 * Which set a confirmed row belongs to, and which period it is really about.
 *
 * A budget-versus-actual upload carries that fact in the only place a spreadsheet has room for it:
 * the period. One workbook writes it as two sheets ("Anggaran 2024" / "Realisasi 2024"), another as
 * side-by-side columns ("Q1 Budget" / "Q1 Actual"). Both say the same two things — which side, and
 * which period — so both are read here, and the period that is left after the scenario word is
 * removed is what the two sides are lined up on.
 *
 * A period that says neither is left as `null` rather than guessed: an unplaced row is shown to the
 * owner as unplaced, which is a question they can answer, instead of landing in the wrong column.
 */
import { isDerivedLabel } from "../import-table";
import type { LineItemCategory } from "../types";

export type BudgetScenario = "budget" | "actual";
/** Revenue lines and cost lines read their variance in opposite directions, so the kind is carried. */
export type BudgetKind = "revenue" | "cost";

const BUDGET_WORDS = /\b(budget|budgets|budgeted|plan|planned|anggaran|rencana|rab|pagu)\b/i;
const ACTUAL_WORDS =
  /\b(actual|actuals|aktual|realisasi|realisation|realization|realized|realised|terealisasi|terpakai)\b/i;

/** Names that only ever open a derived row, on top of the importer's own list. */
const BUDGET_DERIVED_WORDS =
  /\b(selisih|varian|variance|variances|difference|saldo|balance|surplus|defisit|deficit|laba|rugi|margin)\b/i;

/** Words that make an untyped row a revenue row; everything else in a budget sheet is spending. */
const REVENUE_WORDS =
  /\b(pendapatan|penerimaan|penghasilan|donasi|hibah|sumbangan|omzet|omset|revenue|income|sales|turnover|grant|donation)\b/i;

/** The section and subtotal tags the spreadsheet importer writes in front of a label. */
const IMPORT_TAG = /\[[^\]]*\]\s*/g;

export type ScenarioHints = {
  /** A period the owner (or the case) named as the budget side outright. */
  readonly budgetPeriod?: string;
  readonly actualPeriod?: string;
};

export type ReadScenario = { readonly scenario: BudgetScenario; readonly period: string };

function stripWord(period: string, pattern: RegExp): string {
  return period.replace(pattern, " ").replace(/[\s|/,:-]+/g, " ").trim();
}

/**
 * The scenario a period names, and the period left once that word is taken out. `null` when the
 * period says neither, which is a row the owner has to place.
 */
export function readBudgetScenario(period: string, hints: ScenarioHints = {}): ReadScenario | null {
  const text = period.trim();
  if (hints.budgetPeriod && text === hints.budgetPeriod.trim()) {
    return { scenario: "budget", period: stripWord(text, BUDGET_WORDS) };
  }
  if (hints.actualPeriod && text === hints.actualPeriod.trim()) {
    return { scenario: "actual", period: stripWord(text, ACTUAL_WORDS) };
  }
  if (ACTUAL_WORDS.test(text)) {
    return { scenario: "actual", period: stripWord(text, ACTUAL_WORDS) };
  }
  if (BUDGET_WORDS.test(text)) {
    return { scenario: "budget", period: stripWord(text, BUDGET_WORDS) };
  }
  return null;
}

/** The label without the importer's `[subtotal]` and `[Section]` tags, which are facts, not names. */
export function budgetLabelText(label: string): string {
  return label.replace(IMPORT_TAG, "").trim();
}

/** True when this row is a total, a subtotal or a named result rather than a line of its own. */
export function isBudgetDerivedLabel(label: string): boolean {
  const text = budgetLabelText(label);
  return label.includes("[subtotal]") || isDerivedLabel(text) || BUDGET_DERIVED_WORDS.test(text);
}

/** Revenue or cost. The confirmed category decides it; an unclassified row is read off its label. */
export function budgetKindOf(category: LineItemCategory, label: string): BudgetKind {
  if (category === "revenue") {
    return "revenue";
  }
  if (category === "cogs" || category === "opex") {
    return "cost";
  }
  return REVENUE_WORDS.test(budgetLabelText(label)) ? "revenue" : "cost";
}
