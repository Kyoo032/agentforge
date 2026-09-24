import { describe, expect, it } from "vitest";
import { fiscalYearGroups, isSubYearPeriod, monthsInGroup, monthsInPeriod } from "./fiscal-periods";

describe("monthsInPeriod", () => {
  // "FY2024" has no word boundary between the Y and the 2, so the plain year pattern never saw it.
  it.each([
    ["FY2024", 12],
    ["FY24", 12],
    ["FY 2024", 12],
    ["FY'24", 12],
    ["fy2024", 12],
    ["FY2024/25", 12],
    ["FY 2023-24", 12],
  ])("reads the fiscal year %s as twelve months", (period, months) => {
    expect(monthsInPeriod(period)).toBe(months);
  });

  it.each([
    ["H1 2024", 6],
    ["H2 2024", 6],
    ["h2 2024", 6],
    ["H1'24", 6],
    ["H1 FY2024", 6],
    ["Semester 1 2024", 6],
    ["semester 2 2024", 6],
  ])("reads the half year %s as six months", (period, months) => {
    expect(monthsInPeriod(period)).toBe(months);
  });

  it.each([
    ["Q1 2024", 3],
    ["TW3 2024", 3],
    ["Triwulan 4 2024", 3],
    ["Q1 FY2024", 3],
    ["FY2024 Q2", 3],
  ])("reads the quarter %s as three months, even inside a fiscal year", (period, months) => {
    expect(monthsInPeriod(period)).toBe(months);
  });

  it.each([
    ["Jan 2024", 1],
    ["Desember 2024", 1],
    ["Mar FY24", 1],
  ])("reads the month %s as one month, even inside a fiscal year", (period, months) => {
    expect(monthsInPeriod(period)).toBe(months);
  });

  it.each([
    ["2024", 12],
    ["Tahun 2024", 12],
    ["", 1],
    ["Total", 1],
    ["H3 2024", 12],
    ["FY", 1],
  ])("keeps %s where it was: a calendar year twelve, anything undated one", (period, months) => {
    expect(monthsInPeriod(period)).toBe(months);
  });
});

describe("what the new readings leave alone", () => {
  // Only a label with neither a month nor a quarter could change, so a fiscal-year group — which
  // only ever holds months and quarters — sums exactly as it did.
  it("never puts a half year or a fiscal-year label into a fiscal-year group", () => {
    expect(isSubYearPeriod("H1 2024")).toBe(false);
    expect(isSubYearPeriod("FY2024")).toBe(false);
    expect(fiscalYearGroups(["H1 2024", "H2 2024", "FY2024", "FY2025"])).toEqual([]);
  });

  it("sums a group of months or quarters as before", () => {
    const groups = fiscalYearGroups(["Jan 2024", "Feb 2024", "Q1 2025", "Q2 2025"]);
    expect(groups.map((group) => [group.label, monthsInGroup(group)])).toEqual([
      ["FY2024", 2],
      ["FY2025", 6],
    ]);
  });
});
