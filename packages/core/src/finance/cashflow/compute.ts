/**
 * The confirmed input, and the one place a cash-flow number is made.
 *
 * `computeCashflow` is pure: rows and parameters in, every figure the report and the narration will
 * ever quote out. It reaches no gateway, no file and no clock, so the same book always gives the same
 * answer and the arithmetic can be argued with line by line.
 */
import { z } from "zod";
import { burnBases, negativePeriods, CASHFLOW_RECENT_PERIODS, type CashflowBurn } from "./burn";
import { cashflowBreakeven, type CashflowBreakeven } from "./breakeven";
import { lowConfidenceCategories } from "./classify";
import {
  classificationFromItems,
  openingCashFromItems,
  periodInputsFromItems,
  totalOver,
  walkPeriods,
  type CashflowPeriod,
} from "./periods";
import { runScenario, type CashflowScenarioOutcome } from "./scenario";
import {
  CASHFLOW_CONFIRM_BELOW,
  cashflowItemSchema,
  cashflowScenarioSchema,
  type CashflowCategory,
  type CashflowItem,
  type CashflowScenario,
} from "./types";

/**
 * The knobs beside the rows. `scenario` is the full typed form the what-if panel writes; the named
 * levers under it are the three moves a cash-flow reader actually asks for — sell more, pay less rent,
 * hire people — and are folded into the same typed adjustments before any arithmetic happens.
 */
export const cashflowParamsSchema = z.object({
  openingCash: z.number().finite().optional(),
  currency: z.string().max(16).optional(),
  /** How many periods "recent" means for the burn window and the scenario baseline. */
  recentPeriods: z.number().int().min(1).max(36).optional(),
  scenario: cashflowScenarioSchema.optional(),
  salesLiftPct: z.number().finite().optional(),
  rentCutPct: z.number().finite().optional(),
  newHires: z.number().finite().optional(),
  newEngineers: z.number().finite().optional(),
  costPerHire: z.number().finite().optional(),
  costPerEngineer: z.number().finite().optional(),
  recurringCostPerPeriod: z.number().finite().optional(),
  oneOffCost: z.number().finite().optional(),
});

export type CashflowParams = z.infer<typeof cashflowParamsSchema>;

export const cashflowInputSchema = z.object({
  items: z.array(cashflowItemSchema).min(1),
  params: cashflowParamsSchema.default({}),
});

export type CashflowInput = z.infer<typeof cashflowInputSchema>;

export type CashflowTotals = {
  readonly cashIn: number;
  readonly cashOut: number;
  readonly financingIn: number;
  readonly netOperating: number;
  readonly netTotal: number;
};

export type CashflowComputed = {
  /** The rows the reader confirmed, kept so the workbook's Inputs sheet is exactly what was agreed. */
  readonly rows: readonly CashflowItem[];
  readonly currency: string;
  readonly openingCash: number;
  readonly periods: readonly CashflowPeriod[];
  readonly closingCash: number;
  readonly totals: CashflowTotals;
  /** Only the periods a funding line actually moved, so financing is never read as revenue. */
  readonly financing: readonly { readonly period: string; readonly amount: number }[];
  readonly negativePeriods: readonly CashflowPeriod[];
  readonly burns: readonly CashflowBurn[];
  /** The recent window: the shape the business is in now, and the runway the report headlines. */
  readonly primaryBurn: CashflowBurn;
  readonly monthsToZeroCash: number | null;
  readonly lastPeriod: string;
  readonly breakeven: CashflowBreakeven;
  readonly scenario: CashflowScenario;
  readonly outcomes: readonly CashflowScenarioOutcome[];
  readonly classification: readonly CashflowCategory[];
  readonly unconfirmed: readonly CashflowCategory[];
};

const EMPTY_BURN: CashflowBurn = Object.freeze({
  id: "last3",
  periods: Object.freeze([]),
  grossBurn: null,
  netBurn: null,
  runwayMonths: null,
});

