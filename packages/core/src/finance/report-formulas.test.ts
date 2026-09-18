import { describe, expect, it } from "vitest";
import type { FinanceMetric } from "../artifacts/finance-brief";
import { REPORT_TABLE_FIRST_DATA_ROW } from "./report";
import { calcFormulaMatrix, metricBaseKey, metricFormula } from "./report-formulas";

const PERCENT_BASES = new Set(["gross_margin", "operating_margin", "net_margin"]);

/** One period of the engine's own ladder, in the order `periodLadderMetrics` emits it. */
function ladder(period: string, figures: readonly (readonly [string, number])[]): FinanceMetric[] {
  return figures.map(([base, value]) => ({
    key: period ? `${base} ${period}` : base,
    label: period ? `${base} ${period}` : base,
    value,
    unit: PERCENT_BASES.has(base) ? "%" : "IDR",
    period,
    formula: "engine",
  }));
}

/** 2025 states tax, so its ladder ends after tax; 2026 states none, so it ends at net profit. */
const metrics: FinanceMetric[] = [
  ...ladder("2025", [
    ["revenue", 1000],
    ["cogs", 600],
    ["gross_profit", 400],
    ["gross_margin", 40],
    ["opex", 250],
    ["operating_profit", 150],
    ["operating_margin", 15],
    ["interest_expense", 20],
    ["other_income", 10],
    ["pretax_profit", 140],
    ["tax_expense", 30],
    ["net_profit_after_tax", 110],
    ["net_margin", 11],
  ]),
  ...ladder("2026", [
    ["revenue", 1200],
    ["cogs", 780],
    ["gross_profit", 420],
    ["gross_margin", 35],
    ["opex", 400],
    ["operating_profit", 20],
    ["operating_margin", 1.6666666666666667],
    ["pretax_profit", 20],
    ["net_profit", 20],
    ["net_margin", 1.6666666666666667],
  ]),
  ...ladder("", [["cash", 300]]),
];

const formulas = calcFormulaMatrix(metrics).map((row) => row[1] ?? null);

function rowOf(key: string): number {
  const index = metrics.findIndex((metric) => metric.key === key);
  if (index === -1) {
    throw new Error(`the fixture has no metric ${key}`);
  }
  return index;
}

function formulaFor(key: string): string | null {
  return formulas[rowOf(key)] ?? null;
}

/** The Calc Value cell of a metric's own row, the way a sibling reference addresses it. */
function valueCell(key: string): string {
  return `$B${REPORT_TABLE_FIRST_DATA_ROW + rowOf(key)}`;
}

function sumifs(category: string, key: string): string {
  return `SUMIFS(Inputs!$D:$D,Inputs!$C:$C,"${category}",Inputs!$B:$B,$D${REPORT_TABLE_FIRST_DATA_ROW + rowOf(key)})`;
}

describe("metricBaseKey", () => {
  it("drops the period suffix and leaves a bare key alone", () => {
    expect(metricBaseKey("gross_margin Q1 2026")).toBe("gross_margin");
    expect(metricBaseKey("cash")).toBe("cash");
  });
});

describe("calcFormulaMatrix", () => {
  it("writes the operating margin as (revenue - cogs - opex) / revenue over the Inputs sheet", () => {
    const key = "operating_margin 2026";
    const revenue = sumifs("revenue", key);
    expect(formulaFor(key)).toBe(`IFERROR((${revenue}-${sumifs("cogs", key)}-${sumifs("opex", key)})/${revenue}*100,"")`);
  });

  it("writes the net margin as the net profit cell over the revenue cell of the same period", () => {
    // Interest, other income and tax are roles rather than categories, so no SUMIFS can reach the
    // profit below the operating line: the margin points at the ladder rows beside it instead.
    expect(formulaFor("net_margin 2025")).toBe(
      `IFERROR(${valueCell("net_profit_after_tax 2025")}/${valueCell("revenue 2025")}*100,"")`,
    );
    expect(formulaFor("net_margin 2026")).toBe(
      `IFERROR(${valueCell("net_profit 2026")}/${valueCell("revenue 2026")}*100,"")`,
    );
    expect(formulaFor("net_margin 2025")).not.toContain("SUMIFS");
    expect(formulaFor("net_margin 2025")).not.toBe(formulaFor("operating_margin 2025"));
  });

  it("keeps the operating line on SUMIFS and everything under it on sibling cells", () => {
    const operating = "operating_profit 2026";
    expect(formulaFor(operating)).toBe(
      [sumifs("revenue", operating), sumifs("cogs", operating), sumifs("opex", operating)].join("-"),
    );
    expect(formulaFor("pretax_profit 2025")).toBe(
      `${valueCell("operating_profit 2025")}-${valueCell("interest_expense 2025")}+${valueCell("other_income 2025")}`,
    );
    // 2026 states neither interest nor other income, so its pre-tax profit is the operating profit.
    expect(formulaFor("pretax_profit 2026")).toBe(valueCell("operating_profit 2026"));
    expect(formulaFor("net_profit_after_tax 2025")).toBe(
      `${valueCell("pretax_profit 2025")}-${valueCell("tax_expense 2025")}`,
    );
    expect(formulaFor("net_profit 2026")).toBe(valueCell("pretax_profit 2026"));
  });

  it("leaves the role-based leaves of the ladder as the engine's plain value", () => {
    expect(formulaFor("interest_expense 2025")).toBeNull();
    expect(formulaFor("other_income 2025")).toBeNull();
    expect(formulaFor("tax_expense 2025")).toBeNull();
  });

  it("sums the whole column for a metric that has no period of its own", () => {
    expect(formulaFor("cash")).toBe('SUMIFS(Inputs!$D:$D,Inputs!$C:$C,"cash")');
  });

  it("never inlines a period the user typed as a literal", () => {
    expect(formulas.join("|")).not.toContain('2026"');
    expect(formulas.join("|")).not.toContain('2025"');
  });

  it("fills the Value column and nothing else", () => {
    const matrix = calcFormulaMatrix(metrics);
    expect(matrix[0]).toHaveLength(5);
    expect(matrix[0]?.filter((cell) => cell !== null)).toHaveLength(1);
    expect(matrix[0]?.[0]).toBeNull();
  });
});

describe("metricFormula", () => {
  const orphan: FinanceMetric = {
    key: "net_margin 2027",
    label: "Net margin 2027",
    value: 5,
    unit: "%",
    period: "2027",
    formula: "net profit / revenue",
  };

  it("gives up on a margin whose period states no revenue to divide by", () => {
    expect(metricFormula(orphan, 0, [orphan])).toBeNull();
  });

  it("gives up on a metric no builder knows", () => {
    const irr: FinanceMetric = { key: "irr", label: "IRR", value: null, unit: "%", period: "", formula: "npv = 0" };
    expect(metricFormula(irr, 0, [irr])).toBeNull();
  });

  it("never borrows a sibling that belongs to another period", () => {
    expect(metricFormula(orphan, metrics.length, [...metrics, orphan])).toBeNull();
  });
});
