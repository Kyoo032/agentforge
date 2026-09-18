import { describe, expect, it } from "vitest";
import { YAYASAN_ITEMS, YAYASAN_PARAMS } from "../budget/__fixtures__/grids";
import { guardNumbers, isFreeNumber } from "../number-guard";
import { FINANCE_TASK_META } from "../tasks";
import { budgetInputSchema, budgetTaskModule } from "./budget";
import type { FinanceTaskProse } from "./types";

const PROSE: FinanceTaskProse = {
  title: "Anggaran vs realisasi 2024",
  sections: [
    { id: "variance-table", heading: "Bacaan selisih", body: "Selisih dihitung per baris." },
    { id: "flagged-lines", heading: "Baris yang ditandai", body: "Sembilan baris lewat batas." },
    { id: "notes", heading: "Catatan", body: "Baris subtotal tidak ikut dihitung." },
  ],
  assumptions: ["Rupiah penuh."],
};

describe("budget task module", () => {
  it("refuses an input the owner has not confirmed", () => {
    expect(budgetInputSchema.safeParse({ items: [] }).success).toBe(false);
    expect(budgetInputSchema.safeParse({}).success).toBe(false);
    expect(budgetInputSchema.parse({ items: YAYASAN_ITEMS }).params).toEqual({});
  });

  it("declares the sections its row in the meta declares", () => {
    expect(budgetTaskModule.sections.map((section) => section.id)).toEqual([...FINANCE_TASK_META.budget.sections]);
    expect(FINANCE_TASK_META.budget.available).toBe(true);
  });

  it("computes in code and builds the report every renderer reads", () => {
    const input = budgetInputSchema.parse({ items: YAYASAN_ITEMS, params: YAYASAN_PARAMS });
    const computed = budgetTaskModule.compute(input);
    const report = budgetTaskModule.buildReport(computed, PROSE, { locale: "id" });
    expect(report.task).toBe("budget");
    expect(report.title).toBe("Anggaran vs realisasi 2024");
    expect(report.locale).toBe("id");
    expect(report.currency).toBe("IDR");
    for (const section of budgetTaskModule.sections) {
      expect(report.notes.some((note) => note.heading === PROSE.sections.find((entry) => entry.id === section.id)?.heading)).toBe(true);
    }
    expect(report.charts.length).toBeGreaterThan(0);
  });

  it("allows every figure its prompt facts print, in both languages", () => {
    const input = budgetInputSchema.parse({ items: YAYASAN_ITEMS, params: YAYASAN_PARAMS });
    const computed = budgetTaskModule.compute(input);
    const allowed = budgetTaskModule.allowedNumbers(input, computed);
    for (const locale of ["id", "en"] as const) {
      const facts = budgetTaskModule.promptFacts(computed, locale);
      const flagged = guardNumbers(facts, allowed).flagged.filter((token) => !isFreeNumber(token));
      expect(flagged.map((token) => token.text), locale).toEqual([]);
    }
  });

  it("reaches nothing outside itself: the same rows give the same numbers every time", () => {
    const input = budgetInputSchema.parse({ items: YAYASAN_ITEMS, params: YAYASAN_PARAMS });
    expect(JSON.stringify(budgetTaskModule.compute(input))).toBe(JSON.stringify(budgetTaskModule.compute(input)));
  });
});
