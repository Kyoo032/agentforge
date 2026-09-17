import { describe, expect, it } from "vitest";
import { budgetAggregate, budgetInputSchema, computeBudget, varianceCell } from "./index";
import { RETAIL_ITEMS, RETAIL_PARAMS, YAYASAN_ITEMS, YAYASAN_PARAMS } from "./__fixtures__/grids";

function computeFrom(items: unknown, params: unknown) {
  return computeBudget(budgetInputSchema.parse({ items, params }));
}

const LIMITS = { pct: 10, abs: 5_000_000, mode: "and" as const };

describe("one variance cell", () => {
  it("takes actual less budget and the percent off the budget", () => {
    const cell = varianceCell("2024", 1_850_000_000, 1_642_500_000, "revenue", LIMITS);
    expect(cell.variance).toBe(-207_500_000);
    expect(cell.variancePct).toBeCloseTo(-11.216216216216218, 10);
    expect(cell.direction).toBe("unfavourable");
    expect(cell.flagged).toBe(true);
  });

  it("reads a budget line that was never realised as -100 %, not as missing", () => {
    const cell = varianceCell("2024", 25_000_000, 0, "revenue", LIMITS);
    expect(cell.variance).toBe(-25_000_000);
    expect(cell.variancePct).toBe(-100);
  });

  it("leaves an unbudgeted line with no percent at all", () => {
    const cell = varianceCell("2024", 0, 72_000_000, "cost", LIMITS);
    expect(cell.variancePct).toBeNull();
    // The percent test cannot be applied, so the amount alone decides.
    expect(cell.flagged).toBe(true);
    expect(varianceCell("2024", 0, 1_000_000, "cost", LIMITS).flagged).toBe(false);
  });

  it("reads direction off the kind and calls a zero variance neutral", () => {
    expect(varianceCell("", 100, 90, "cost", LIMITS).direction).toBe("favourable");
    expect(varianceCell("", 100, 110, "cost", LIMITS).direction).toBe("unfavourable");
    expect(varianceCell("", 100, 110, "revenue", LIMITS).direction).toBe("favourable");
    expect(varianceCell("", 100, 100, "revenue", LIMITS).direction).toBe("neutral");
  });

  it("flags only when both limits break, and counts a limit sat exactly on as broken", () => {
    const and = { pct: 10, abs: 5_000_000, mode: "and" as const };
    // +Rp 78.4 m but only +5,94 %: the biggest overspend on the sheet, and not flagged.
    expect(varianceCell("", 1_320_000_000, 1_398_400_000, "cost", and).flagged).toBe(false);
    // +15 % but only +Rp 3.6 m: the mirror image.
    expect(varianceCell("", 24_000_000, 27_600_000, "cost", and).flagged).toBe(false);
    // Exactly +10,00 %: `>=`, so it is flagged.
    expect(varianceCell("", 240_000_000, 264_000_000, "cost", and).flagged).toBe(true);
    expect(varianceCell("", 1_320_000_000, 1_398_400_000, "cost", { ...and, mode: "or" }).flagged).toBe(true);
  });
});

describe("the foundation's sheet, end to end", () => {
  const computed = computeFrom(YAYASAN_ITEMS, YAYASAN_PARAMS);
  const bySlug = new Map(computed.lines.map((line) => [line.slug, line]));

  it("compares fourteen lines and flags nine of them", () => {
    expect(computed.lines).toHaveLength(14);
    expect(computed.flagCounts.total).toBe(9);
    expect(computed.lines.filter((line) => line.total.flagged).map((line) => line.label)).toEqual([
      "Donasi individu",
      "Hibah korporasi",
      "Pendapatan bunga bank",
      "Sewa kantor",
      "Perjalanan dinas",
      "ATK",
      "Cadangan dana darurat",
      "Biaya perbaikan atap kantor",
      "Beban penyusutan inventaris",
    ]);
  });

  it("puts every hand-checked variance where the case says it is", () => {
    expect(bySlug.get("atk")?.total.variance).toBe(5_300_000);
    expect(bySlug.get("atk")?.total.variancePct).toBeCloseTo(14.722222222222223, 10);
    expect(bySlug.get("sewa-kantor")?.total.variancePct).toBe(10);
    expect(bySlug.get("perjalanan-dinas")?.total.variance).toBe(-31_600_000);
    expect(bySlug.get("perjalanan-dinas")?.total.direction).toBe("favourable");
    expect(bySlug.get("beban-penyusutan-inventaris")?.total.variancePct).toBeNull();
    // Under budget on a cost line is favourable, and it is still flagged.
    expect(bySlug.get("cadangan-dana-darurat")?.total.direction).toBe("favourable");
    expect(bySlug.get("cadangan-dana-darurat")?.total.flagged).toBe(true);
  });

  it("rolls the sections up without ever touching the sheet's own subtotal rows", () => {
    const revenue = budgetAggregate(computed, "revenue");
    const cost = budgetAggregate(computed, "cost");
    const result = budgetAggregate(computed, "result");
    expect(revenue?.total.budget).toBe(3_525_000_000);
    expect(revenue?.total.actual).toBe(3_490_500_000);
    expect(revenue?.total.variance).toBe(-34_500_000);
    expect(revenue?.total.variancePct).toBeCloseTo(-0.9787234042553191, 10);
    expect(cost?.total.budget).toBe(2_866_000_000);
    expect(cost?.total.actual).toBe(2_966_950_000);
    expect(cost?.total.variance).toBe(100_950_000);
    expect(cost?.total.variancePct).toBeCloseTo(3.522330774598744, 10);
    expect(result?.total.budget).toBe(659_000_000);
    expect(result?.total.actual).toBe(523_550_000);
    expect(result?.total.variance).toBe(-135_450_000);
    expect(result?.total.variancePct).toBeCloseTo(-20.553869499241276, 10);
  });
});

