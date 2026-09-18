/**
 * Whether this plan has ONE internal rate of return, before any IRR is quoted.
 *
 * Descartes' rule allows as many real roots as the flows have sign changes, and a plan with a
 * negative year mid-life has three. A bisection over one wide bracket — which is what
 * `engine.ts#irr` runs — answers with whichever root it happens to land on, and answers it just as
 * confidently when there are three. So the scan comes first: NPV(r) is sampled across a wide range
 * and its zero crossings are counted. One crossing means the IRR is a fact; more than one means the
 * IRR is not a number this plan has, and MIRR — which has exactly one answer by construction — is
 * what the report gives instead, with both of its rates stated.
 */
import { irr, npv } from "../engine";

/** The range NPV(r) is scanned over, as fractions. Below −98% the discount factors overflow. */
export const IRR_SCAN_MIN = -0.98;
export const IRR_SCAN_MAX = 6;
/** Samples across that range. Fine enough that two roots this side of 600% cannot hide in one step. */
export const IRR_SCAN_STEPS = 1600;

export type ZeroCrossing = { readonly low: number; readonly high: number };

export type IrrScan = {
  /** Sign changes in the flows themselves: the upper bound on how many roots there can be. */
  readonly signChanges: number;
  /** Zero crossings of NPV(r) actually found in the scanned range. */
  readonly crossings: number;
  /** The brackets each crossing was found in, low to high. */
  readonly brackets: readonly ZeroCrossing[];
  /** True only when exactly one crossing was found — the one case an IRR may be reported. */
  readonly unique: boolean;
  /** The IRR as a percentage, or null when it is not unique or not bracketed at all. */
  readonly irrPercent: number | null;
};

/** Sign changes in the flows, zeros skipped. The most roots NPV(r) can have. */
export function signChanges(flows: readonly number[]): number {
  let changes = 0;
  let last = 0;
  for (const flow of flows) {
    if (flow === 0) {
      continue;
    }
    const sign = flow > 0 ? 1 : -1;
    if (last !== 0 && sign !== last) {
      changes += 1;
    }
    last = sign;
  }
  return changes;
}

/** Brackets in which NPV(r) changes sign, sampled across the scan range. */
export function npvZeroCrossings(
  flows: readonly number[],
  range: { readonly min?: number; readonly max?: number; readonly steps?: number } = {},
): ZeroCrossing[] {
  const min = range.min ?? IRR_SCAN_MIN;
  const max = range.max ?? IRR_SCAN_MAX;
  const steps = range.steps ?? IRR_SCAN_STEPS;
  if (flows.length < 2 || steps < 1 || max <= min) {
    return [];
  }
  const found: ZeroCrossing[] = [];
  let previousRate = min;
  let previous = npv(min, flows);
  for (let step = 1; step <= steps; step += 1) {
    const rate = min + ((max - min) * step) / steps;
    const value = npv(rate, flows);
    if (previous !== null && value !== null && previous !== 0 && previous * value < 0) {
      found.push({ low: previousRate, high: rate });
    }
    previousRate = rate;
    previous = value;
  }
  return found;
}

/** Bisection on NPV(r) inside one bracket, to a rate tolerance of 1e-12. */
export function rateAtZero(flows: readonly number[], bracket: ZeroCrossing): number | null {
  let low = bracket.low;
  let high = bracket.high;
  let npvLow = npv(low, flows);
  if (npvLow === null || npv(high, flows) === null) {
    return null;
  }
  for (let iteration = 0; iteration < 200 && high - low > 1e-12; iteration += 1) {
    const mid = (low + high) / 2;
    const npvMid = npv(mid, flows);
    if (npvMid === null) {
      return null;
    }
    if (npvLow * npvMid <= 0) {
      high = mid;
    } else {
      low = mid;
      npvLow = npvMid;
    }
  }
  return (low + high) / 2;
}

/**
 * The uniqueness scan and, only when it passes, the IRR itself.
 *
 * The rate is taken from `engine.ts#irr` — the same bisection the rest of Finance runs — so the
 * number in this report is the number the engine gives; the scan decides whether it may be quoted.
 */
export function scanIrr(flows: readonly number[]): IrrScan {
  const brackets = npvZeroCrossings(flows);
  const unique = brackets.length === 1;
  const engineRate = unique ? irr(flows) : null;
  const first = brackets[0];
  const rate = engineRate ?? (unique && first ? rateAtZero(flows, first) : null);
  return {
    signChanges: signChanges(flows),
    crossings: brackets.length,
    brackets,
    unique,
    irrPercent: rate === null ? null : rate * 100,
  };
}

/**
 * The lowest discount rate at which this plan's NPV turns negative, as a percentage.
 *
 * With one IRR this is the IRR. With several it is still a fact a reader can use — the first rate
 * the plan stops clearing — which the IRR, in that case, is not.
 */
export function breakevenRatePercent(flows: readonly number[]): number | null {
  for (const bracket of npvZeroCrossings(flows)) {
    const low = npv(bracket.low, flows);
    const high = npv(bracket.high, flows);
    if (low !== null && high !== null && low > 0 && high < 0) {
      const rate = rateAtZero(flows, bracket);
      return rate === null ? null : rate * 100;
    }
  }
  return null;
}

/**
 * Modified IRR: the negative flows brought back at the finance rate, the positive ones carried
 * forward at the reinvestment rate, and the one growth rate between them. It exists whatever the
 * signs do, which is why it is what a plan with several IRRs is reported on.
 */
export function mirrPercent(
  flows: readonly number[],
  financeRatePercent: number,
  reinvestRatePercent: number,
): number | null {
  const periods = flows.length - 1;
  if (periods < 1 || financeRatePercent <= -100 || reinvestRatePercent <= -100) {
    return null;
  }
  const finance = financeRatePercent / 100;
  const reinvest = reinvestRatePercent / 100;
  let outflowPv = 0;
  let inflowFv = 0;
  flows.forEach((flow, index) => {
    if (flow < 0) {
      outflowPv += flow / (1 + finance) ** index;
    } else {
      inflowFv += flow * (1 + reinvest) ** (periods - index);
    }
  });
  if (outflowPv >= 0 || inflowFv <= 0) {
    return null;
  }
  return ((inflowFv / -outflowPv) ** (1 / periods) - 1) * 100;
}
