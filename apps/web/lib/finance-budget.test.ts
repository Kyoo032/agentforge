import { describe, expect, it } from "vitest";
import type { LineItem, ReportChart } from "@agentforge/core/finance";
import {
  budgetBars,
  budgetConfidence,
  budgetPairRows,
  budgetPairsForRequest,
  budgetPartnerOptions,
  budgetPeriodTables,
  budgetPreview,
  budgetStageGroup,
  budgetTopCandidates,
  budgetUnmatched,
  repairBudgetPair,
  withBudgetThreshold,
  type BudgetProposal,
  type BudgetProposalState,
} from "./finance-budget";

function pair(budgetLabel: string | null, actualLabel: string | null, score = 0.9, stage = "dictionary"): BudgetProposal {
  return { budgetLabel, actualLabel, score, stage };
}

/** The two partners the matcher ranked highest for a line it refused to bind on its own. */
const OFFERED = [
  { label: "Beban penyusutan inventaris", score: 0.44, stage: "embedding" },
  { label: "Alat tulis kantor", score: 0.41, stage: "trigram" },
];

const STATE: BudgetProposalState = {
  budget: [
    { label: "Sewa kantor", kind: "cost", category: "opex" },
    { label: "ATK", kind: "cost", category: "opex" },
    { label: "Donasi individu", kind: "revenue", category: "revenue" },
    { label: "Cadangan dana darurat", kind: "cost", category: "opex" },
  ],
  actual: [
    { label: "Biaya sewa gedung", kind: "cost", category: "opex" },
    { label: "Alat tulis kantor", kind: "cost", category: "opex" },
    { label: "Penerimaan donasi perorangan", kind: "revenue", category: "revenue" },
    { label: "Beban penyusutan inventaris", kind: "cost", category: "opex" },
  ],
  pairs: [
    pair("Sewa kantor", "Biaya sewa gedung"),
    pair("ATK", "Alat tulis kantor", 1, "exact"),
    pair("Donasi individu", "Penerimaan donasi perorangan", 0.5),
    { ...pair("Cadangan dana darurat", null, 0, "ambiguous"), candidates: OFFERED },
    pair(null, "Beban penyusutan inventaris", 0, "unmatched"),
  ],
  periods: ["2024"],
  excluded: [{ label: "Subtotal Pendapatan", reason: "derived" }],
  embedding: "unavailable",
};

describe("the pairing the owner is editing", () => {
  it("shows the matched rows first, then each side's leftovers", () => {
    expect(budgetPairRows(STATE).map((entry) => entry.budgetLabel ?? entry.actualLabel)).toEqual([
      "Sewa kantor",
      "ATK",
      "Donasi individu",
      "Cadangan dana darurat",
      "Beban penyusutan inventaris",
    ]);
    expect(budgetUnmatched(STATE)).toEqual({
      budget: ["Cadangan dana darurat"],
      actual: ["Beban penyusutan inventaris"],
    });
  });

  it("bands the confidence so a weak proposal reads as a question", () => {
    expect(budgetConfidence(pair("a", "b", 1, "exact"))).toBe("high");
    expect(budgetConfidence(pair("a", "b", 0.7))).toBe("medium");
    expect(budgetConfidence(pair("a", "b", 0.45))).toBe("low");
    expect(budgetConfidence(pair("a", null, 0, "unmatched"))).toBe("none");
  });

  // One to one: taking a line that was already bound has to free the line it was bound to.
  it("frees both halves of whatever the re-pairing broke, without mutating the old pairing", () => {
    const before = [...STATE.pairs];
    const next = repairBudgetPair(STATE.pairs, "Cadangan dana darurat", "Alat tulis kantor");
    expect(STATE.pairs).toEqual(before);
    const bound = next.find((entry) => entry.budgetLabel === "Cadangan dana darurat");
    expect(bound).toEqual({
      budgetLabel: "Cadangan dana darurat",
      actualLabel: "Alat tulis kantor",
      score: 1,
      stage: "manual",
    });
    // "ATK" lost its partner and goes back to the budget-only bucket rather than disappearing.
    expect(next.find((entry) => entry.budgetLabel === "ATK")).toEqual({
      budgetLabel: "ATK",
      actualLabel: null,
      score: 0,
      stage: "unmatched",
    });
    expect(next.filter((entry) => entry.actualLabel === "Alat tulis kantor")).toHaveLength(1);
  });

  it("unbinds a pair when the owner picks no partner", () => {
    const next = repairBudgetPair(STATE.pairs, "ATK", null);
    expect(next.find((entry) => entry.budgetLabel === "ATK")?.actualLabel).toBeNull();
    expect(next.filter((entry) => entry.actualLabel === "Alat tulis kantor")).toHaveLength(1);
    expect(next.find((entry) => entry.actualLabel === "Alat tulis kantor")?.budgetLabel).toBeNull();
  });

  it("offers only the free lines of the same kind as partners", () => {
    expect(budgetPartnerOptions(STATE, "Cadangan dana darurat")).toEqual(["Beban penyusutan inventaris"]);
    // A line's own current partner stays on its list, or it could never be re-selected.
    expect(budgetPartnerOptions(STATE, "ATK")).toEqual(["Alat tulis kantor", "Beban penyusutan inventaris"]);
    expect(budgetPartnerOptions(STATE, "Donasi individu")).toEqual(["Penerimaan donasi perorangan"]);
  });

  // The chip says what kind of argument decided the row, not which of four scorers ran.
  it("reads every stage as one of three sentences a person can act on", () => {
    expect(budgetStageGroup("exact")).toBe("exact");
    expect(budgetStageGroup("dictionary")).toBe("synonym");
    expect(budgetStageGroup("trigram")).toBe("synonym");
    expect(budgetStageGroup("embedding")).toBe("meaning");
    expect(budgetStageGroup("manual")).toBe("manual");
    expect(budgetStageGroup("ambiguous")).toBe("ambiguous");
    expect(budgetStageGroup("something new")).toBe("unmatched");
  });

  it("offers an unmatched line only the candidates nobody else has taken", () => {
    // "Alat tulis kantor" is already bound to ATK, so it is not on offer however highly it ranked.
    expect(budgetTopCandidates(STATE, STATE.pairs[3] as BudgetProposal).map((entry) => entry.label)).toEqual([
      "Beban penyusutan inventaris",
    ]);
    // A row that already has a partner is not asking a question, so it offers nothing.
    expect(budgetTopCandidates(STATE, STATE.pairs[0] as BudgetProposal)).toEqual([]);
  });

  it("keeps a line's candidates when a re-pairing pushes it back into the bucket", () => {
    const next = repairBudgetPair(STATE.pairs, "Cadangan dana darurat", null);
    expect(next.find((entry) => entry.budgetLabel === "Cadangan dana darurat")?.candidates).toEqual(OFFERED);
  });

  it("sends the host labels only, and only for pairs that have two sides", () => {
    expect(budgetPairsForRequest(STATE.pairs)).toEqual([
      { budgetLabel: "Sewa kantor", actualLabel: "Biaya sewa gedung" },
      { budgetLabel: "ATK", actualLabel: "Alat tulis kantor" },
      { budgetLabel: "Donasi individu", actualLabel: "Penerimaan donasi perorangan" },
    ]);
  });
});

