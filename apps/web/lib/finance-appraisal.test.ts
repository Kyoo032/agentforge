import { describe, expect, it } from "vitest";
import type { LineItem } from "@agentforge/core/finance";
import {
  FALLBACK_RATE_PERCENT,
  addNextYear,
  appraisalPreview,
  appraisalYearRows,
  formatNumberList,
  gridAxes,
  nextPeriodLabel,
  parseNumberList,
  prefilledRate,
  removeYear,
  setYearAmount,
} from "./finance-appraisal";

const NET_LABEL = "Arus kas bersih";

function row(label: string, period: string, amount: number): LineItem {
  return { label, period, amount, currency: "IDR", category: "cash" };
}

const ITEMS: LineItem[] = [
  { label: "Investasi awal", period: "Tahun 0", amount: -1_450_000_000, currency: "IDR", category: "asset" },
  row("Penghematan", "Tahun 1", 345_000_000),
  row("Biaya operasi", "Tahun 1", -60_000_000),
  row("Penghematan", "Tahun 2", 412_000_000),
  row("Biaya operasi", "Tahun 2", -72_000_000),
];

describe("the editable year rows", () => {
  it("nets the confirmed rows per year and keeps what each net is made of", () => {
    const rows = appraisalYearRows(ITEMS);
    expect(rows.map((entry) => [entry.period, entry.amount])).toEqual([
      ["Tahun 0", -1_450_000_000],
      ["Tahun 1", 285_000_000],
      ["Tahun 2", 340_000_000],
    ]);
    expect(rows[1]?.components.map((part) => part.label)).toEqual(["Penghematan", "Biaya operasi"]);
  });

  it("keeps a single row's own name when its amount is edited", () => {
    const next = setYearAmount(ITEMS, "Tahun 0", -1_500_000_000, NET_LABEL);
    expect(next.filter((item) => item.period === "Tahun 0")).toEqual([
      { label: "Investasi awal", period: "Tahun 0", amount: -1_500_000_000, currency: "IDR", category: "asset" },
    ]);
    expect(next).toHaveLength(ITEMS.length);
  });

  // Overriding a net built from several rows cannot keep all their names, so it says so with one.
  it("collapses a multi-row year to one net row when the total is overridden", () => {
    const next = setYearAmount(ITEMS, "Tahun 1", 300_000_000, NET_LABEL);
    const inYear = next.filter((item) => item.period === "Tahun 1");
    expect(inYear).toEqual([
      { label: NET_LABEL, period: "Tahun 1", amount: 300_000_000, currency: "IDR", category: "cash" },
    ]);
    expect(appraisalYearRows(next).map((entry) => entry.amount)).toEqual([-1_450_000_000, 300_000_000, 340_000_000]);
  });

  it("never mutates the rows it was given", () => {
    const before = JSON.stringify(ITEMS);
    setYearAmount(ITEMS, "Tahun 1", 1, NET_LABEL);
    addNextYear(ITEMS, NET_LABEL);
    removeYear(ITEMS, "Tahun 1");
    expect(JSON.stringify(ITEMS)).toBe(before);
  });

  it("adds the next year under the label the sheet already uses", () => {
    expect(nextPeriodLabel(["Tahun 0", "Tahun 6"], 7)).toBe("Tahun 7");
    expect(nextPeriodLabel(["Year 0", "Year 10"], 11)).toBe("Year 11");
    expect(nextPeriodLabel([], 0)).toBe("Year 0");
    const next = addNextYear(ITEMS, NET_LABEL);
    expect(appraisalYearRows(next).map((entry) => entry.period)).toEqual([
      "Tahun 0",
      "Tahun 1",
      "Tahun 2",
      "Tahun 3",
    ]);
  });

  it("removes a year and everything in it", () => {
    expect(appraisalYearRows(removeYear(ITEMS, "Tahun 2")).map((entry) => entry.period)).toEqual([
      "Tahun 0",
      "Tahun 1",
    ]);
  });
});

describe("the axis boxes", () => {
  it("reads a list of rates however it is typed", () => {
    expect(parseNumberList("10, 12, 14")).toEqual([10, 12, 14]);
    expect(parseNumberList("6%; 8% 10%")).toEqual([6, 8, 10]);
    expect(parseNumberList("-10 0 +10")).toEqual([-10, 0, 10]);
    expect(parseNumberList("")).toEqual([]);
    expect(parseNumberList("ten, 12")).toEqual([12]);
    expect(formatNumberList([10, 12, 14])).toBe("10, 12, 14");
  });

  it("falls back to the rate either side of the hurdle when no scenarios are given", () => {
    expect(gridAxes({}, 12).ratePercents).toEqual([10, 12, 14]);
    expect(gridAxes({}, 8).ratePercents).toEqual([6, 8, 10]);
    expect(gridAxes({}, 8).shiftPercents).toEqual([-10, 0, 10]);
    expect(gridAxes({ rateScenarios: [5, 15] }, 8).ratePercents).toEqual([5, 15]);
  });
});

describe("the prefilled rate", () => {
  it("prefers the confirmed parameter, then the request's own words", () => {
    expect(prefilledRate({ discountRatePercent: 12 }, "8% discount rate")).toBe(12);
    expect(prefilledRate({}, "Use an 8% discount rate.")).toBe(8);
    expect(prefilledRate({}, "", "Diskonto 12% per tahun.")).toBe(12);
    expect(prefilledRate({}, "no rate here")).toBe(FALLBACK_RATE_PERCENT);
  });
});

describe("the on-screen preview", () => {
  it("computes the same figures the report will carry", () => {
    const preview = appraisalPreview(ITEMS, { discountRatePercent: 12 });
    expect(preview?.periods.map((period) => period.cumulative)).toEqual([
      -1_450_000_000, -1_165_000_000, -825_000_000,
    ]);
    expect(preview?.sensitivity).toHaveLength(3);
    expect(preview?.sensitivity[0]).toHaveLength(3);
  });

  it("has nothing to show before a row is confirmed", () => {
    expect(appraisalPreview([], {})).toBeNull();
  });
});
