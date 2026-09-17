import { describe, expect, it } from "vitest";
import {
  CASHFLOW_ROW_NAMES,
  cashflowRowsFromFolds,
  foldCategories,
  foldPeriodOrder,
  type CashflowCategory,
  type CashflowItem,
} from "@agentforge/core/finance";
import type { FinanceParams } from "./finance-client";
import {
  cashflowClassification,
  normaliseCashflowItems,
  cashflowParamsOf,
  cashflowPeriodRows,
  cashflowPreview,
  openingCashOf,
  withBreakdownSlice,
  withCashflowParams,
  withCategoryBehaviour,
  withPeriodAmount,
} from "./finance-cashflow";

const CATEGORIES: CashflowCategory[] = [
  {
    label: "Penjualan tunai",
    kind: "inflow",
    confidence: 1,
    amounts: [
      { period: "Jan", amount: 100 },
      { period: "Feb", amount: 120 },
    ],
  },
  {
    label: "Pembelian bahan baku",
    kind: "outflow",
    behaviour: "variable",
    confidence: 1,
    amounts: [
      { period: "Jan", amount: 40 },
      { period: "Feb", amount: 50 },
    ],
  },
  {
    label: "Sewa tempat",
    kind: "outflow",
    behaviour: "fixed",
    role: "rent",
    confidence: 1,
    amounts: [
      { period: "Jan", amount: 30 },
      { period: "Feb", amount: 30 },
    ],
  },
];

function book(): CashflowItem[] {
  const rows = cashflowRowsFromFolds({
    order: foldPeriodOrder(CATEGORIES),
    folds: foldCategories(CATEGORIES, false),
    names: CASHFLOW_ROW_NAMES.id,
    currency: "IDR",
    opening: { label: "Saldo awal", amount: 500 },
  });
  return rows.map((row, at) => (at === 0 ? { ...row, classification: CATEGORIES } : row));
}

describe("the periods table", () => {
  it("shows one row per period with both sides and the cost behaviour", () => {
    const rows = cashflowPeriodRows(book());
    expect(rows.map((row) => row.period)).toEqual(["Jan", "Feb"]);
    expect(rows[0]).toMatchObject({ cashIn: 100, cashOut: 70, financingIn: 0 });
    expect(rows[0]?.breakdown).toMatchObject({ variable: 40, fixed: 30, oneOff: 0 });
  });

  it("leaves the opening balance out of the table", () => {
    expect(cashflowPeriodRows(book())).toHaveLength(2);
  });
});

describe("editing a period", () => {
  it("keeps the cost behaviour adding up to the total the reader retyped", () => {
    const next = withPeriodAmount(book(), "Jan", "cashOut", 140);
    const jan = cashflowPeriodRows(next)[0];
    expect(jan?.cashOut).toBe(140);
    // 40 and 30 were 70; doubling the total doubles each slice rather than leaving them stale.
    expect(jan?.breakdown).toMatchObject({ variable: 80, fixed: 60 });
    expect(jan?.breakdown.roles.rent).toBe(60);
  });

  it("never changes the rows it was handed", () => {
    const before = book();
    const snapshot = JSON.stringify(before);
    withPeriodAmount(before, "Jan", "cashIn", 999);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("moves the total with a slice the reader retyped", () => {
    const next = withBreakdownSlice(book(), "Jan", "oneOff", 25);
    const jan = cashflowPeriodRows(next)[0];
    expect(jan?.breakdown.oneOff).toBe(25);
    expect(jan?.cashOut).toBe(95);
  });
});

describe("changing what a category is", () => {
  it("folds every period again, so the breakeven base moves with it", () => {
    const next = withCategoryBehaviour(book(), "Sewa tempat", "oneOff");
    const jan = cashflowPeriodRows(next)[0];
    expect(jan?.breakdown).toMatchObject({ variable: 40, fixed: 0, oneOff: 30 });
    expect(jan?.cashOut).toBe(70);
    expect(cashflowClassification(next).find((entry) => entry.label === "Sewa tempat")).toMatchObject({
      behaviour: "oneOff",
      confidence: 1,
    });
  });

  it("keeps the opening row and the row names", () => {
    const next = withCategoryBehaviour(book(), "Sewa tempat", "oneOff");
    expect(next[0]).toMatchObject({ kind: "opening", label: "Saldo awal", amount: 500 });
    expect(next.some((item) => item.label === "Total kas masuk")).toBe(true);
  });
});

describe("rows that never went through this task's parse", () => {
  /** What the brief's line-item read answers with: a row per category per period, and no `kind`. */
  const loose: CashflowItem[] = [
    { label: "Saldo awal", period: "", amount: 500, currency: "IDR", category: "cash" },
    { label: "Penjualan tunai", period: "Jan", amount: 100, currency: "IDR", category: "revenue" },
    { label: "Penjualan tunai", period: "Feb", amount: 120, currency: "IDR", category: "revenue" },
    { label: "Pembelian bahan baku", period: "Jan", amount: 40, currency: "IDR", category: "cogs" },
    { label: "Sewa tempat", period: "Jan", amount: 30, currency: "IDR", category: "opex" },
  ];

  it("folds them into one row per side per period", () => {
    const rows = cashflowPeriodRows(normaliseCashflowItems(loose, "id"));
    expect(rows.map((row) => row.period)).toEqual(["Jan", "Feb"]);
    expect(rows[0]).toMatchObject({ cashIn: 100, cashOut: 70 });
    expect(rows[1]).toMatchObject({ cashIn: 120, cashOut: 0 });
  });

  it("keeps the cost behaviour the rules found, so breakeven still has a base", () => {
    const rows = cashflowPeriodRows(normaliseCashflowItems(loose, "id"));
    expect(rows[0]?.breakdown).toMatchObject({ variable: 40, fixed: 30, oneOff: 0 });
    expect(rows[0]?.breakdown.roles.rent).toBe(30);
  });

  it("leaves rows this task's parse already shaped alone", () => {
    const shaped = book();
    expect(normaliseCashflowItems(shaped, "id")).toEqual(shaped);
  });
});

describe("the parameter bag", () => {
  const params = {} as FinanceParams;

  it("adds a lever and clears it again", () => {
    const withLever = withCashflowParams(params, { salesLiftPct: 10 });
    expect(cashflowParamsOf(withLever).salesLiftPct).toBe(10);
    const cleared = withCashflowParams(withLever, { salesLiftPct: undefined });
    expect("salesLiftPct" in (cleared as Record<string, unknown>)).toBe(false);
  });

  it("reads the opening balance from the parameter first, then from the book", () => {
    expect(openingCashOf(book(), params)).toBe(500);
    expect(openingCashOf(book(), withCashflowParams(params, { openingCash: 750 }))).toBe(750);
  });
});

describe("the live preview", () => {
  it("runs the same arithmetic the report will", () => {
    const preview = cashflowPreview(book(), withCashflowParams({} as FinanceParams, { salesLiftPct: 10 }));
    expect(preview?.closingCash).toBe(500 + (100 - 70) + (120 - 80));
    expect(preview?.periods.map((period) => period.netOperating)).toEqual([30, 40]);
    // +10% on February's 120 of cash in, with the 50 of variable cost riding along.
    const lastPeriod = preview?.outcomes.find((outcome) => outcome.basis === "lastPeriod");
    expect(lastPeriod?.netOperating).toBeCloseTo(40 + 12 - 5, 9);
  });

  it("waits rather than throwing while there is nothing to read", () => {
    expect(cashflowPreview([], {} as FinanceParams)).toBeNull();
  });
});
