import { describe, expect, it } from "vitest";
import { aggregateCashflowLedger, isFinancingCategory } from "./ledger";

/** A month of a bank export, shrunk to the shape that matters: two reversals and one funding round. */
const ROWS = [
  { date: "2024-03-01", category: "Subscription revenue", amount: 50_400 },
  { date: "2024-03-03", category: "Cloud hosting", amount: -15_800 },
  // A vendor refund, booked against the original spend with a positive amount.
  { date: "2024-03-27", category: "Cloud hosting", amount: 3_400 },
  { date: "2024-03-15", category: "Payroll", amount: -212_000 },
  { date: "2024-04-01", category: "Subscription revenue", amount: 53_500 },
  // A churned customer refunded against an inflow category, with a negative amount.
  { date: "2024-04-23", category: "Subscription revenue", amount: -7_200 },
  { date: "2024-04-22", category: "Financing", amount: 2_500_000 },
  { date: "not a date", category: "Opening balance", amount: 1_850_000 },
];

describe("a transaction list read as a cash book", () => {
  it("groups to one figure per month and category", () => {
    const ledger = aggregateCashflowLedger(ROWS);
    expect(ledger.groups.map((group) => `${group.month} ${group.category}`)).toEqual([
      "2024-03 Cloud hosting",
      "2024-03 Payroll",
      "2024-03 Subscription revenue",
      "2024-04 Financing",
      "2024-04 Subscription revenue",
    ]);
    expect(ledger.undated).toBe(1);
  });

  it("keeps the sign the row was written with, so a reversal reduces the spend", () => {
    const ledger = aggregateCashflowLedger(ROWS);
    // -15.800 + 3.400, not -15.800 - 3.400.
    expect(ledger.groups.find((group) => group.category === "Cloud hosting")?.amount).toBe(-12_400);
    expect(ledger.totals[0]).toMatchObject({ month: "2024-03", cashIn: 50_400, cashOut: 224_400 });
  });

  it("keeps financing out of operating cash in", () => {
    const ledger = aggregateCashflowLedger(ROWS);
    const april = ledger.totals.find((total) => total.month === "2024-04");
    expect(april?.cashIn).toBe(46_300);
    expect(april?.financingIn).toBe(2_500_000);
  });
});

describe("what counts as financing", () => {
  it("knows a round, a loan and an owner's money in both languages", () => {
    for (const label of ["Financing", "SAFE note", "Pinjaman bank", "Setoran modal", "Series A funding"]) {
      expect(isFinancingCategory(label), label).toBe(true);
    }
    for (const label of ["Subscription revenue", "Penjualan tunai", "Payroll"]) {
      expect(isFinancingCategory(label), label).toBe(false);
    }
  });
});
