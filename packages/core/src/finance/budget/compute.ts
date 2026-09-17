/**
 * The confirmed input of the budget task, and the one call that turns it into every number.
 *
 * What arrives is what the owner confirmed on screen: the rows, the two limits, and — when they
 * edited the pairing — the pairs themselves. When no pairing is sent the same local matcher the
 * studio proposed with runs again here, so the figures behind the report are reproducible from the
 * rows alone and never depend on a network call having happened.
 */
import { z } from "zod";
import type { ReportLocale } from "../report";
import { lineItemsSchema, type LineItem } from "../types";
import { applyConfirmedPairs, proposeBudgetPairs, type BudgetPairProposal } from "./match";
import { readBudgetSides, type BudgetExcludedRow, type BudgetSideLine } from "./rows";
import {
  budgetAggregates,
  budgetFlagCounts,
  budgetVarianceLines,
  type BudgetAggregate,
  type BudgetThresholds,
  type BudgetVarianceLine,
} from "./variance";

/** Currency shown when neither the rows nor the request name one. */
const FALLBACK_CURRENCY: Readonly<Record<ReportLocale, string>> = Object.freeze({ id: "IDR", en: "USD" });

const pairSchema = z.object({
  budgetLabel: z.string().nullable().default(null),
  actualLabel: z.string().nullable().default(null),
});

/**
 * The knobs this task takes. Unknown keys are ignored rather than refused: the studio sends the
 * brief's own parameter bag, and a case sends whatever its generator recorded.
 */
export const budgetParamsSchema = z
  .object({
    /** Percent limit, as a percent number. */
    flagPct: z.number().finite().nonnegative().optional(),
    /** Amount limit, in the rows' own currency. */
    flagAbs: z.number().finite().nonnegative().optional(),
    /** Both limits (the default) or either one. */
    flagMode: z.enum(["and", "or"]).optional(),
    /** A period the owner named as the budget side outright, when the words do not say. */
    budgetSheet: z.string().optional(),
    actualSheet: z.string().optional(),
    currency: z.string().optional(),
    /** The pairing the owner confirmed. Absent means "use the local matcher's proposal". */
    pairs: z.array(pairSchema).optional(),
  })
  .passthrough();

export type BudgetParams = z.infer<typeof budgetParamsSchema>;

/** Confirmed rows plus the limits. Free text never reaches a task module. */
export const budgetInputSchema = z.object({
  items: lineItemsSchema,
  params: budgetParamsSchema.default({}),
});

export type BudgetTaskInput = z.infer<typeof budgetInputSchema>;

export type BudgetComputed = {
  readonly currency: string;
  readonly periods: readonly string[];
  readonly lines: readonly BudgetVarianceLine[];
  readonly aggregates: readonly BudgetAggregate[];
  readonly flagCounts: ReturnType<typeof budgetFlagCounts>;
  readonly thresholds: BudgetThresholds;
  readonly budgetOnly: readonly string[];
  readonly actualOnly: readonly string[];
  readonly excluded: readonly BudgetExcludedRow[];
  readonly items: readonly LineItem[];
};

function thresholdsFrom(params: BudgetParams): BudgetThresholds {
  return {
    pct: params.flagPct ?? 0,
    abs: params.flagAbs ?? 0,
    mode: params.flagMode ?? "and",
  };
}

function currencyFrom(items: readonly LineItem[], params: BudgetParams): string {
  const stated = items.find((item) => item.currency.trim() !== "")?.currency;
  return (stated ?? params.currency ?? "").trim().toUpperCase();
}

function pairingFor(
  budget: readonly BudgetSideLine[],
  actual: readonly BudgetSideLine[],
  params: BudgetParams,
): { pairs: readonly BudgetPairProposal[]; budgetOnly: readonly string[]; actualOnly: readonly string[] } {
  return params.pairs ? applyConfirmedPairs(budget, actual, params.pairs) : proposeBudgetPairs(budget, actual);
}

/** Rows in, every figure the report shows out. No I/O, no model, no clock. */
export function computeBudget(input: BudgetTaskInput): BudgetComputed {
  const params = input.params ?? {};
  const sides = readBudgetSides(input.items, {
    budgetPeriod: params.budgetSheet,
    actualPeriod: params.actualSheet,
  });
  const thresholds = thresholdsFrom(params);
  const pairing = pairingFor(sides.budget, sides.actual, params);
  const periods = sides.periods.length > 0 ? sides.periods : [""];
  const lines = budgetVarianceLines(pairing.pairs, sides.budget, sides.actual, periods, thresholds);
  return {
    currency: currencyFrom(input.items, params),
    periods,
    lines,
    aggregates: budgetAggregates(lines, periods, thresholds),
    flagCounts: budgetFlagCounts(lines, periods),
    thresholds,
    budgetOnly: pairing.budgetOnly,
    actualOnly: pairing.actualOnly,
    excluded: sides.excluded,
    items: input.items,
  };
}

/** The currency the report writes its figures in: the rows', the request's, or the locale's. */
export function budgetCurrency(computed: BudgetComputed, locale: ReportLocale): string {
  return computed.currency || FALLBACK_CURRENCY[locale] || FALLBACK_CURRENCY.en;
}

/** One roll-up by id, or null when this sheet could not honestly carry it. */
export function budgetAggregate(computed: BudgetComputed, id: BudgetAggregate["id"]): BudgetAggregate | null {
  return computed.aggregates.find((entry) => entry.id === id) ?? null;
}

/** Every line that broke the limit over the whole period, in the order the sheet had them. */
export function flaggedBudgetLines(computed: BudgetComputed): readonly BudgetVarianceLine[] {
  return computed.lines.filter((line) => line.total.flagged);
}