describe("the retailer's quarters", () => {
  const computed = computeFrom(RETAIL_ITEMS, RETAIL_PARAMS);
  const byLabel = new Map(computed.lines.map((line) => [line.label, line]));

  it("keeps the four quarters apart and sums the year from them", () => {
    expect(computed.periods).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    const rent = byLabel.get("Rent - flagship store");
    expect(rent?.periods.map((cell) => cell.variance)).toEqual([3_200, 3_200, 3_200, 3_200]);
    expect(rent?.total.budget).toBe(160_000);
    expect(rent?.total.variance).toBe(12_800);
    expect(rent?.total.variancePct).toBe(8);
    expect(rent?.total.flagged).toBe(true);
  });

  it("flags four bad quarters whose year nets to exactly zero, and does not flag the year", () => {
    const shipping = byLabel.get("Shipping revenue");
    expect(shipping?.periods.map((cell) => cell.flagged)).toEqual([true, true, true, true]);
    expect(shipping?.total.variance).toBe(0);
    expect(shipping?.total.variancePct).toBe(0);
    expect(shipping?.total.direction).toBe("neutral");
    expect(shipping?.total.flagged).toBe(false);
  });

  it("flags a year that no single quarter would have flagged", () => {
    const fees = byLabel.get("Bank & card processing fees");
    expect(fees?.periods.map((cell) => cell.flagged)).toEqual([false, false, false, false]);
    expect(fees?.total.variance).toBe(7_200);
    expect(fees?.total.variancePct).toBe(9);
    expect(fees?.total.flagged).toBe(true);
  });

  it("calls a line that is dead on budget neutral rather than favourable", () => {
    const insurance = byLabel.get("Insurance");
    expect(insurance?.total.variance).toBe(0);
    expect(insurance?.total.direction).toBe("neutral");
    expect(insurance?.total.flagged).toBe(false);
  });

  it("does not flag the largest overspend on the sheet, because its percent is small", () => {
    const purchases = byLabel.get("Merchandise purchases");
    expect(purchases?.total.variance).toBe(60_000);
    expect(purchases?.total.variancePct).toBe(5);
    expect(purchases?.total.flagged).toBe(false);
  });

  it("sums each side over the year before dividing, rather than averaging the quarters", () => {
    const uneven = computeFrom(
      [
        { label: "Freight", period: "Q1 Budget", amount: 100, currency: "", category: "cogs" },
        { label: "Freight", period: "Q1 Actual", amount: 110, currency: "", category: "cogs" },
        { label: "Freight", period: "Q2 Budget", amount: 200, currency: "", category: "cogs" },
        { label: "Freight", period: "Q2 Actual", amount: 200, currency: "", category: "cogs" },
      ],
      { flagPct: 8, flagAbs: 2 },
    );
    const line = uneven.lines[0];
    expect(line?.periods.map((cell) => cell.variancePct)).toEqual([10, 0]);
    // The average of 10 % and 0 % is 5 %; summing first and dividing after gives 10/300.
    expect(line?.total.variancePct).toBeCloseTo(3.3333333333333335, 10);
  });

  it("separates cost of sales from operating cost and reads gross profit the right way up", () => {
    expect(budgetAggregate(computed, "cogs")?.total.budget).toBe(1_200_000);
    expect(budgetAggregate(computed, "opex")?.total.budget).toBe(284_000);
    expect(budgetAggregate(computed, "grossProfit")?.total.budget).toBe(-1_000_000);
    expect(budgetAggregate(computed, "grossProfit")?.kind).toBe("revenue");
  });
});
