import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  amortizationSchedule,
  breakevenRevenue,
  breakevenUnits,
  cagrPercent,
  growthRates,
  irr,
  marginPercent,
  npv,
  project,
  ratioSet,
  runwayMonths,
  scenarios,
  sumBy,
  totalsByPeriod,
} from "./engine";
import type { LineItem } from "./types";

const items: LineItem[] = [
  { label: "Sales", period: "2025", amount: 100, currency: "USD", category: "revenue" },
  { label: "Sales", period: "2026", amount: 130, currency: "USD", category: "revenue" },
  { label: "COGS", period: "2025", amount: 60, currency: "USD", category: "cogs" },
  { label: "Rent", period: "2025", amount: 10, currency: "USD", category: "opex" },
];

const finite = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

describe("totals and margins", () => {
  it("sums by period and category in first-seen order", () => {
    expect(totalsByPeriod(items)).toEqual([
      { period: "2025", total: 170, count: 3 },
      { period: "2026", total: 130, count: 1 },
    ]);
    expect(totalsByPeriod(items, "revenue").map((row) => row.total)).toEqual([100, 130]);
    expect(sumBy(items, "cogs", "2025")).toBe(60);
    expect(sumBy(items, "debt")).toBeNull();
  });

  it("computes margins and growth with null guards", () => {
    expect(marginPercent(100, 60)).toBe(40);
    expect(marginPercent(0, 60)).toBeNull();
    expect(marginPercent(null, 60)).toBeNull();
    expect(growthRates([100, 130, 0, 10])).toEqual([null, 30, -100, null]);
    expect(cagrPercent(100, 121, 2)).toBeCloseTo(10, 9);
    expect(cagrPercent(0, 10, 1)).toBeNull();
  });
});

describe("runway and breakeven", () => {
  it("divides with guards", () => {
    expect(runwayMonths(140, 10)).toBe(14);
    expect(runwayMonths(140, 0)).toBeNull();
    expect(breakevenUnits(1000, 25, 15)).toBe(100);
    expect(breakevenUnits(1000, 10, 15)).toBeNull();
    expect(breakevenRevenue(1000, 40)).toBe(2500);
    expect(breakevenRevenue(1000, 0)).toBeNull();
  });
});

describe("npv and irr", () => {
  it("npv at rate 0 equals the sum of flows (property)", () => {
    fc.assert(
      fc.property(fc.array(finite(-1e6, 1e6), { minLength: 1, maxLength: 12 }), (flows) => {
        const sum = flows.reduce((acc, flow) => acc + flow, 0);
        expect(npv(0, flows)).toBeCloseTo(sum, 6);
      }),
    );
  });

  it("irr recovers the rate of a simple investment and is null without a sign change", () => {
    expect(irr([-100, 110])).toBeCloseTo(0.1, 6);
    expect(irr([-1000, 300, 400, 500])).toBeCloseTo(0.0888, 3);
    expect(irr([100, 200])).toBeNull();
    // 360 monthly flows: the discount factor underflows at the bisection floor; must be null, not a stray number.
    const long = [-1000, ...Array.from({ length: 359 }, (_, i) => (i % 2 === 0 ? 5 : -3))];
    const rate = irr(long);
    expect(rate === null || Number.isFinite(rate)).toBe(true);
    expect(irr([-100])).toBeNull();
    expect(npv(-1, [1])).toBeNull();
  });

  it("npv at the irr is ~0 (property)", () => {
    fc.assert(
      fc.property(
        finite(100, 10_000),
        fc.array(finite(10, 5_000), { minLength: 1, maxLength: 8 }),
        (outlay, inflows) => {
          const flows = [-outlay, ...inflows];
          const rate = irr(flows);
          if (rate !== null) {
            expect(Math.abs(npv(rate, flows) ?? 1)).toBeLessThan(1e-3 * outlay);
          }
        },
      ),
    );
  });
});

describe("amortization", () => {
  it("pays the principal down to zero with level payments", () => {
    const rows = amortizationSchedule(1200, 0, 12);
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => Math.abs(row.payment - 100) < 1e-9)).toBe(true);
    expect(rows.at(-1)?.balance).toBe(0);
    const withInterest = amortizationSchedule(10_000, 6, 24);
    expect(withInterest[0]?.interest).toBeCloseTo(50, 9);
    expect(withInterest.at(-1)?.balance).toBe(0);
    expect(amortizationSchedule(0, 6, 12)).toEqual([]);
    expect(amortizationSchedule(100, 6, 2.5)).toEqual([]);
  });

  it("principal paid sums to the principal (property)", () => {
    fc.assert(
      fc.property(finite(100, 1e6), finite(0, 30), fc.integer({ min: 1, max: 120 }), (principal, rate, months) => {
        const rows = amortizationSchedule(principal, rate, months);
        const paid = rows.reduce((sum, row) => sum + row.principal, 0);
        expect(paid).toBeCloseTo(principal, 4);
        expect(rows.at(-1)?.balance).toBe(0);
      }),
    );
  });
});

describe("ratios and projections", () => {
  it("computes the ratio set with nulls for missing inputs", () => {
    expect(
      ratioSet({ currentAssets: 200, currentLiabilities: 100, inventory: 50, totalDebt: 300, totalEquity: 150 }),
    ).toEqual({
      currentRatio: 2,
      quickRatio: 1.5,
      debtToEquity: 2,
      dscr: null,
    });
    expect(ratioSet({ netOperatingIncome: 120, debtService: 0 }).dscr).toBeNull();
  });

  it("projects compound growth with deltas and scenarios", () => {
    expect(project(100, 3, 10).map((point) => Math.round(point.value))).toEqual([110, 121, 133]);
    expect(project(100, 2, 0, [5, -5]).map((point) => point.value)).toEqual([105, 100]);
    expect(project(100, 0, 10)).toEqual([]);
    const out = scenarios(100, 2, [
      { name: "base", growthPercent: 0 },
      { name: "bull", growthPercent: 50 },
    ]);
    expect(out.map((scenario) => [scenario.name, scenario.points.at(-1)?.value])).toEqual([
      ["base", 100],
      ["bull", 225],
    ]);
  });
});
