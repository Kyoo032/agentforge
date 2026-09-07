/**
 * Pure finance functions. No model, no I/O, no rounding until display.
 * Every function returns null (not NaN) when the inputs cannot support the answer.
 */

import type { LineItem, LineItemCategory } from "./types";

export const IRR_MAX_ITERATIONS = 200;
export const IRR_TOLERANCE = 1e-9;

export type PeriodTotal = { period: string; total: number; count: number };

/** Sum amounts per period (insertion order of first appearance), optionally for one category. */
export function totalsByPeriod(items: readonly LineItem[], category?: LineItemCategory): PeriodTotal[] {
  const order: string[] = [];
  const totals = new Map<string, PeriodTotal>();
  for (const item of items) {
    if (category && item.category !== category) {
      continue;
    }
    const current = totals.get(item.period);
    if (current) {
      totals.set(item.period, { ...current, total: current.total + item.amount, count: current.count + 1 });
    } else {
      order.push(item.period);
      totals.set(item.period, { period: item.period, total: item.amount, count: 1 });
    }
  }
  return order.map((period) => totals.get(period) as PeriodTotal);
}

export function sumBy(items: readonly LineItem[], category: LineItemCategory, period?: string): number | null {
  const matching = items.filter(
    (item) => item.category === category && (period === undefined || item.period === period),
  );
  return matching.length === 0 ? null : matching.reduce((sum, item) => sum + item.amount, 0);
}

/** (revenue - cost) / revenue, as a percentage. Null when revenue is zero or missing. */
export function marginPercent(revenue: number | null, cost: number | null): number | null {
  if (revenue === null || cost === null || revenue === 0) {
    return null;
  }
  return ((revenue - cost) / revenue) * 100;
}

/** Period-over-period growth in percent; null where the previous value is zero. */
export function growthRates(values: readonly number[]): Array<number | null> {
  return values.map((value, index) => {
    if (index === 0) {
      return null;
    }
    const previous = values[index - 1] as number;
    return previous === 0 ? null : ((value - previous) / Math.abs(previous)) * 100;
  });
}

/** Compound growth from first to last over (n - 1) steps, in percent. */
export function cagrPercent(first: number, last: number, steps: number): number | null {
  if (steps <= 0 || first <= 0 || last < 0) {
    return null;
  }
  return ((last / first) ** (1 / steps) - 1) * 100;
}

/** Months of cash left at the given monthly burn. Infinite burn-free runway is reported as null. */
export function runwayMonths(cash: number, monthlyBurn: number): number | null {
  if (monthlyBurn <= 0 || cash < 0) {
    return null;
  }
  return cash / monthlyBurn;
}

/** Units to sell before profit is zero. Null when contribution per unit is not positive. */
export function breakevenUnits(fixedCosts: number, pricePerUnit: number, variableCostPerUnit: number): number | null {
  const contribution = pricePerUnit - variableCostPerUnit;
  if (contribution <= 0 || fixedCosts < 0) {
    return null;
  }
  return fixedCosts / contribution;
}

/** Revenue at breakeven = fixed costs / contribution margin ratio. */
export function breakevenRevenue(fixedCosts: number, contributionMarginPercent: number): number | null {
  if (contributionMarginPercent <= 0 || fixedCosts < 0) {
    return null;
  }
  return fixedCosts / (contributionMarginPercent / 100);
}

/** Net present value; flows[0] is at t = 0 (usually negative). rate is a fraction (0.1 = 10%). */
export function npv(rate: number, flows: readonly number[]): number | null {
  if (flows.length === 0 || rate <= -1) {
    return null;
  }
  return flows.reduce((sum, flow, index) => sum + flow / (1 + rate) ** index, 0);
}

