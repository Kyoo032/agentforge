import { describe, expect, it } from "vitest";
import {
  BUDGET_EMBED_MIN_COSINE,
  applyConfirmedPairs,
  calibrateEmbedScore,
  proposeBudgetPairs,
  readBudgetSides,
  type BudgetSimilarity,
} from "./index";
import { YAYASAN_ITEMS } from "./__fixtures__/grids";

const SIDES = readBudgetSides(YAYASAN_ITEMS);

function pairingOf(similarity?: BudgetSimilarity): Map<string, string | null> {
  const { pairs } = proposeBudgetPairs(SIDES.budget, SIDES.actual, { similarity });
  return new Map(
    pairs.filter((pair) => pair.budgetLabel !== null).map((pair) => [pair.budgetLabel as string, pair.actualLabel]),
  );
}

/** A stand-in for the host's embedder: high only for the one pair it is told about. */
function only(left: string, right: string, cosine: number): BudgetSimilarity {
  return (budget, actual) => (budget === left && actual === right ? cosine : 0.1);
}

describe("proposing the pairing", () => {
  // The table in the case README, which is the answer a reader would give by hand.
  it("pairs on meaning rather than on spelling or row order", () => {
    const pairs = pairingOf();
    expect(pairs.get("Donasi individu")).toBe("Penerimaan donasi perorangan");
    expect(pairs.get("Hibah korporasi")).toBe("Dana hibah perusahaan");
    expect(pairs.get("Pendapatan jasa pelatihan")).toBe("Hasil program pelatihan");
    expect(pairs.get("Gaji & tunjangan karyawan")).toBe("Beban gaji");
    expect(pairs.get("Program beasiswa")).toBe("Penyaluran beasiswa");
    expect(pairs.get("Sewa kantor")).toBe("Biaya sewa gedung");
    expect(pairs.get("Listrik, air & internet")).toBe("Beban utilitas");
    expect(pairs.get("Perjalanan dinas")).toBe("Biaya perjalanan");
    expect(pairs.get("ATK")).toBe("Alat tulis kantor");
    expect(pairs.get("Biaya rapat & konsumsi")).toBe("Beban konsumsi rapat");
  });

  it("leaves the four lines that have no partner unmatched rather than pairing them wrongly", () => {
    const { budgetOnly, actualOnly } = proposeBudgetPairs(SIDES.budget, SIDES.actual);
    expect([...budgetOnly].sort()).toEqual(["Cadangan dana darurat", "Pendapatan bunga bank"]);
    expect([...actualOnly].sort()).toEqual(["Beban penyusutan inventaris", "Biaya perbaikan atap kantor"]);
  });

  it("says which stage argued for each pair", () => {
    const { pairs } = proposeBudgetPairs(SIDES.budget, SIDES.actual);
    const atk = pairs.find((pair) => pair.budgetLabel === "ATK");
    expect(atk?.stage).toBe("dictionary");
    expect(atk?.score).toBe(1);
    expect(pairs.find((pair) => pair.budgetLabel === "Cadangan dana darurat")?.stage).toBe("unmatched");
  });

  it("never pairs a revenue line with a cost line", () => {
    const { pairs } = proposeBudgetPairs(SIDES.budget, SIDES.actual);
    const kindOf = (label: string | null): string | undefined =>
      [...SIDES.budget, ...SIDES.actual].find((line) => line.label === label)?.kind;
    for (const pair of pairs) {
      if (pair.budgetLabel && pair.actualLabel) {
        expect(kindOf(pair.budgetLabel), pair.budgetLabel).toBe(kindOf(pair.actualLabel));
      }
    }
  });

  it("offers an unmatched line the best partners still free, so the reader can bind it in one click", () => {
    const { pairs } = proposeBudgetPairs(SIDES.budget, SIDES.actual);
    const loose = pairs.find((pair) => pair.budgetLabel === "Cadangan dana darurat");
    expect(loose?.actualLabel).toBeNull();
    expect((loose?.candidates ?? []).length).toBeGreaterThan(0);
    expect((loose?.candidates ?? []).length).toBeLessThanOrEqual(2);
    // Only lines nobody else took are offered, and only within the same kind.
    for (const candidate of loose?.candidates ?? []) {
      expect(["Beban penyusutan inventaris", "Biaya perbaikan atap kantor"]).toContain(candidate.label);
    }
  });
});

