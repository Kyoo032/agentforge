import { describe, expect, it } from "vitest";
import {
  BUDGET_MATCH_MIN_MARGIN,
  BUDGET_MATCH_MIN_SCORE,
  budgetLabelSimilarity,
  budgetLabelTokens,
  normaliseBudgetLabel,
  trigramScore,
} from "./index";

describe("budget label normalisation", () => {
  it("drops the importer's own tags and flattens punctuation", () => {
    expect(normaliseBudgetLabel("[subtotal] [Pendapatan / Beban] Gaji & tunjangan karyawan")).toBe(
      "gaji tunjangan karyawan",
    );
    expect(normaliseBudgetLabel("Marketing - print & radio")).toBe("marketing print radio");
  });

  it("expands an acronym into the words the other sheet actually writes", () => {
    expect([...budgetLabelTokens("ATK")].sort()).toEqual(["alat", "kantor", "tulis"]);
    expect([...budgetLabelTokens("Alat tulis kantor")].sort()).toEqual(["alat", "kantor", "tulis"]);
  });

  it("folds a synonym onto the token its partner uses", () => {
    expect(budgetLabelTokens("Beban gaji")).toContain("gaji");
    expect(budgetLabelTokens("Gaji & tunjangan karyawan")).toContain("gaji");
    expect(budgetLabelTokens("Listrik, air & internet")).toEqual(["utilitas"]);
  });
});

describe("budget label similarity", () => {
  // Every pair the Indonesian sheet really contains, with the score the matcher has to clear.
  const PAIRS: readonly [string, string][] = [
    ["Donasi individu", "Penerimaan donasi perorangan"],
    ["Hibah korporasi", "Dana hibah perusahaan"],
    ["Pendapatan jasa pelatihan", "Hasil program pelatihan"],
    ["Gaji & tunjangan karyawan", "Beban gaji"],
    ["Program beasiswa", "Penyaluran beasiswa"],
    ["Sewa kantor", "Biaya sewa gedung"],
    ["Listrik, air & internet", "Beban utilitas"],
    ["Perjalanan dinas", "Biaya perjalanan"],
    ["ATK", "Alat tulis kantor"],
    ["Biaya rapat & konsumsi", "Beban konsumsi rapat"],
  ];

  it("scores every real pair above the proposal threshold", () => {
    for (const [budget, actual] of PAIRS) {
      expect(budgetLabelSimilarity(budget, actual).score, `${budget} / ${actual}`).toBeGreaterThanOrEqual(
        BUDGET_MATCH_MIN_SCORE,
      );
    }
  });

  it("leaves the lines that have no partner far below the proposal threshold", () => {
    const strangers: readonly [string, string][] = [
      ["Cadangan dana darurat", "Beban penyusutan inventaris"],
      ["Sewa kantor", "Biaya perbaikan atap kantor"],
      ["ATK", "Biaya perbaikan atap kantor"],
      ["Pendapatan bunga bank", "Hasil program pelatihan"],
    ];
    for (const [budget, actual] of strangers) {
      // Not merely under the bar, but a whole margin under it: no stranger is one rounding away
      // from being proposed, and none can tie with the real partner of the line it shares a word with.
      expect(budgetLabelSimilarity(budget, actual).score, `${budget} / ${actual}`).toBeLessThan(
        BUDGET_MATCH_MIN_SCORE - BUDGET_MATCH_MIN_MARGIN,
      );
    }
  });

  it("calls an identical label exact and a typo a trigram", () => {
    expect(budgetLabelSimilarity("Rent - flagship store", "Rent - flagship store")).toEqual({
      score: 1,
      stage: "exact",
    });
    expect(budgetLabelSimilarity("Depreciation", "Depreciaton").stage).toBe("trigram");
  });

  // Section names repeat across lines on the English sheet; a shared prefix is not a pair.
  it("keeps two distinct lines that share a prefix below the proposal threshold", () => {
    const shared: readonly [string, string][] = [
      ["Marketing - digital ads", "Marketing - print & radio"],
      ["Net sales - flagship store", "Net sales - mall kiosks"],
      ["Rent - flagship store", "Rent - mall kiosks"],
    ];
    for (const [left, right] of shared) {
      expect(budgetLabelSimilarity(left, right).score, `${left} / ${right}`).toBeLessThan(BUDGET_MATCH_MIN_SCORE);
    }
    expect(trigramScore("Insurance", "Insurance")).toBe(1);
  });
});
