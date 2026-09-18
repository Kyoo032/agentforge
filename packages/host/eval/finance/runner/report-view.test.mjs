import { describe, expect, it } from "vitest";
import { scoreBudgetPairs } from "./budget-pii.mjs";
import { budgetPairsFrom, flaggedLinesFrom } from "./report-view.mjs";

/**
 * The budget report's own variance table, as `packages/core/src/finance/budget/tables.ts`
 * writes it: the money columns declare their currency, and the `Pasangan` / `Partner`
 * column names the ACTUAL-side line the variance was taken against. An empty partner
 * cell is a line that never found one.
 */
const VARIANCE_COLUMNS_ID = [
  "Baris",
  "Anggaran (IDR)",
  "Realisasi (IDR)",
  "Selisih (IDR)",
  "Selisih %",
  "Arah",
  "Tanda",
  "Pasangan",
  "Kecocokan",
  "Bacaan",
];

function varianceRow(label, partner, numbers) {
  return [
    label,
    numbers.budget,
    numbers.actual,
    numbers.variance,
    numbers.variancePct,
    "tidak menguntungkan",
    "ditandai",
    partner,
    "kamus keuangan · 0.82",
    "…",
  ];
}

const DONASI = { budget: 1_850_000_000, actual: 1_642_500_000, variance: -207_500_000, variancePct: -11.216 };
const BUNGA = { budget: 25_000_000, actual: 0, variance: -25_000_000, variancePct: -100 };

function viewOf(rows, columns = VARIANCE_COLUMNS_ID) {
  const tables = [{ id: "variance", title: "Selisih per baris", columns, rows }];
  return { report: { locale: "id", tables }, tables, flags: [] };
}

describe("budgetPairsFrom", () => {
  it("reads the partner column as the actual-side label, not the row's own name", () => {
    const view = viewOf([varianceRow("Donasi individu", "Penerimaan donasi perorangan", DONASI)]);
    expect(budgetPairsFrom(view)[0]).toMatchObject({
      label: "Donasi individu",
      budgetLabel: "Donasi individu",
      actualLabel: "Penerimaan donasi perorangan",
      planned: DONASI.budget,
      actual: DONASI.actual,
      variance: DONASI.variance,
    });
  });

  it("reads an empty partner cell as no partner at all", () => {
    const view = viewOf([varianceRow("Pendapatan bunga bank", "", BUNGA)]);
    expect(budgetPairsFrom(view)[0].actualLabel).toBeNull();
  });

  it("reads an English report's Partner column the same way", () => {
    const columns = [
      "Line item",
      "Budget (USD)",
      "Actual (USD)",
      "Variance (USD)",
      "Variance %",
      "Direction",
      "Flag",
      "Partner",
      "Match",
      "Reading",
    ];
    const row = ["Rent - flagship store", 15_000, 15_500, 500, 3.33, "unfavourable", "flagged", "Store rent", "…", "…"];
    expect(budgetPairsFrom(viewOf([row], columns))[0]).toMatchObject({
      label: "Rent - flagship store",
      actualLabel: "Store rent",
    });
  });

  it("scores a line paired with the wrong partner as a wrong pair", () => {
    const truth = [
      {
        label: "Donasi individu",
        budgetLabel: "Donasi individu",
        actualLabel: "Penerimaan donasi perorangan",
        planned: DONASI.budget,
        actual: DONASI.actual,
        variance: DONASI.variance,
      },
    ];
    // Every number is right; the variance was simply taken against the wrong sheet row.
    const view = viewOf([varianceRow("Donasi individu", "Dana hibah perusahaan", DONASI)]);
    const score = scoreBudgetPairs(truth, budgetPairsFrom(view));
    expect(score.matched).toBe(0);
    expect(score.mismatches[0]).toMatchObject({
      partnerMatches: false,
      stated: { partner: "Dana hibah perusahaan" },
    });
    expect(score.mismatches[0].fields.all).toBe(true);
  });

  it("scores a budget-only line the case says has no partner as right", () => {
    const truth = [
      {
        label: "Pendapatan bunga bank",
        budgetLabel: "Pendapatan bunga bank",
        actualLabel: null,
        planned: BUNGA.budget,
        actual: BUNGA.actual,
        variance: BUNGA.variance,
      },
    ];
    const score = scoreBudgetPairs(truth, budgetPairsFrom(viewOf([varianceRow("Pendapatan bunga bank", "", BUNGA)])));
    expect(score.f1).toBe(1);
    expect(score.mismatches).toEqual([]);
  });

  it("prefers the table that names the partner over an earlier one that does not", () => {
    const bare = {
      id: "variance-q1",
      title: "Selisih per baris — Q1",
      columns: VARIANCE_COLUMNS_ID.slice(0, 7),
      rows: [varianceRow("Donasi individu", "Penerimaan donasi perorangan", DONASI).slice(0, 7)],
    };
    const named = {
      id: "variance",
      title: "Selisih per baris",
      columns: VARIANCE_COLUMNS_ID,
      rows: [varianceRow("Donasi individu", "Penerimaan donasi perorangan", DONASI)],
    };
    const tables = [bare, named];
    const pairs = budgetPairsFrom({ report: { locale: "id", tables }, tables, flags: [] });
    expect(pairs[0].actualLabel).toBe("Penerimaan donasi perorangan");
  });
});

/** The flagged-line table and the count table the budget report writes side by side. */
const FLAG_TABLE = {
  id: "flags",
  title: "Flagged lines by period",
  columns: ["Period", "Line item", "Budget (USD)", "Actual (USD)", "Variance (USD)", "Variance %", "Direction"],
  rows: [
    ["Q1", "Marketing - digital ads", 60_000, 78_000, 18_000, 30, "unfavourable"],
    ["Full period", "Software subscriptions", 48_000, 61_000, 13_000, 27.08, "unfavourable"],
  ],
};
const COUNT_TABLE = {
  id: "flag-counts",
  title: "Flagged-line counts",
  columns: ["Period", "Lines flagged", "Lines compared"],
  rows: [
    ["Q1", 8, 25],
    ["Full period", 8, 25],
  ],
};

describe("flaggedLinesFrom", () => {
  it("names the flagged line under the period it broke in", () => {
    const tables = [FLAG_TABLE, COUNT_TABLE];
    expect(flaggedLinesFrom({ report: { tables }, tables, flags: [] })).toEqual([
      { period: "Q1", label: "Marketing - digital ads" },
      { period: "Full period", label: "Software subscriptions" },
    ]);
  });

  it("does not read the counts table as eight more flagged lines", () => {
    const tables = [COUNT_TABLE];
    expect(flaggedLinesFrom({ report: { tables }, tables, flags: [] })).toEqual([]);
  });

  it("reads the report's own flag sentences when it tables nothing", () => {
    const flags = [
      { level: "watch", text: "$22,300" },
      { level: "risk", text: "Sewa kantor: -207.500.000 (-11,2%) — tidak menguntungkan" },
    ];
    expect(flaggedLinesFrom({ report: { tables: [] }, tables: [], flags })).toEqual([
      { period: "full period", label: "Sewa kantor" },
    ]);
  });
});
