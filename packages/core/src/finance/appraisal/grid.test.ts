import { describe, expect, it } from "vitest";
import { appraisalGridFromText, discountRateFromText, gridAmount } from "./grid";

/** What the importer hands over once it has normalised the cells. */
const NORMALISED = `Sheet: Kelayakan Mesin
Komponen | Tahun 0 | Tahun 1 | Tahun 2
Investasi awal (mesin + instalasi) | -1450000000 | 0 | 0
Penghematan biaya & tambahan pendapatan | 0 | 345000000 | 412000000
Biaya operasi & perawatan | 0 | -60000000 | -72000000
[subtotal] Arus kas bersih | -1450000000 | 285000000 | 340000000`;

/** The same sheet before anything normalised it: parentheses, comma thousands, a currency mark. */
const RAW = `Line item | Year 0 | Year 1 | Year 2
Initial investment | (1,450,000,000) | - | -
Avoided cost | 0 | Rp 345,000,000 | Rp 412,000,000
O&M | 0 | (60,000,000) | (72,000,000)
Net cash flow | (1,450,000,000) | 285,000,000 | 340,000,000`;

describe("cells", () => {
  it("reads a parenthesised, comma-grouped amount as the negative it is", () => {
    expect(gridAmount("(1,450,000,000)", "decimal")).toBe(-1_450_000_000);
    expect(gridAmount("Rp 345,000,000", "decimal")).toBe(345_000_000);
    expect(gridAmount("-60000000", "decimal")).toBe(-60_000_000);
  });

  it("is silent about a blank cell, a dash and a rate", () => {
    expect(gridAmount("", "decimal")).toBeNull();
    expect(gridAmount("-", "decimal")).toBeNull();
    expect(gridAmount("12%", "decimal")).toBeNull();
  });
});

describe("the year-column grid", () => {
  it("reads one row per non-zero cell and drops the tagged subtotal", () => {
    const grid = appraisalGridFromText(NORMALISED);
    expect(grid?.periods).toEqual(["Tahun 0", "Tahun 1", "Tahun 2"]);
    expect(grid?.subtotals).toEqual(["[subtotal] Arus kas bersih"]);
    expect(grid?.items.map((item) => [item.label, item.period, item.amount])).toEqual([
      ["Investasi awal (mesin + instalasi)", "Tahun 0", -1_450_000_000],
      ["Penghematan biaya & tambahan pendapatan", "Tahun 1", 345_000_000],
      ["Penghematan biaya & tambahan pendapatan", "Tahun 2", 412_000_000],
      ["Biaya operasi & perawatan", "Tahun 1", -60_000_000],
      ["Biaya operasi & perawatan", "Tahun 2", -72_000_000],
    ]);
  });

  // Adding the subtotal to its own parts doubles every year; here it is caught arithmetically.
  it("drops an untagged Net cash flow row because it totals the columns above it", () => {
    const grid = appraisalGridFromText(RAW);
    expect(grid?.subtotals).toEqual(["Net cash flow"]);
    expect(grid?.items.filter((item) => item.period === "Year 0")).toHaveLength(1);
    expect(grid?.items.find((item) => item.period === "Year 0")?.amount).toBe(-1_450_000_000);
    expect(grid?.currency).toBe("IDR");
  });

  it("marks the year-0 outlay as an asset and everything after it as cash", () => {
    const grid = appraisalGridFromText(NORMALISED);
    expect(grid?.items[0]?.category).toBe("asset");
    expect(grid?.items[1]?.category).toBe("cash");
  });

  it("keeps a row that only sounds like a total", () => {
    const text = `Line | Year 0 | Year 1
Outlay | -100 | 0
Total savings from the new line | 0 | 40
Other | 0 | 10`;
    const grid = appraisalGridFromText(text);
    expect(grid?.subtotals).toEqual([]);
    expect(grid?.items).toHaveLength(3);
  });

  // A document's tables arrive as Markdown, with a pipe on each end of every row.
  it("reads a Markdown table whose rows open and close with a pipe", () => {
    const text = `| Item | Year 0 | Year 1 | Year 2 |
|---|---|---|---|
| Capex | -1000 | 0 | 0 |
| Revenue | 0 | 600 | 700 |`;
    const grid = appraisalGridFromText(text);
    expect(grid?.periods).toEqual(["Year 0", "Year 1", "Year 2"]);
    expect(grid?.items.map((item) => [item.label, item.period, item.amount])).toEqual([
      ["Capex", "Year 0", -1000],
      ["Revenue", "Year 1", 600],
      ["Revenue", "Year 2", 700],
    ]);
  });

  it("answers null for text that is not a year-column table", () => {
    expect(appraisalGridFromText("Outlay Rp 2.000.000.000. Tahun 1 Rp 600.000.000.")).toBeNull();
    expect(appraisalGridFromText("Label | 2024 | 2025\nRevenue | 10 | 20")).toBeNull();
    expect(appraisalGridFromText("")).toBeNull();
  });
});

describe("the discount rate in the request's own words", () => {
  it("reads the rate a prompt names, in either language", () => {
    expect(discountRateFromText("Diskonto 12% per tahun.")).toBe(12);
    expect(discountRateFromText("Use an 8% discount rate.")).toBe(8);
    expect(discountRateFromText("discount rate of 12,5%")).toBe(12.5);
    expect(discountRateFromText("Our hurdle rate is 10 %")).toBe(10);
    expect(discountRateFromText("9% p.a.")).toBe(9);
  });

  it("says nothing when the request names no rate", () => {
    expect(discountRateFromText("Please appraise this plan.")).toBeNull();
    expect(discountRateFromText("Margins were 41.6 percent.")).toBeNull();
  });
});
