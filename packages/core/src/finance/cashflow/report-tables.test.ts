import { describe, expect, it } from "vitest";
import { calcDrift, calcFormulaChecks } from "../__fixtures__/calc-formulas";
import { computeCashflow, cashflowInputSchema } from "./compute";
import { calcTable, inputsTable } from "./report-tables";

/**
 * Rows the way they really arrive: some confirmed with a side, some typed by hand with only a
 * category, a bank export's outflow written negative, a loan with no side at all.
 */
const ITEMS = [
  { label: "Saldo awal", period: "", amount: 500, currency: "IDR", category: "cash", kind: "opening" as const },
  { label: "Penjualan", period: "Jan 2025", amount: 1000, currency: "IDR", category: "revenue" },
  { label: "Sewa", period: "Jan 2025", amount: -300, currency: "IDR", category: "opex" },
  { label: "Gaji", period: "Jan 2025", amount: -200, currency: "IDR", category: "opex", kind: "outflow" as const },
  {
    label: "Penjualan",
    period: "Feb 2025",
    amount: 900,
    currency: "IDR",
    category: "revenue",
    kind: "inflow" as const,
  },
  { label: "Sewa", period: "Feb 2025", amount: 300, currency: "IDR", category: "opex", kind: "outflow" as const },
  { label: "Pinjaman bank", period: "Feb 2025", amount: 1000, currency: "IDR", category: "debt" },
];

function tablesFor(params: Record<string, unknown> = {}) {
  const computed = computeCashflow(cashflowInputSchema.parse({ items: ITEMS, params }));
  return { computed, inputs: inputsTable(computed, "en"), calc: calcTable(computed, "en") };
}

describe("the Calc sheet's live formulas", () => {
  it("compute what the report states, from the Inputs sheet the report ships with", () => {
    const { computed, inputs, calc } = tablesFor();
    const checks = calcFormulaChecks(inputs, calc);
    // Both sides of both months, both nets, the financing and every total: none may be left out.
    expect(checks.length).toBeGreaterThanOrEqual(10);
    expect(calcDrift(checks)).toEqual([]);
    expect(computed.periods.map((period) => [period.period, period.cashIn, period.cashOut])).toEqual([
      ["Jan 2025", 1000, 500],
      ["Feb 2025", 900, 300],
    ]);
  });

  it("writes each row on the side the report read it, at the amount the report used", () => {
    const { inputs } = tablesFor();
    expect(inputs.rows.map((row) => [row[0], row[2], row[3]])).toEqual([
      ["Saldo awal", "opening", 500],
      ["Penjualan", "inflow", 1000],
      ["Sewa", "outflow", 300],
      ["Gaji", "outflow", 200],
      ["Penjualan", "inflow", 900],
      ["Sewa", "outflow", 300],
      ["Pinjaman bank", "financing", 1000],
    ]);
  });

  // A typed opening balance beats the sheet's own row, so a SUMIFS over that row would disagree.
  it("gives the opening balance no live formula when the report did not take it from the rows", () => {
    const { calc, inputs } = tablesFor({ openingCash: 800 });
    expect(calcDrift(calcFormulaChecks(inputs, calc))).toEqual([]);
    const opening = calc.rows.findIndex((row) => row[1] === 800);
    expect(opening).toBeGreaterThanOrEqual(0);
    expect(calc.formulas?.[opening]?.[1]).toBeNull();
  });
});
