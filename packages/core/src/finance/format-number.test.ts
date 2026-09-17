import { describe, expect, it } from "vitest";
import { guardNumbers } from "./number-guard";
import {
  formatCompactCurrency,
  formatCurrency,
  formatMetricValue,
  formatMonths,
  formatNumber,
  formatPercent,
  formatRatio,
} from "./format-number";

describe("formatNumber", () => {
  it("groups with the locale's own marks", () => {
    expect(formatNumber(1_250_000_000, "id")).toBe("1.250.000.000");
    expect(formatNumber(1_250_000_000, "en")).toBe("1,250,000,000");
    expect(formatNumber(-245_000_000, "id")).toBe("-245.000.000");
    expect(formatNumber(1234.5, "id", 1)).toBe("1.234,5");
    expect(formatNumber(1234.5, "en", 1)).toBe("1,234.5");
  });
});

describe("currency", () => {
  it("writes the exact amount with the currency in front", () => {
    expect(formatCurrency(1_250_000_000, "IDR", "id")).toBe("Rp 1.250.000.000");
    expect(formatCurrency(1_250_000_000, "USD", "en")).toBe("$1,250,000,000");
    expect(formatCurrency(-1_000, "USD", "en")).toBe("-$1,000");
    expect(formatCurrency(500, "SGD", "en")).toBe("SGD 500");
  });

  it("writes a headline short form with the locale's magnitude word", () => {
    expect(formatCompactCurrency(1_250_000_000, "IDR", "id")).toBe("Rp 1,25 miliar");
    expect(formatCompactCurrency(1_250_000, "USD", "en")).toBe("$1.25M");
    expect(formatCompactCurrency(2_350_000_000, "IDR", "id")).toBe("Rp 2,35 miliar");
    // Below a thousand there is no shorter way to write it.
    expect(formatCompactCurrency(750, "USD", "en")).toBe("$750");
  });
});

describe("units", () => {
  it("never writes a four-decimal percentage", () => {
    expect(formatPercent(41.6, "id")).toBe("41,6%");
    expect(formatPercent(41.6, "en")).toBe("41.6%");
    expect(formatPercent(29.128198364547615, "id")).toBe("29,1%");
  });

  it("writes ratios and months", () => {
    expect(formatRatio(1.84, "id")).toBe("1,84x");
    expect(formatMonths(7.7632, "id")).toBe("7,8 bulan");
    expect(formatMonths(7.7632, "en")).toBe("7.8 months");
  });
});

describe("formatMetricValue", () => {
  it("picks the form from the metric's own unit", () => {
    expect(formatMetricValue({ value: 9_775_000_000, unit: "IDR" }, "id")).toBe("Rp 9.775.000.000");
    expect(formatMetricValue({ value: 44.1739, unit: "%" }, "id")).toBe("44,2%");
    expect(formatMetricValue({ value: 1.84, unit: "x" }, "en")).toBe("1.84x");
    expect(formatMetricValue({ value: 7.7632, unit: "months" }, "id")).toBe("7,8 bulan");
    expect(formatMetricValue({ value: 8, unit: "" }, "en")).toBe("8");
    expect(formatMetricValue({ value: null, unit: "IDR" }, "id")).toBe("tidak tersedia");
  });
});

describe("the guard accepts everything these functions write", () => {
  it("verifies the grouped and the short form in both locales", () => {
    const allowed = [9_775_000_000, 44.1739, 7.7632, 1_250_000_000];
    const prose = [
      formatCurrency(9_775_000_000, "IDR", "id"),
      formatPercent(44.1739, "id"),
      formatMonths(7.7632, "id"),
      formatCompactCurrency(1_250_000_000, "IDR", "id"),
    ].join(" · ");
    expect(guardNumbers(prose, allowed).flagged).toEqual([]);
  });

  it("verifies the English forms too", () => {
    const allowed = [12_880_000, 74.309, 87.9375];
    const prose = `${formatCurrency(12_880_000, "USD", "en")} at ${formatPercent(74.309, "en")} leaves ${formatMonths(87.9375, "en")}`;
    expect(guardNumbers(prose, allowed).flagged).toEqual([]);
  });
});