/** The hires lever, whichever of its two spellings the caller used. */
function hiringCost(params: CashflowParams): number {
  const heads = params.newHires ?? params.newEngineers ?? 0;
  const cost = params.costPerHire ?? params.costPerEngineer ?? 0;
  return heads * cost;
}

/**
 * The typed adjustments this run will apply.
 *
 * A scenario the studio built wins outright — it is what the reader saw and approved. Otherwise the
 * named levers are folded into the same shapes, so there is exactly one scenario engine and the quick
 * knobs cannot drift away from the panel.
 */
export function scenarioFromParams(params: CashflowParams): CashflowScenario {
  if (params.scenario && params.scenario.adjustments.length > 0) {
    return params.scenario;
  }
  const hires = hiringCost(params);
  return cashflowScenarioSchema.parse({
    label: params.scenario?.label ?? "",
    adjustments: [
      ...(params.salesLiftPct !== undefined
        ? [{ kind: "percent" as const, target: "inflow" as const, changePct: params.salesLiftPct, scalesVariable: true }]
        : []),
      ...(params.rentCutPct !== undefined
        ? [{ kind: "percent" as const, target: "rent" as const, changePct: -Math.abs(params.rentCutPct) }]
        : []),
      ...(hires !== 0 ? [{ kind: "recurring" as const, amountPerPeriod: hires }] : []),
      ...(params.recurringCostPerPeriod !== undefined
        ? [{ kind: "recurring" as const, amountPerPeriod: params.recurringCostPerPeriod }]
        : []),
      ...(params.oneOffCost !== undefined ? [{ kind: "oneOff" as const, amount: params.oneOffCost }] : []),
    ],
  });
}

/** The currency the rows carry, or the one the studio was told. Never guessed from the language. */
function currencyOf(input: CashflowInput): string {
  return input.items.find((item) => item.currency.trim() !== "")?.currency.trim() ?? input.params.currency ?? "";
}

/** The balance the book opens on: the parameter the reader typed, else the sheet's own opening row. */
function openingCashOf(input: CashflowInput): number {
  return input.params.openingCash ?? openingCashFromItems(input.items) ?? 0;
}

export function computeCashflow(input: CashflowInput): CashflowComputed {
  const recent = input.params.recentPeriods ?? CASHFLOW_RECENT_PERIODS;
  const openingCash = openingCashOf(input);
  const periods = walkPeriods(periodInputsFromItems(input.items), openingCash);
  const closingCash = periods.at(-1)?.closingCash ?? openingCash;
  const burns = burnBases(periods, closingCash, recent);
  const primaryBurn = burns.find((burn) => burn.id === "last3") ?? EMPTY_BURN;
  const scenario = scenarioFromParams(input.params);
  const classification = classificationFromItems(input.items);
  return {
    rows: input.items,
    currency: currencyOf(input),
    openingCash,
    periods,
    closingCash,
    totals: {
      cashIn: totalOver(periods, (period) => period.cashIn),
      cashOut: totalOver(periods, (period) => period.cashOut),
      financingIn: totalOver(periods, (period) => period.financingIn),
      netOperating: totalOver(periods, (period) => period.netOperating),
      netTotal: totalOver(periods, (period) => period.netTotal),
    },
    financing: periods
      .filter((period) => period.financingIn !== 0)
      .map((period) => ({ period: period.period, amount: period.financingIn })),
    negativePeriods: negativePeriods(periods),
    burns,
    primaryBurn,
    monthsToZeroCash: primaryBurn.runwayMonths,
    lastPeriod: periods.at(-1)?.period ?? "",
    breakeven: cashflowBreakeven(periods),
    scenario,
    outcomes: scenario.adjustments.length === 0 ? [] : runScenario(periods, scenario, closingCash, recent),
    classification,
    unconfirmed: lowConfidenceCategories(classification, CASHFLOW_CONFIRM_BELOW),
  };
}
