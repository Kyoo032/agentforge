/**
 * The running totals an appraisal is read from, and the two paybacks taken off them.
 *
 * Every function here puts `flows[0]` at t = 0 undiscounted, which is what `engine.ts#npv` does and
 * what the cases' conventions require: discounting the outlay by one period is the classic error
 * and it moves every figure downstream.
 *
 * Payback is the FIRST year the running total reaches zero, not the last time it crosses and not
 * the first year it merely improves. A plan whose mid-life year is negative goes backwards after it
 * has already recovered, and reading that later crossing instead would flatter it by years.
 */

/** A rate below −100% has no discount factor; the caller gets null rather than a sign flip. */
const MIN_RATE_PERCENT = -100;

export type PaybackPoint = {
  /** Whole years plus the fraction of the crossing year, from t = 0. Null when it never crosses. */
  readonly years: number | null;
  /** The index of the first year whose running total is at or above zero. Null when there is none. */
  readonly crossingIndex: number | null;
};

/** Running totals of the flows as they stand, one per period. */
export function cumulative(flows: readonly number[]): number[] {
  const out: number[] = [];
  let running = 0;
  for (const flow of flows) {
    running += flow;
    out.push(running);
  }
  return out;
}

/** Each flow at its own period's discount factor; `flows[0]` is at t = 0, so it is untouched. */
export function discountedFlows(ratePercent: number, flows: readonly number[]): number[] | null {
  if (!Number.isFinite(ratePercent) || ratePercent <= MIN_RATE_PERCENT) {
    return null;
  }
  const rate = ratePercent / 100;
  return flows.map((flow, index) => flow / (1 + rate) ** index);
}

/** Running totals of the discounted flows. The last one is the NPV, by construction. */
export function cumulativeDiscounted(ratePercent: number, flows: readonly number[]): number[] | null {
  const discounted = discountedFlows(ratePercent, flows);
  return discounted === null ? null : cumulative(discounted);
}

/**
 * The first crossing, with the fraction of the crossing year taken linearly:
 * payback = (first year the running total is ≥ 0) − 1 + |running total the year before| ÷ that
 * year's flow. A plan that starts at or above zero pays back at 0.
 */
export function paybackFrom(flows: readonly number[]): PaybackPoint {
  const totals = cumulative(flows);
  const at = totals.findIndex((total) => total >= 0);
  if (at === -1) {
    return { years: null, crossingIndex: null };
  }
  if (at === 0) {
    return { years: 0, crossingIndex: 0 };
  }
  const before = totals[at - 1] as number;
  const crossingFlow = flows[at] as number;
  // The flow that closed the gap cannot be zero — the total moved — but a float can still be, and a
  // whole-year answer is honest where a division by zero is not.
  const fraction = crossingFlow === 0 ? 0 : Math.abs(before) / crossingFlow;
  return { years: at - 1 + fraction, crossingIndex: at };
}

/** Simple payback in years from t = 0, or null when the running total never reaches zero. */
export function paybackYears(flows: readonly number[]): number | null {
  return paybackFrom(flows).years;
}

/** The same rule over the flows discounted at this rate. Always at or past the simple payback. */
export function discountedPaybackYears(ratePercent: number, flows: readonly number[]): number | null {
  const discounted = discountedFlows(ratePercent, flows);
  return discounted === null ? null : paybackFrom(discounted).years;
}

/**
 * (NPV − the t = 0 flow) ÷ −(the t = 0 flow): the present value of every later year over the
 * outlay. Above 1 the plan earns more than it costs at this rate — the same statement a positive
 * NPV makes, expressed per rupiah or dollar committed. Null when there is no outlay to divide by.
 */
export function profitabilityIndex(npvValue: number | null, outlay: number): number | null {
  if (npvValue === null || outlay >= 0) {
    return null;
  }
  return (npvValue - outlay) / -outlay;
}