/** Internal rate of return as a fraction, by bisection on NPV. Null without a sign change. */
export function irr(flows: readonly number[]): number | null {
  if (flows.length < 2 || !flows.some((flow) => flow < 0) || !flows.some((flow) => flow > 0)) {
    return null;
  }
  let low = -0.9999;
  let high = 10;
  let npvLow = npv(low, flows) ?? Number.NaN;
  const npvHigh = npv(high, flows) ?? Number.NaN;
  if (!Number.isFinite(npvLow) || !Number.isFinite(npvHigh) || npvLow * npvHigh > 0) {
    return null;
  }
  for (let iteration = 0; iteration < IRR_MAX_ITERATIONS; iteration += 1) {
    const mid = (low + high) / 2;
    const npvMid = npv(mid, flows) ?? 0;
    if (Math.abs(npvMid) < IRR_TOLERANCE || high - low < IRR_TOLERANCE) {
      return mid;
    }
    if (npvLow * npvMid < 0) {
      high = mid;
    } else {
      low = mid;
      npvLow = npvMid;
    }
  }
  return (low + high) / 2;
}

export type AmortizationRow = { month: number; payment: number; interest: number; principal: number; balance: number };

/** Level-payment schedule. annualRatePercent = 6 means 6% per year. */
export function amortizationSchedule(principal: number, annualRatePercent: number, months: number): AmortizationRow[] {
  if (principal <= 0 || months <= 0 || !Number.isInteger(months) || annualRatePercent < 0) {
    return [];
  }
  const rawMonthlyRate = annualRatePercent / 100 / 12;
  // Below this the discount factor rounds to exactly 1 and the level-payment formula divides by zero.
  const monthlyRate = rawMonthlyRate < 1e-10 ? 0 : rawMonthlyRate;
  const payment =
    monthlyRate === 0 ? principal / months : (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
  const rows: AmortizationRow[] = [];
  let balance = principal;
  for (let month = 1; month <= months; month += 1) {
    const interest = balance * monthlyRate;
    const principalPaid = month === months ? balance : payment - interest;
    balance = Math.max(0, balance - principalPaid);
    rows.push({ month, payment: interest + principalPaid, interest, principal: principalPaid, balance });
  }
  return rows;
}

export type RatioInputs = {
  currentAssets?: number;
  currentLiabilities?: number;
  inventory?: number;
  totalDebt?: number;
  totalEquity?: number;
  netOperatingIncome?: number;
  debtService?: number;
};

export type RatioSet = {
  currentRatio: number | null;
  quickRatio: number | null;
  debtToEquity: number | null;
  dscr: number | null;
};

function divide(numerator: number | undefined, denominator: number | undefined): number | null {
  if (numerator === undefined || denominator === undefined || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

export function ratioSet(input: RatioInputs): RatioSet {
  const quickAssets = input.currentAssets === undefined ? undefined : input.currentAssets - (input.inventory ?? 0);
  return {
    currentRatio: divide(input.currentAssets, input.currentLiabilities),
    quickRatio: divide(quickAssets, input.currentLiabilities),
    debtToEquity: divide(input.totalDebt, input.totalEquity),
    dscr: divide(input.netOperatingIncome, input.debtService),
  };
}

export type ProjectionPoint = { step: number; value: number };

/** Simple compound projection from a base value; growthPercent per step, optional per-step additive deltas. */
export function project(
  base: number,
  steps: number,
  growthPercent: number,
  deltas: readonly number[] = [],
): ProjectionPoint[] {
  if (steps <= 0 || !Number.isInteger(steps)) {
    return [];
  }
  const out: ProjectionPoint[] = [];
  let value = base;
  for (let step = 1; step <= steps; step += 1) {
    value = value * (1 + growthPercent / 100) + (deltas[step - 1] ?? 0);
    out.push({ step, value });
  }
  return out;
}

export type Scenario = { name: string; growthPercent: number; deltas?: number[] };

export function scenarios(
  base: number,
  steps: number,
  list: readonly Scenario[],
): Array<{ name: string; points: ProjectionPoint[] }> {
  return list.map((scenario) => ({
    name: scenario.name,
    points: project(base, steps, scenario.growthPercent, scenario.deltas),
  }));
}
