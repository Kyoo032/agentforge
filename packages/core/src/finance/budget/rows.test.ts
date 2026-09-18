import { describe, expect, it } from "vitest";
import type { LineItem } from "../types";
import { amountIn, isBudgetDerivedLabel, readBudgetScenario, readBudgetSides, tagIn } from "./index";
import { YAYASAN_ITEMS } from "./__fixtures__/grids";

function item(label: string, period: string, amount: number, category: LineItem["category"] = "opex"): LineItem {
  return { label, period, amount, currency: "", category };
}

describe("reading the scenario off a period", () => {
  it("reads both spellings a budget workbook uses and keeps the period underneath", () => {
    expect(readBudgetScenario("Anggaran 2024")).toEqual({ scenario: "budget", period: "2024" });
    expect(readBudgetScenario("Realisasi 2024")).toEqual({ scenario: "actual", period: "2024" });
    expect(readBudgetScenario("Q1 Budget")).toEqual({ scenario: "budget", period: "Q1" });
    expect(readBudgetScenario("Q1 Actual")).toEqual({ scenario: "actual", period: "Q1" });
  });

  it("refuses to guess a period that names neither side", () => {
    expect(readBudgetScenario("2024")).toBeNull();
    expect(readBudgetScenario("Sheet1")).toBeNull();
  });

  it("takes the owner's own naming when the sheet's words do not say", () => {
    expect(readBudgetScenario("Rencana Kerja", { budgetPeriod: "Rencana Kerja" })).toEqual({
      scenario: "budget",
      period: "Kerja",
    });
    expect(readBudgetScenario("Pengeluaran", { actualPeriod: "Pengeluaran" })).toEqual({
      scenario: "actual",
      period: "Pengeluaran",
    });
  });
});

describe("derived rows", () => {
  it("knows a total by its tag, by its name in either language, and by a named result", () => {
    expect(isBudgetDerivedLabel("[subtotal] [Pendapatan] Subtotal Pendapatan")).toBe(true);
    expect(isBudgetDerivedLabel("Jumlah Pengeluaran")).toBe(true);
    expect(isBudgetDerivedLabel("Total revenue")).toBe(true);
    expect(isBudgetDerivedLabel("Operating income")).toBe(true);
    expect(isBudgetDerivedLabel("Gross profit")).toBe(true);
    expect(isBudgetDerivedLabel("Selisih Lebih/(Kurang)")).toBe(true);
    expect(isBudgetDerivedLabel("Surplus/(Defisit) Anggaran")).toBe(true);
  });

  it("leaves a real line alone even when its name starts the same way", () => {
    expect(isBudgetDerivedLabel("Net sales - flagship store")).toBe(false);
    expect(isBudgetDerivedLabel("Donasi individu")).toBe(false);
    expect(isBudgetDerivedLabel("Inventory shrinkage")).toBe(false);
  });
});

describe("reading the two sides", () => {
  it("splits the foundation's two sheets and lines them up on one period", () => {
    const sides = readBudgetSides(YAYASAN_ITEMS);
    expect(sides.periods).toEqual(["2024"]);
    expect(sides.budget).toHaveLength(12);
    expect(sides.actual).toHaveLength(12);
    expect(amountIn(sides.budget.find((line) => line.label === "ATK") ?? null, "2024")).toBe(36_000_000);
    expect(sides.budget.filter((line) => line.kind === "revenue")).toHaveLength(4);
    expect(sides.actual.filter((line) => line.kind === "revenue")).toHaveLength(3);
  });

  /**
   * The sheet said "Anggaran 2024" and that is the row's period. What the two sides are LINED UP on
   * is the year underneath, which is the only thing a budget row and an actual row have in common.
   */
  it("keeps each row's own period as the sheet wrote it and compares on the year underneath", () => {
    const sides = readBudgetSides(YAYASAN_ITEMS);
    const atk = sides.budget.find((line) => line.label === "ATK") ?? null;
    const stationery = sides.actual.find((line) => line.label === "Alat tulis kantor") ?? null;
    expect(atk?.amounts).toEqual([{ period: "Anggaran 2024", on: "2024", amount: 36_000_000 }]);
    expect(stationery?.amounts[0]?.period).toBe("Realisasi 2024");
    expect(tagIn(atk, "2024")).toBe("Anggaran 2024");
    expect(tagIn(stationery, "2024")).toBe("Realisasi 2024");
  });

  it("sets a subtotal aside by name rather than adding it to its own parts", () => {
    const sides = readBudgetSides([
      ...YAYASAN_ITEMS,
      item("Subtotal Pendapatan", "Anggaran 2024", 3_525_000_000, "revenue"),
      item("Jumlah Pengeluaran", "Realisasi 2024", 2_966_950_000),
    ]);
    expect(sides.budget).toHaveLength(12);
    expect(sides.actual).toHaveLength(12);
    expect(sides.excluded.map((row) => row.label)).toContain("Subtotal Pendapatan");
    expect(sides.excluded.map((row) => row.label)).toContain("Jumlah Pengeluaran");
  });

  // Arithmetic, not spelling: a row that equals the sum of the others is a total in any language.
  it("sets aside a total whose name gives nothing away", () => {
    const rows: LineItem[] = [
      item("Alfa", "Anggaran 2024", 100, "revenue"),
      item("Beta", "Anggaran 2024", 200, "revenue"),
      item("Gamma", "Anggaran 2024", 300, "revenue"),
      item("Delta", "Anggaran 2024", 400, "revenue"),
      item("Rekapitulasi", "Anggaran 2024", 1000, "revenue"),
    ];
    const sides = readBudgetSides(rows);
    expect(sides.budget.map((line) => line.label)).toEqual(["Alfa", "Beta", "Gamma", "Delta"]);
    expect(sides.excluded).toEqual([{ label: "Rekapitulasi", period: "Anggaran 2024", reason: "derived" }]);
  });

  it("names a row it cannot place instead of guessing a side for it", () => {
    const sides = readBudgetSides([...YAYASAN_ITEMS, item("Biaya tak terduga", "2024", 1_000_000)]);
    expect(sides.excluded).toContainEqual({ label: "Biaya tak terduga", period: "2024", reason: "unplaced" });
    expect(sides.budget).toHaveLength(12);
    expect(sides.actual).toHaveLength(12);
  });
});
