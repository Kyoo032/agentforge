/**
 * Breakeven revenue from cost behaviour.
 *
 * The contribution margin ratio is `1 - variable cost / revenue`, and breakeven revenue is the fixed
 * cost divided by it. Two things decide whether that number is worth printing:
 *
 * - **One-off costs are not a base.** A machine overhaul is real money and belongs in the cash book,
 *   but putting it in the fixed base says the shop must sell that much *every* month to stand still.
 * - **Nothing is variable until someone says so.** With no variable rows the ratio collapses to 1 and
 *   breakeven becomes "cover your costs" — true, and not what the phrase means. That is reported as
 *   unavailable rather than as a figure.
 */
import { breakevenRevenue } from "../engine";
import type { CashflowPeriod } from "./periods";

export type CashflowBreakeven = {
  /** Cash in over every period: the revenue the margin ratio is measured against. */
  readonly revenueBase: number;
  readonly variableBase: number;
  readonly fixedBase: number;
  /** One-off cash out, held out of the fixed base and reported on its own. */
  readonly oneOffBase: number;
  readonly periodCount: number;
  /** `(1 - variable / revenue) * 100`. Null when there is no revenue or nothing is variable. */
  readonly contributionMarginPct: number | null;
  /** Fixed cost per period / the margin ratio. */
  readonly revenuePerPeriod: number | null;
  /** Fixed cost over every period / the margin ratio. */
  readonly revenueTotal: number | null;
};

const PERCENT = 100;

/** The cost-behaviour bases, summed over every period. */
function bases(periods: readonly CashflowPeriod[]) {
  return periods.reduce(
    (sum, period) => ({
      revenue: sum.revenue + period.cashIn,
      variable: sum.variable + period.breakdown.variable,
      fixed: sum.fixed + period.breakdown.fixed,
      oneOff: sum.oneOff + period.breakdown.oneOff,
    }),
    { revenue: 0, variable: 0, fixed: 0, oneOff: 0 },
  );
}

/** Breakeven over the whole book, and the margin it used. */
export function cashflowBreakeven(periods: readonly CashflowPeriod[]): CashflowBreakeven {
  const total = bases(periods);
  const count = periods.length;
  const usable = total.revenue > 0 && total.variable > 0;
  const contributionMarginPct = usable ? (1 - total.variable / total.revenue) * PERCENT : null;
  const revenueTotal = contributionMarginPct === null ? null : breakevenRevenue(total.fixed, contributionMarginPct);
  return {
    revenueBase: total.revenue,
    variableBase: total.variable,
    fixedBase: total.fixed,
    oneOffBase: total.oneOff,
    periodCount: count,
    contributionMarginPct,
    revenuePerPeriod:
      contributionMarginPct === null || count === 0
        ? null
        : breakevenRevenue(total.fixed / count, contributionMarginPct),
    revenueTotal,
  };
}
