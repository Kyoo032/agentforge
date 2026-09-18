import { describe, expect, it } from "vitest";
import { budgetLineNames, budgetTruthPairs, truthFlaggedGroups } from "./run-case.mjs";
import { mergeFigures } from "./stages.mjs";

describe("mergeFigures", () => {
  it("matches the studio's own merge: one newline, nothing doubled", () => {
    expect(mergeFigures("Sheet A\nrow 1", "Sheet B\nrow 2")).toBe("Sheet A\nrow 1\nSheet B\nrow 2");
  });

  it("keeps what is there when the next sheet is empty", () => {
    expect(mergeFigures("Sheet A", "   ")).toBe("Sheet A");
  });

  it("starts from the incoming text when nothing has been added yet", () => {
    expect(mergeFigures("", "Sheet A")).toBe("Sheet A");
    expect(mergeFigures("  \n ", "Sheet A")).toBe("Sheet A");
  });

  it("trims the trailing whitespace the first sheet ended with", () => {
    expect(mergeFigures("Sheet A\n\n\n", "Sheet B")).toBe("Sheet A\nSheet B");
  });
});

describe("budgetTruthPairs", () => {
  it("reads a yearly case's own two labels", () => {
    const pairs = budgetTruthPairs({
      variances: [
        {
          slug: "sewa",
          budgetLabel: "Sewa kantor",
          actualLabel: "Biaya sewa gedung",
          budget: 240,
          actual: 262,
          variance: 22,
        },
      ],
    });
    expect(pairs[0]).toMatchObject({
      budgetLabel: "Sewa kantor",
      actualLabel: "Biaya sewa gedung",
      planned: 240,
      actual: 262,
    });
  });

  it("keeps a one-sided line's missing label as null rather than inventing one", () => {
    const pairs = budgetTruthPairs({
      variances: [{ slug: "bunga", budgetLabel: "Pendapatan bunga bank", actualLabel: null, budget: 25, actual: 0 }],
    });
    expect(pairs[0].actualLabel).toBeNull();
    expect(pairs[0].label).toBe("Pendapatan bunga bank");
  });

  it("does not assert a partner for a case that names only one label per line", () => {
    const pairs = budgetTruthPairs({
      variances: [
        { slug: "kiosks", label: "Net sales - mall kiosks", fullYear: { budget: 840, actual: 822, variance: -18 } },
      ],
    });
    expect(pairs[0]).not.toHaveProperty("actualLabel");
    expect(pairs[0]).toMatchObject({ label: "Net sales - mall kiosks", planned: 840, actual: 822, variance: -18 });
  });

  it("answers null when the case declares no pairs at all", () => {
    expect(budgetTruthPairs({ figures: [] })).toBeNull();
  });
});

describe("truthFlaggedGroups", () => {
  it("reads a yearly case's flat list as one claim about the full period", () => {
    expect(truthFlaggedGroups({ flagged: ["sewa-kantor", "atk"] })).toEqual([
      { period: "full period", ids: ["sewa-kantor", "atk"] },
    ]);
  });

  it("keeps a quarterly case's periods apart rather than flattening them", () => {
    // "ads" in Q1 and "ads" in Q2 are two claims, and a report that flagged it once
    // has answered one of them.
    expect(truthFlaggedGroups({ flagged: { Q1: ["rent", "ads"], Q2: ["ads", "freight"] } })).toEqual([
      { period: "Q1", ids: ["rent", "ads"] },
      { period: "Q2", ids: ["ads", "freight"] },
    ]);
  });

  it("answers null when the case flags nothing", () => {
    expect(truthFlaggedGroups({})).toBeNull();
  });
});

describe("budgetLineNames", () => {
  it("gathers every name a case has for one line, with the slug as an alias", () => {
    const names = budgetLineNames({
      variances: [
        { slug: "cadangan-darurat", budgetLabel: "Cadangan dana darurat", actualLabel: null },
        { slug: "kiosks", label: "Net sales - mall kiosks" },
      ],
    });
    expect(names).toEqual([
      { id: "cadangan-darurat", names: ["Cadangan dana darurat", "cadangan-darurat"] },
      { id: "kiosks", names: ["Net sales - mall kiosks", "kiosks"] },
    ]);
  });

  it("answers an empty index when the case writes no variances", () => {
    expect(budgetLineNames({})).toEqual([]);
  });
});
