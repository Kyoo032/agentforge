/**
 * The what-if, recomputed in code.
 *
 * A scenario is a list of typed adjustments, never a sentence. The studio may let a model turn
 * "cut rent 15% and raise sales 10%" into those adjustments, but the model's answer is shown to the
 * reader as adjustments *before* anything is computed, and the arithmetic below is the only place a
 * new figure is made. So a what-if is a recomputation the reader can audit, not a forecast.
 *
 * Two baselines, both reported. "Next month looks like last month" and "next month looks like the
 * last three averaged" are different claims, they give different runways, and which one is right
 * depends on the book — so the report carries both rather than picking.
 *
 * The trap this file exists for: **variable cost rides along with sales.** Lifting revenue 10% without
 * lifting the goods that revenue is made of overstates the improvement, every time.
 */
import { runwayMonths } from "../engine";
import { CASHFLOW_RECENT_PERIODS } from "./burn";
import type { CashflowPeriod } from "./periods";
import type { CashflowAdjustment, CashflowRole, CashflowScenario, CashflowTarget } from "./types";

export const CASHFLOW_SCENARIO_BASES = ["lastPeriod", "recentAverage"] as const;
export type CashflowScenarioBasisId = (typeof CASHFLOW_SCENARIO_BASES)[number];

export type CashflowScenarioBaseline = {
  readonly id: CashflowScenarioBasisId;
  readonly periods: readonly string[];
  readonly cashIn: number;
  readonly cashOut: number;
  readonly variable: number;
  readonly fixed: number;
  readonly oneOff: number;
  readonly roles: Readonly<Partial<Record<CashflowRole, number>>>;
  readonly netOperating: number;
};

export type CashflowScenarioOutcome = {
  readonly basis: CashflowScenarioBasisId;
  readonly periods: readonly string[];
  readonly baseline: CashflowScenarioBaseline;
  /** What the adjustments added to each side, per period. */
  readonly deltaCashIn: number;
  readonly deltaCashOut: number;
  /** A single event does not change a per-period net; it is taken off the balance instead. */
  readonly oneOffTotal: number;
  readonly cashIn: number;
  readonly cashOut: number;
  readonly netOperating: number;
  readonly grossBurn: number;
  readonly netBurn: number;
  readonly cashAfterOneOff: number;
  readonly runwayMonths: number | null;
};

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function baselineFrom(id: CashflowScenarioBasisId, window: readonly CashflowPeriod[]): CashflowScenarioBaseline {
  const role = (name: CashflowRole) => mean(window.map((period) => period.breakdown.roles[name] ?? 0));
  const cashIn = mean(window.map((period) => period.cashIn));
  const cashOut = mean(window.map((period) => period.cashOut));
  return {
    id,
    periods: window.map((period) => period.period),
    cashIn,
    cashOut,
    variable: mean(window.map((period) => period.breakdown.variable)),
    fixed: mean(window.map((period) => period.breakdown.fixed)),
    oneOff: mean(window.map((period) => period.breakdown.oneOff)),
    roles: { rent: role("rent"), payroll: role("payroll"), marketing: role("marketing"), utilities: role("utilities") },
    netOperating: cashIn - cashOut,
  };
}

/** The two baselines a what-if may be read from: the last period, and the recent periods averaged. */
export function scenarioBaselines(
  periods: readonly CashflowPeriod[],
  recent: number = CASHFLOW_RECENT_PERIODS,
): CashflowScenarioBaseline[] {
  if (periods.length === 0) {
    return [];
  }
  const last = periods.slice(-1);
  const window = periods.slice(Math.max(0, periods.length - Math.max(1, recent)));
  return [baselineFrom("lastPeriod", last), baselineFrom("recentAverage", window)];
}

/** The slice of a baseline one adjustment points at. */
function sliceOf(baseline: CashflowScenarioBaseline, target: CashflowTarget): number {
  if (target === "inflow") {
    return baseline.cashIn;
  }
  if (target === "outflow") {
    return baseline.cashOut;
  }
  if (target === "variable" || target === "fixed" || target === "oneOff") {
    return baseline[target];
  }
  return baseline.roles[target as CashflowRole] ?? 0;
}

type Deltas = { cashIn: number; cashOut: number; oneOff: number };

const NO_DELTAS: Deltas = { cashIn: 0, cashOut: 0, oneOff: 0 };

/**
 * One adjustment as a pair of deltas. Every branch is a multiplication or an addition over a slice
 * that was already computed: nothing here reads a label or a free-text amount.
 */
function deltasFor(baseline: CashflowScenarioBaseline, adjustment: CashflowAdjustment): Deltas {
  if (adjustment.kind === "recurring") {
    return { ...NO_DELTAS, cashOut: adjustment.amountPerPeriod };
  }
  if (adjustment.kind === "oneOff") {
    return { ...NO_DELTAS, oneOff: adjustment.amount };
  }
  const inflow = adjustment.target === "inflow";
  if (adjustment.kind === "absolute") {
    return inflow ? { ...NO_DELTAS, cashIn: adjustment.amount } : { ...NO_DELTAS, cashOut: adjustment.amount };
  }
  const change = sliceOf(baseline, adjustment.target) * (adjustment.changePct / 100);
  // Sales that rise carry their own goods with them; a report that forgets this overstates the gain.
  const ridesAlong = inflow && adjustment.scalesVariable ? baseline.variable * (adjustment.changePct / 100) : 0;
  return inflow ? { ...NO_DELTAS, cashIn: change, cashOut: ridesAlong } : { ...NO_DELTAS, cashOut: change };
}

/** One baseline plus every adjustment, as a new per-period net, a new burn and a new runway. */
export function runScenarioOn(
  baseline: CashflowScenarioBaseline,
  scenario: CashflowScenario,
  closingCash: number,
): CashflowScenarioOutcome {
  const deltas = scenario.adjustments.reduce<Deltas>((sum, adjustment) => {
    const next = deltasFor(baseline, adjustment);
    return { cashIn: sum.cashIn + next.cashIn, cashOut: sum.cashOut + next.cashOut, oneOff: sum.oneOff + next.oneOff };
  }, NO_DELTAS);
  const cashIn = baseline.cashIn + deltas.cashIn;
  const cashOut = baseline.cashOut + deltas.cashOut;
  const netOperating = cashIn - cashOut;
  const cashAfterOneOff = closingCash - deltas.oneOff;
  return {
    basis: baseline.id,
    periods: baseline.periods,
    baseline,
    deltaCashIn: deltas.cashIn,
    deltaCashOut: deltas.cashOut,
    oneOffTotal: deltas.oneOff,
    cashIn,
    cashOut,
    netOperating,
    grossBurn: cashOut,
    netBurn: -netOperating,
    cashAfterOneOff,
    runwayMonths: runwayMonths(cashAfterOneOff, -netOperating),
  };
}

/** Every baseline run through the same scenario, so the reader sees the range rather than one number. */
export function runScenario(
  periods: readonly CashflowPeriod[],
  scenario: CashflowScenario,
  closingCash: number,
  recent: number = CASHFLOW_RECENT_PERIODS,
): CashflowScenarioOutcome[] {
  return scenarioBaselines(periods, recent).map((baseline) => runScenarioOn(baseline, scenario, closingCash));
}
