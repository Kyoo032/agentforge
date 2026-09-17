/**
 * Burn and runway — all of the legitimate readings, none of them chosen for the reader.
 *
 * "How fast are we burning?" has more than one honest answer, and they disagree by a lot. Averaging
 * the loss-making months says how bad a bad month is; averaging the last three says what the current
 * shape of the business costs; averaging everything says what the year cost. A report that quietly
 * picks one is a report that can be right by accident, so every basis is computed and labelled and the
 * narration is given all of them.
 *
 * Two burns per basis, never merged: **gross** burn is the cash that went out, **net** burn is what
 * went out less what came in. Both are positive numbers, so "burn" always means money leaving.
 */
import { runwayMonths } from "../engine";
import type { CashflowPeriod } from "./periods";

/** The bases every cash-flow report carries, in the order a reader wants to read them. */
export const CASHFLOW_BURN_BASES = ["last3", "negative", "all"] as const;
export type CashflowBurnBasisId = (typeof CASHFLOW_BURN_BASES)[number];

/** How many periods "recent" means. Three months is the window both eval cases and most books use. */
export const CASHFLOW_RECENT_PERIODS = 3;

export type CashflowBurn = {
  readonly id: CashflowBurnBasisId;
  /** The periods this basis averaged over, named so the reader can check the window. */
  readonly periods: readonly string[];
  /** Mean cash out per period. Positive. Null when the basis covers no period. */
  readonly grossBurn: number | null;
  /** Mean (cash out - cash in) per period. Positive means cash is leaving. */
  readonly netBurn: number | null;
  /** Closing cash divided by the net burn. Null when the basis is not burning. */
  readonly runwayMonths: number | null;
};

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The periods one basis averages over. An empty answer is honest: that basis has nothing to say. */
export function burnBasisPeriods(
  periods: readonly CashflowPeriod[],
  id: CashflowBurnBasisId,
  recent: number = CASHFLOW_RECENT_PERIODS,
): CashflowPeriod[] {
  if (id === "all") {
    return [...periods];
  }
  if (id === "negative") {
    return periods.filter((period) => period.netOperating < 0);
  }
  return periods.slice(Math.max(0, periods.length - Math.max(1, recent)));
}

/** One basis, computed. `closingCash` is the balance the runway is measured from. */
export function burnOnBasis(
  periods: readonly CashflowPeriod[],
  id: CashflowBurnBasisId,
  closingCash: number,
  recent: number = CASHFLOW_RECENT_PERIODS,
): CashflowBurn {
  const window = burnBasisPeriods(periods, id, recent);
  const grossBurn = mean(window.map((period) => period.cashOut));
  const netBurn = mean(window.map((period) => -period.netOperating));
  return {
    id,
    periods: window.map((period) => period.period),
    grossBurn,
    netBurn,
    runwayMonths: netBurn === null ? null : runwayMonths(closingCash, netBurn),
  };
}

/** Every basis, in order. The first one is the report's headline: the shape the business is in now. */
export function burnBases(
  periods: readonly CashflowPeriod[],
  closingCash: number,
  recent: number = CASHFLOW_RECENT_PERIODS,
): CashflowBurn[] {
  return CASHFLOW_BURN_BASES.map((id) => burnOnBasis(periods, id, closingCash, recent));
}

/** The periods that ended below zero. Named in the report because a reader wants to know which. */
export function negativePeriods(periods: readonly CashflowPeriod[]): CashflowPeriod[] {
  return periods.filter((period) => period.netOperating < 0);
}