describe("the optional embedding stage", () => {
  it("reads a cosine onto the local scale, below what a dictionary hit is worth", () => {
    expect(calibrateEmbedScore(BUDGET_EMBED_MIN_COSINE - 0.01)).toBe(0);
    expect(calibrateEmbedScore(BUDGET_EMBED_MIN_COSINE)).toBeCloseTo(0.4, 6);
    expect(calibrateEmbedScore(1)).toBeCloseTo(0.9, 6);
    expect(calibrateEmbedScore(Number.NaN)).toBe(0);
  });

  it("may propose a pair the local stages never saw, and says so", () => {
    const pairs = proposeBudgetPairs(SIDES.budget, SIDES.actual, {
      similarity: only("Cadangan dana darurat", "Beban penyusutan inventaris", 0.95),
    }).pairs;
    const bound = pairs.find((pair) => pair.budgetLabel === "Cadangan dana darurat");
    expect(bound?.actualLabel).toBe("Beban penyusutan inventaris");
    expect(bound?.stage).toBe("embedding");
    expect(bound?.score).toBeLessThan(1);
  });

  it("never overrides a pair the local stages already read", () => {
    const pairs = proposeBudgetPairs(SIDES.budget, SIDES.actual, {
      similarity: only("ATK", "Biaya perbaikan atap kantor", 1),
    }).pairs;
    // ATK scores 1 on the dictionary against its real partner, which no calibrated cosine can beat.
    expect(pairs.find((pair) => pair.budgetLabel === "ATK")?.actualLabel).toBe("Alat tulis kantor");
  });

  // The rail that replaces "local evidence only": an embedder that likes everything equally produces
  // ties, and a tie is a question for the reader rather than a pair. Only the lines the dictionary
  // read perfectly survive it, which is exactly the evidence that did not come from the vectors.
  it("invents no pair, and costs no pair, when every label looks equally alike", () => {
    const flat = pairingOf(() => 1);
    // Every pair the local stages read is still read: the local sweep runs before the blend does.
    expect(flat).toEqual(pairingOf());
    const { pairs, budgetOnly } = proposeBudgetPairs(SIDES.budget, SIDES.actual, { similarity: () => 1 });
    expect([...budgetOnly].sort()).toEqual(["Cadangan dana darurat", "Pendapatan bunga bank"]);
    const loose = pairs.find((pair) => pair.budgetLabel === "Cadangan dana darurat");
    expect(loose?.stage).toBe("ambiguous");
    expect(loose?.candidates).toHaveLength(2);
  });

  it("keeps the assignment one-to-one when the embedding likes one line for two", () => {
    const similarity: BudgetSimilarity = (_budget, actual) => (actual === "Beban penyusutan inventaris" ? 0.99 : 0.1);
    const { pairs } = proposeBudgetPairs(SIDES.budget, SIDES.actual, { similarity });
    const bound = pairs.filter((pair) => pair.actualLabel === "Beban penyusutan inventaris");
    expect(bound).toHaveLength(1);
  });
});

describe("the pairing the owner confirmed", () => {
  it("takes an edited pair as given and puts the lines it freed back in the buckets", () => {
    const confirmed = applyConfirmedPairs(SIDES.budget, SIDES.actual, [
      { budgetLabel: "Cadangan dana darurat", actualLabel: "Beban penyusutan inventaris" },
    ]);
    expect(confirmed.pairs[0]).toEqual({
      budgetLabel: "Cadangan dana darurat",
      actualLabel: "Beban penyusutan inventaris",
      score: 1,
      stage: "manual",
    });
    expect(confirmed.budgetOnly).toHaveLength(11);
    expect(confirmed.actualOnly).toHaveLength(11);
  });

  it("drops a pair that names a row this input does not have", () => {
    const confirmed = applyConfirmedPairs(SIDES.budget, SIDES.actual, [
      { budgetLabel: "A line nobody confirmed", actualLabel: "Beban gaji" },
    ]);
    expect(confirmed.pairs.every((pair) => pair.stage === "unmatched")).toBe(true);
    expect(confirmed.actualOnly).toContain("Beban gaji");
  });
});
