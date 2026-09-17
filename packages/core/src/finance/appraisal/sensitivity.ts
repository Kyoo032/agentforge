/**
 * NPV across a grid of discount rates and cash-flow scales, plus the same NPV at a list of hurdles.
 *
 * The one rule that decides whether a grid is right: the t = 0 outlay never moves. It is a price
 * that was agreed, not a forecast that might be 10% out, and scaling it too makes every cell in the
 * table wrong in the same flattering direction. Everything after t = 0 moves — a negative year
 * included, which at −10% gets 10% less negative and at +10% gets 10% worse.
 */
import { npv } from "../engine";

export type SensitivityAxes = {
  /** Discount rates as percentages: the rows of the grid. */
  readonly ratePercents: readonly number[];
  /** Shifts applied to the flows after t = 0, as percentages: the columns. */
  readonly shiftPercents: readonly number[];
};

export type SensitivityCell = {
  readonly ratePercent: number;
  readonly shiftPercent: number;
  readonly npv: number | null;
  /** True when this combination of rate and flows turns the plan down. */
  readonly negative: boolean;
};

export const DEFAULT_SHIFT_PERCENTS: readonly number[] = Object.freeze([-10, 0, 10]);

/** The rates a grid defaults to when the request names none: the hurdle, and two points either side. */
export function defaultRatePercents(ratePercent: number): number[] {
  return [ratePercent - 2, ratePercent, ratePercent + 2];
}

/** Every flow after t = 0 scaled by the shift. The outlay is returned exactly as it came in. */
export function scaleFlows(flows: readonly number[], shiftPercent: number): number[] {
  const factor = 1 + shiftPercent / 100;
  return flows.map((flow, index) => (index === 0 ? flow : flow * factor));
}

/** NPV of the scaled flows at one rate, with `flows[0]` at t = 0 undiscounted. */
export function sensitivityNpv(flows: readonly number[], ratePercent: number, shiftPercent: number): number | null {
  return npv(ratePercent / 100, scaleFlows(flows, shiftPercent));
}

/** One row per discount rate, one cell per shift, in the order the axes were given. */
export function sensitivityGrid(flows: readonly number[], axes: SensitivityAxes): SensitivityCell[][] {
  return axes.ratePercents.map((ratePercent) =>
    axes.shiftPercents.map((shiftPercent) => {
      const value = sensitivityNpv(flows, ratePercent, shiftPercent);
      return { ratePercent, shiftPercent, npv: value, negative: value !== null && value < 0 };
    }),
  );
}

/** The cells that turn negative, flattened — what a verdict has to be conditional on. */
export function negativeCells(grid: readonly (readonly SensitivityCell[])[]): SensitivityCell[] {
  return grid.flatMap((row) => row.filter((cell) => cell.negative));
}

export type HurdleNpv = { readonly ratePercent: number; readonly npv: number | null; readonly clears: boolean };

/** NPV at each hurdle rate on the base flows: which rates this plan clears, and which it does not. */
export function npvAtRates(flows: readonly number[], ratePercents: readonly number[]): HurdleNpv[] {
  return ratePercents.map((ratePercent) => {
    const value = npv(ratePercent / 100, flows);
    return { ratePercent, npv: value, clears: value !== null && value >= 0 };
  });
}
