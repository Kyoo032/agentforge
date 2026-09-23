import { describe, expect, it } from "vitest";
import { computeFinance } from "./metrics";
import { burnBasisMonths } from "./trend-metrics";
import type { LineItem } from "./types";

function row(label: string, period: string, amount: number, category: LineItem["category"]): LineItem {
  return { label, period, amount, currency: "IDR", category };
}

function metricsOf(items: readonly LineItem[]) {
  return new Map(computeFinance(items).metrics.map((entry) => [entry.key, entry]));
}

describe("implied burn when the sheet states none", () => {
  // Two fiscal years short by 600 each is 50 a month, not 600: runway is counted in months.
  const years = [
    row("Revenue", "FY2023", 600, "revenue"),
    row("Operating expenses", "FY2023", 1200, "opex"),
    row("Revenue", "FY2024", 600, "revenue"),
    row("Operating expenses", "FY2024", 1200, "opex"),
    row("Cash", "FY2024", 1750, "cash"),
  ];

  it("turns the shortfall into a monthly burn over the months the periods cover", () => {
    const byKey = metricsOf(years);
    expect(byKey.get("burn")?.value).toBeCloseTo(50, 10);
    expect(byKey.get("burn")?.label).toMatch(/monthly/i);
    expect(byKey.get("burn")?.formula).toMatch(/months/);
    expect(byKey.get("runway")?.value).toBeCloseTo(35, 10);
    expect(byKey.get("runway")?.unit).toBe("months");
  });

  it("reads a calendar-year column as twelve months too", () => {
    const calendar = years.map((item) => ({ ...item, period: item.period.replace("FY", "") }));
    expect(metricsOf(calendar).get("runway")?.value).toBeCloseTo(35, 10);
  });

  it("reads a month column as one month and a quarter as three", () => {
    const months = [
      row("Revenue", "Jan 2025", 100, "revenue"),
      row("Opex", "Jan 2025", 400, "opex"),
      row("Revenue", "Feb 2025", 100, "revenue"),
      row("Opex", "Feb 2025", 400, "opex"),
      row("Cash", "Feb 2025", 900, "cash"),
    ];
    expect(metricsOf(months).get("burn")?.value).toBeCloseTo(300, 10);
    expect(metricsOf(months).get("runway")?.value).toBeCloseTo(3, 10);
    const quarters = months.map((item) => ({ ...item, period: item.period.startsWith("Jan") ? "Q1 2025" : "Q2 2025" }));
    expect(metricsOf(quarters).get("burn")?.value).toBeCloseTo(100, 10);
    expect(metricsOf(quarters).get("runway")?.value).toBeCloseTo(9, 10);
  });

  it("reads a half-year column as six months", () => {
    const halves = [
      row("Revenue", "H1 2024", 600, "revenue"),
      row("Operating expenses", "H1 2024", 1200, "opex"),
      row("Revenue", "H2 2024", 600, "revenue"),
      row("Operating expenses", "H2 2024", 1200, "opex"),
      row("Cash", "H2 2024", 1750, "cash"),
    ];
    // 1,200 short over the twelve months the two halves cover, not over twenty-four.
    expect(metricsOf(halves).get("burn")?.value).toBeCloseTo(100, 10);
    expect(metricsOf(halves).get("runway")?.value).toBeCloseTo(17.5, 10);
  });

  it("reads a fiscal year that straddles two calendar years as twelve months", () => {
    const straddling = years.map((item) => ({ ...item, period: item.period === "FY2023" ? "FY2023/24" : "FY2024/25" }));
    expect(metricsOf(straddling).get("burn")?.value).toBeCloseTo(50, 10);
    expect(metricsOf(straddling).get("runway")?.value).toBeCloseTo(35, 10);
  });

  it("writes the label in Indonesian when the brief is", () => {
    const burn = computeFinance(years, {}, { locale: "id" }).metrics.find((entry) => entry.key === "burn");
    expect(burn?.label).toMatch(/bulanan/i);
  });
});

describe("a stated burn over fiscal-year and half-year columns", () => {
  // A burn row that does not say its own basis covers the months its period covers.
  it("reads the basis of an unlabelled burn from an FY or half-year period", () => {
    expect(burnBasisMonths("Net burn", "FY2024")).toBe(12);
    expect(burnBasisMonths("Net burn", "FY24")).toBe(12);
    expect(burnBasisMonths("Net burn", "H1 2024")).toBe(6);
    expect(burnBasisMonths("Net burn", "Q1 2024")).toBe(3);
    // The row's own words still win over its period.
    expect(burnBasisMonths("Monthly net burn", "FY2024")).toBe(1);
    expect(burnBasisMonths("Quarterly net burn", "H1 2024")).toBe(3);
  });

  it("spreads an FY burn over twelve months, for the average and for the latest year alike", () => {
    const byKey = metricsOf([
      row("Net burn", "FY2023", 1200, "other"),
      row("Net burn", "FY2024", 2400, "other"),
      row("Cash", "FY2024", 2000, "cash"),
    ]);
    // 3,600 over 24 months is 150 a month; the latest year alone is 2,400 / 12 = 200.
    expect(byKey.get("monthly_burn")?.value).toBeCloseTo(150, 10);
    expect(byKey.get("runway")?.value).toBeCloseTo(2000 / 150, 10);
    expect(byKey.get("runway_latest_burn")?.value).toBeCloseTo(10, 10);
  });

  it("spreads a half-year burn over six months", () => {
    const byKey = metricsOf([
      row("Net burn", "H1 2024", 600, "other"),
      row("Net burn", "H2 2024", 600, "other"),
      row("Cash", "H2 2024", 1000, "cash"),
    ]);
    expect(byKey.get("monthly_burn")?.value).toBeCloseTo(100, 10);
    expect(byKey.get("runway")?.value).toBeCloseTo(10, 10);
    expect(byKey.get("runway_latest_burn")?.value).toBeCloseTo(10, 10);
  });
});

describe("revenue CAGR", () => {
  // The compound rate spans the periods between the first and last stated revenue, not the sheet's width.
  it("counts the steps between the first and last revenue actually stated", () => {
    const trailingGap = [
      row("Revenue", "2023", 100, "revenue"),
      row("Revenue", "2024", 121, "revenue"),
      row("Opex", "2025", 50, "opex"),
    ];
    const cagr = metricsOf(trailingGap).get("revenue_cagr");
    expect(cagr?.value).toBeCloseTo(21, 10);
    expect(cagr?.formula).toBe("(last / first) ^ (1 / 1) - 1");
  });

  it("counts a leading gap out as well, and a gap in the middle in", () => {
    const leading = [
      row("Opex", "2022", 50, "opex"),
      row("Revenue", "2023", 100, "revenue"),
      row("Revenue", "2024", 121, "revenue"),
    ];
    expect(metricsOf(leading).get("revenue_cagr")?.value).toBeCloseTo(21, 10);
    const middle = [
      row("Revenue", "2023", 100, "revenue"),
      row("Opex", "2024", 50, "opex"),
      row("Revenue", "2025", 121, "revenue"),
    ];
    expect(metricsOf(middle).get("revenue_cagr")?.value).toBeCloseTo(10, 10);
  });

  it("states no compound rate from a single revenue figure", () => {
    const single = [row("Revenue", "2023", 100, "revenue"), row("Opex", "2024", 50, "opex")];
    expect(metricsOf(single).get("revenue_cagr")).toBeUndefined();
  });
});
