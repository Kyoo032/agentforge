import { describe, expect, it } from "vitest";
import { KAFE_ITEMS, KAFE_OPENING_CASH, STARTUP_ITEMS, STARTUP_OPENING_CASH } from "./__fixtures__/books";
import { cashflowRowKind, openingCashFromItems, periodInputsFromItems, walkPeriods } from "./periods";
import type { CashflowItem } from "./types";

const row = (over: Partial<CashflowItem>): CashflowItem => ({
  label: "Row",
  period: "Jan",
  amount: 100,
  currency: "",
  category: "other",
  ...over,
});

describe("which side a row is on", () => {
  it("takes the confirmed kind over everything else", () => {
    expect(cashflowRowKind(row({ kind: "financing", category: "revenue", amount: 10 }))).toBe("financing");
  });

  it("reads an unconfirmed row from its category, then its label, then its sign", () => {
    expect(cashflowRowKind(row({ category: "revenue" }))).toBe("inflow");
    expect(cashflowRowKind(row({ category: "opex" }))).toBe("outflow");
    expect(cashflowRowKind(row({ category: "equity" }))).toBe("financing");
    expect(cashflowRowKind(row({ label: "Kas keluar", category: "other" }))).toBe("outflow");
    expect(cashflowRowKind(row({ label: "Bank fee", category: "other", amount: -40 }))).toBe("outflow");
    expect(cashflowRowKind(row({ label: "Saldo awal", category: "cash" }))).toBe("opening");
  });
});

describe("periods from confirmed rows", () => {
  it("keeps the opening balance out of both sides", () => {
    expect(openingCashFromItems(KAFE_ITEMS)).toBe(KAFE_OPENING_CASH);
    const periods = periodInputsFromItems(KAFE_ITEMS);
    expect(periods).toHaveLength(12);
    expect(periods[0]?.cashIn).toBe(92_000_000);
    expect(periods[0]?.cashOut).toBe(88_750_000);
  });

  it("reads an outflow as a magnitude whichever way the book writes it", () => {
    const signed = periodInputsFromItems([
      row({ label: "Cash in", period: "Jan", amount: 500, category: "revenue" }),
      row({ label: "Rent", period: "Jan", amount: -200, category: "opex" }),
    ]);
    expect(signed[0]).toMatchObject({ cashIn: 500, cashOut: 200 });
  });

  it("never lets a subtotal row be added to the parts it totals", () => {
    // The café's own "Arus kas bersih" row is derived; a reader that confirms it as a period row
    // would double every month. The confirmed rows carry the two sides and nothing else.
    const labels = new Set(KAFE_ITEMS.map((item) => item.label));
    expect([...labels].sort()).toEqual(["Saldo awal", "Total kas keluar", "Total kas masuk"]);
  });
});

describe("the running balance", () => {
  it("walks the café's twelve months to 64.200.000", () => {
    const periods = walkPeriods(periodInputsFromItems(KAFE_ITEMS), KAFE_OPENING_CASH);
    expect(periods[0]?.netOperating).toBe(3_250_000);
    expect(periods[0]?.closingCash).toBe(48_250_000);
    expect(periods[6]?.netOperating).toBe(-12_250_000);
    expect(periods[6]?.closingCash).toBe(67_650_000);
    expect(periods.at(-1)?.netOperating).toBe(-14_650_000);
    expect(periods.at(-1)?.closingCash).toBe(64_200_000);
  });

  it("adds financing to the balance and leaves it out of the operating net", () => {
    const periods = walkPeriods(periodInputsFromItems(STARTUP_ITEMS), STARTUP_OPENING_CASH);
    const may = periods[4];
    expect(may?.financingIn).toBe(2_500_000);
    expect(may?.netOperating).toBe(-344_440);
    expect(may?.netTotal).toBe(2_155_560);
    expect(may?.closingCash).toBe(2_929_060);
    expect(periods.at(-1)?.closingCash).toBe(1_491_390);
  });
});
