import { describe, expect, it } from "vitest";
import { KAFE_ITEMS, KAFE_OPENING_CASH } from "./__fixtures__/books";
import { cashflowBreakeven } from "./breakeven";
import { periodInputsFromItems, walkPeriods } from "./periods";

const kafe = walkPeriods(periodInputsFromItems(KAFE_ITEMS), KAFE_OPENING_CASH);

describe("breakeven from cost behaviour", () => {
  it("leaves the one-off overhaul out of the fixed base", () => {
    const breakeven = cashflowBreakeven(kafe);
    expect(breakeven.oneOffBase).toBe(12_000_000);
    expect(breakeven.fixedBase).toBe(633_700_000);
    expect(breakeven.variableBase).toBe(488_400_000);
    expect(breakeven.revenueBase).toBe(1_153_300_000);
  });

  it("works the margin and the revenue the café has to take", () => {
    const breakeven = cashflowBreakeven(kafe);
    // 1 - 488.400.000 / 1.153.300.000
    expect(breakeven.contributionMarginPct).toBeCloseTo(57.651955258822504, 9);
    // 633.700.000 / 12 / 0,57651955
    expect(breakeven.revenuePerPeriod).toBeCloseTo(91_598_512.30761519, 4);
    expect(breakeven.revenueTotal).toBeCloseTo(1_099_182_147.6913822, 3);
  });

  it("says not available rather than 'cover your costs' when nothing is variable", () => {
    const flat = kafe.map((period) => ({
      ...period,
      breakdown: { ...period.breakdown, variable: 0, fixed: period.cashOut },
    }));
    const breakeven = cashflowBreakeven(flat);
    expect(breakeven.contributionMarginPct).toBeNull();
    expect(breakeven.revenuePerPeriod).toBeNull();
    expect(breakeven.revenueTotal).toBeNull();
  });
});