describe("the thresholds", () => {
  it("drops a limit whose box was cleared rather than sending a NaN", () => {
    expect(withBudgetThreshold({ flagPct: 10, flagAbs: 5 }, "flagAbs", "")).toEqual({ flagPct: 10 });
    expect(withBudgetThreshold({ flagPct: 10 }, "flagAbs", "5000000")).toEqual({ flagPct: 10, flagAbs: 5_000_000 });
    expect(withBudgetThreshold({ flagPct: 10 }, "flagPct", "nonsense")).toEqual({});
  });
});

describe("the variance bars", () => {
  const CHART: ReportChart = {
    id: "variance-bars",
    title: "Selisih per baris",
    kind: "bar",
    categories: ["Sewa kantor", "Program beasiswa", "Perjalanan dinas"],
    series: [
      { name: "ditandai", values: [24_000_000, null, -31_600_000] },
      { name: "dalam batas", values: [null, -15_000_000, null] },
    ],
  };

  it("reads which bar is flagged off the report's own first series", () => {
    const bars = budgetBars(CHART);
    expect(bars.map((bar) => bar.flagged)).toEqual([true, false, true]);
    expect(bars.map((bar) => bar.side)).toEqual(["right", "left", "left"]);
    expect(bars.map((bar) => bar.value)).toEqual([24_000_000, -15_000_000, -31_600_000]);
  });

  it("scales every bar against the largest variance it draws", () => {
    const bars = budgetBars(CHART);
    expect(bars[2]?.widthPercent).toBe(100);
    expect(bars[0]?.widthPercent).toBeCloseTo((24_000_000 / 31_600_000) * 100, 6);
    expect(budgetBars(undefined)).toEqual([]);
  });
});

describe("the report's own tables", () => {
  it("finds the per-period tables and leaves the whole-period one alone", () => {
    const tables = [
      { id: "variance", title: "", columns: [], rows: [] },
      { id: "variance-q1", title: "", columns: [], rows: [] },
      { id: "sections", title: "", columns: [], rows: [] },
    ];
    expect(budgetPeriodTables(tables).map((table) => table.id)).toEqual(["variance-q1"]);
  });
});

describe("what the rows already say", () => {
  const ITEMS: LineItem[] = [
    { label: "Sewa kantor", period: "Anggaran 2024", amount: 240_000_000, currency: "IDR", category: "opex" },
    { label: "Biaya sewa gedung", period: "Realisasi 2024", amount: 264_000_000, currency: "IDR", category: "opex" },
    { label: "Donasi individu", period: "Anggaran 2024", amount: 1_850_000_000, currency: "IDR", category: "revenue" },
    {
      label: "Penerimaan donasi perorangan",
      period: "Realisasi 2024",
      amount: 1_642_500_000,
      currency: "IDR",
      category: "revenue",
    },
  ];

  // The very same core call the host will run, so the panel cannot promise a different answer.
  it("counts the lines, the flags and the leftovers before anything is narrated", () => {
    const preview = budgetPreview(ITEMS, { flagPct: 10, flagAbs: 5_000_000 });
    expect(preview).toEqual({
      lines: 2,
      flagged: 2,
      unmatched: 0,
      periods: ["2024"],
      resultVariance: -231_500_000,
      currency: "IDR",
    });
  });

  it("answers nothing at all when there are no rows to read", () => {
    expect(budgetPreview([], {})).toBeNull();
  });
});
