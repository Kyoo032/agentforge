import { describe, expect, it } from "vitest";
import { calcFormulaCheck, chartPartNames, expectedChartParts, summaryNumbersCheck } from "./artifacts.mjs";
import { amountsMatch } from "./numbers.mjs";

const REPORT = {
  summary: [
    { label: "NPV", value: 139_939_433.6, unit: "IDR" },
    { label: "IRR", value: 15.0165, unit: "%" },
    { label: "Verdict", value: "Go", unit: "" },
  ],
  tables: [
    { id: "inputs", title: "Inputs", columns: ["Label", "Amount"], rows: [["Outlay", -1_450_000_000]] },
    {
      id: "calc",
      title: "Calc",
      columns: ["Metric", "Value"],
      rows: [
        ["NPV", 139_939_433.6],
        ["IRR", 15.0165],
      ],
    },
  ],
  charts: [
    { id: "flows", title: "Flows", kind: "bar", categories: ["0"], series: [{ name: "Net", values: [1] }] },
    { id: "grid", title: "Sensitivity", kind: "heat", categories: ["0"], series: [{ name: "NPV", values: [1] }] },
  ],
};

function workbook(sheets) {
  return { sheetNames: sheets.map((sheet) => sheet.name), sheets };
}

describe("summaryNumbersCheck", () => {
  it("passes when every numeric KPI is on the Summary sheet", () => {
    const check = summaryNumbersCheck(
      REPORT,
      workbook([{ name: "Summary", values: [139_939_433.6, 15.0165], formulas: [], formulaCells: [] }]),
      amountsMatch,
    );
    expect(check.total).toBe(2);
    expect(check.missing).toEqual([]);
  });

  it("does not ask the workbook for a KPI whose value is a word", () => {
    const check = summaryNumbersCheck(
      REPORT,
      workbook([{ name: "Summary", values: [139_939_433.6, 15.0165], formulas: [], formulaCells: [] }]),
      amountsMatch,
    );
    expect(check.found).toBe(2);
  });

  it("names the KPI the workbook dropped", () => {
    const check = summaryNumbersCheck(
      REPORT,
      workbook([{ name: "Summary", values: [139_939_433.6], formulas: [], formulaCells: [] }]),
      amountsMatch,
    );
    expect(check.missing).toEqual(["IRR = 15.0165"]);
  });

  it("says the sheet is absent rather than scoring zero", () => {
    const check = summaryNumbersCheck(
      REPORT,
      workbook([{ name: "Inputs", values: [], formulas: [], formulaCells: [] }]),
      amountsMatch,
    );
    expect(check.available).toBe(false);
    expect(check.why).toContain('no "Summary" sheet');
  });
});

describe("calcFormulaCheck", () => {
  const calcSheet = (cells) =>
    workbook([{ name: "Calc", values: [], formulas: cells.map((cell) => cell.formula), formulaCells: cells }]);

  it("passes when every formula's cached result is the number the report states", () => {
    const check = calcFormulaCheck(
      REPORT,
      calcSheet([
        { address: "B2", row: 2, column: 2, formula: "NPV(...)", result: 139_939_433.6 },
        { address: "B3", row: 3, column: 2, formula: "IRR(...)", result: 15.0165 },
      ]),
      amountsMatch,
    );
    expect(check.total).toBe(2);
    expect(check.mismatches).toEqual([]);
    expect(check.uncached).toEqual([]);
  });

  it("catches a cached result that disagrees with the screen", () => {
    const check = calcFormulaCheck(
      REPORT,
      calcSheet([{ address: "B2", row: 2, column: 2, formula: "NPV(...)", result: 1 }]),
      amountsMatch,
    );
    expect(check.mismatches[0]).toMatchObject({ address: "B2", expected: 139_939_433.6, cached: 1 });
  });

  it("catches a formula that carries no cached result at all", () => {
    const check = calcFormulaCheck(
      REPORT,
      calcSheet([{ address: "B2", row: 2, column: 2, formula: "NPV(...)", result: Number.NaN }]),
      amountsMatch,
    );
    expect(check.uncached).toHaveLength(1);
    expect(check.cached).toBe(0);
  });
});

describe("chart parts", () => {
  it("expects one chart part per chart that is not a heat grid", () => {
    expect(expectedChartParts(REPORT)).toBe(1);
  });

  it("counts only the chart parts in a deck's file list", () => {
    const names = chartPartNames([
      "ppt/presentation.xml",
      "ppt/charts/chart1.xml",
      "ppt/charts/chart2.xml",
      "ppt/charts/_rels/chart1.xml.rels",
      "ppt/charts/colors1.xml",
      "ppt/charts/chart1.xml",
    ]);
    expect(names).toEqual(["ppt/charts/chart1.xml", "ppt/charts/chart2.xml"]);
  });
});
