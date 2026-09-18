import { describe, expect, it } from "vitest";
import { extractNumbers, guardNumbers, isFreeNumber } from "../number-guard";
import { CALC_TABLE_ID, INPUTS_TABLE_ID, type FinanceReport, type ReportTable } from "../report";
import { INPUTS_COLUMNS } from "../report-formulas";
import type { FinanceTaskProse } from "../tasks/types";
import {
  budgetAllowedNumbers,
  budgetInputSchema,
  budgetPromptFacts,
  budgetReport,
  computeBudget,
  formatBudgetAmount,
  formatBudgetPercent,
} from "./index";
import { RETAIL_ITEMS, RETAIL_PARAMS, YAYASAN_ITEMS, YAYASAN_PARAMS } from "./__fixtures__/grids";

const PROSE: FinanceTaskProse = {
  title: "Anggaran 2024 melawan realisasinya",
  sections: [
    { id: "variance-table", heading: "Di mana selisihnya", body: "Pendapatan meleset tipis." },
    { id: "flagged-lines", heading: "Baris yang perlu dilihat", body: "Sembilan baris lewat batas." },
    { id: "notes", heading: "Catatan", body: "Angka dihitung di kode." },
  ],
  assumptions: ["Angka dalam rupiah penuh."],
};

function input(items: unknown, params: unknown) {
  return budgetInputSchema.parse({ items, params });
}

function tableOf(report: FinanceReport, id: string): ReportTable {
  const table = report.tables.find((entry) => entry.id === id);
  if (!table) {
    throw new Error(`report has no ${id} table`);
  }
  return table;
}

function numbersIn(report: FinanceReport): number[] {
  const cells = report.tables.flatMap((table) =>
    table.rows.flatMap((row) => row.filter((cell): cell is number => typeof cell === "number")),
  );
  const kpis = report.summary.map((kpi) => kpi.value).filter((value): value is number => typeof value === "number");
  return [...cells, ...kpis];
}

describe("the budget report", () => {
  const computed = computeBudget(input(YAYASAN_ITEMS, YAYASAN_PARAMS));
  const report = budgetReport(computed, PROSE, { locale: "id" });

  it("fills every section the task declares, plus the notes written in code", () => {
    const headings = report.notes.map((note) => note.heading);
    expect(headings.slice(0, 3)).toEqual(["Di mana selisihnya", "Baris yang perlu dilihat", "Catatan"]);
    expect(headings).toContain("Baris yang ditandai");
    expect(headings).toContain("Baris tak berpasangan");
    expect(headings).toContain("Dasar perhitungan");
  });

  // The two unbudgeted costs and the reserve nobody drew down are the point of this report.
  it("names the unmatched lines whether or not the narrator thought to", () => {
    const body = report.notes.map((note) => note.body).join("\n");
    expect(body).toContain("Beban penyusutan inventaris");
    expect(body).toContain("Biaya perbaikan atap kantor");
    expect(body).toContain("Cadangan dana darurat");
  });

  it("never writes the sheet's own subtotal wording into a roll-up", () => {
    const text = [report.title, ...report.notes.map((note) => `${note.heading}\n${note.body}`)].join("\n").toLowerCase();
    expect(text).not.toContain("subtotal pendapatan");
    expect(text).not.toContain("jumlah pengeluaran");
  });

  it("puts the variance table first, so a reader finds a line's two sides before a section's", () => {
    expect(report.tables[0]?.id).toBe("variance");
    const columns = tableOf(report, "variance").columns;
    // Every money column says which money it is; the percent column always did.
    expect(columns.slice(0, 5)).toEqual(["Baris", "Anggaran (IDR)", "Realisasi (IDR)", "Selisih (IDR)", "Selisih %"]);
  });

  // A variance is a variance BETWEEN two rows, and the two sheets spell the same row differently.
  it("names the actual line each budget line was compared against", () => {
    const variance = tableOf(report, "variance");
    const at = variance.columns.indexOf("Pasangan");
    expect(at).toBeGreaterThan(-1);
    expect(variance.rows.find((cells) => cells[0] === "Donasi individu")?.[at]).toBe("Penerimaan donasi perorangan");
    // A budget line nobody spent has no partner, and says so by saying nothing.
    expect(variance.rows.find((cells) => cells[0] === "Pendapatan bunga bank")?.[at]).toBe("");
  });

  // A quarter that flags fifteen lines and a year that flags eight are two different statements.
  it("carries the flag count of every period, not only the whole period's", () => {
    const counts = tableOf(report, "flag-counts");
    expect(counts.rows).toEqual([["Seluruh periode", 9, 14]]);
  });

  it("names the flagged lines rather than only counting them", () => {
    const flags = tableOf(report, "flags");
    expect(flags.columns).toEqual([
      "Periode",
      "Baris",
      "Anggaran (IDR)",
      "Realisasi (IDR)",
      "Selisih (IDR)",
      "Selisih %",
      "Arah",
    ]);
    expect(flags.rows).toHaveLength(9);
    expect(flags.rows.map((cells) => cells[1])).toContain("Cadangan dana darurat");
    expect(flags.rows.every((cells) => cells[0] === "Seluruh periode")).toBe(true);
  });

  it("carries every computed figure as a real number a renderer can read", () => {
    const numbers = numbersIn(report);
    expect(numbers).toContain(-207_500_000);
    expect(numbers).toContain(5_300_000);
    expect(numbers).toContain(-135_450_000);
    expect(numbers).toContain(3_525_000_000);
    expect(numbers).toContain(9);
    expect(numbers).toContain(14);
  });

  it("writes an undefined percent as no number at all rather than as zero", () => {
    const row = tableOf(report, "variance").rows.find((cells) => cells[0] === "Beban penyusutan inventaris");
    expect(row?.[4]).toBeNull();
  });

  it("draws the variance bars with the flagged lines on their own series", () => {
    const chart = report.charts.find((entry) => entry.id === "variance-bars");
    expect(chart?.kind).toBe("bar");
    expect(chart?.series.map((series) => series.name)).toEqual(["ditandai", "dalam batas"]);
    expect(chart?.categories).toHaveLength(12);
  });

  it("flags each line that broke the limit, and says which way it broke", () => {
    expect(report.flags).toHaveLength(9);
    expect(report.flags.filter((flag) => flag.level === "good")).toHaveLength(3);
  });

  it("keeps the inputs sheet in the shape the workbook's formulas address", () => {
    expect(tableOf(report, INPUTS_TABLE_ID).columns).toEqual([...INPUTS_COLUMNS]);
    expect(tableOf(report, INPUTS_TABLE_ID).rows).toHaveLength(YAYASAN_ITEMS.length);
  });

  it("writes the calc sheet as live formulas that reference cells, never the owner's own words", () => {
    const calc = tableOf(report, CALC_TABLE_ID);
    const formulas = (calc.formulas ?? []).flat().filter((entry): entry is string => entry !== null);
    expect(formulas.length).toBeGreaterThan(0);
    expect(formulas[0]).toBe("SUMIFS(Inputs!$D:$D,Inputs!$A:$A,$C2,Inputs!$B:$B,$D2)");
    for (const formula of formulas) {
      expect(formula).not.toContain("Donasi individu");
      expect(formula).not.toContain("Anggaran 2024");
    }
  });
});

describe("the retailer's report", () => {
  const computed = computeBudget(input(RETAIL_ITEMS, RETAIL_PARAMS));
  const report = budgetReport(computed, PROSE, { locale: "en" });

  it("gives each quarter its own table and adds a per-period chart", () => {
    expect(report.tables.map((table) => table.id)).toEqual([
      "variance",
      "variance-q1",
      "variance-q2",
      "variance-q3",
      "variance-q4",
      "sections",
      "flags",
      "flag-counts",
      INPUTS_TABLE_ID,
      CALC_TABLE_ID,
    ]);
    expect(report.charts.map((chart) => chart.id)).toEqual(["variance-bars", "variance-by-period"]);
  });

  it("names a roll-up without borrowing the sheet's own derived row names", () => {
    const text = report.notes.map((note) => `${note.heading}\n${note.body}`).join("\n").toLowerCase();
    expect(text).not.toContain("total revenue");
    expect(text).not.toContain("operating income");
  });

  it("totals each line's quarters on the calc sheet with a range, not with a re-typed label", () => {
    const calc = tableOf(report, CALC_TABLE_ID);
    // Four quarter rows then the line's own total: rows 2..5 on the sheet, total on row 6.
    expect(calc.formulas?.[4]?.[6]).toBe("SUM(G2:G5)");
    expect(calc.rows[4]?.[1]).toBe("Full period");
  });
});

describe("prompt facts and the numbers the guard will take back", () => {
  const confirmed = input(YAYASAN_ITEMS, YAYASAN_PARAMS);
  const computed = computeBudget(confirmed);
  const allowed = budgetAllowedNumbers(confirmed, computed);

  it("shows the model the flagged lines, the roll-ups and the counts, and nothing else", () => {
    const facts = budgetPromptFacts(computed, "id");
    expect(facts).toContain("ATK");
    expect(facts).toContain("Cadangan dana darurat");
    expect(facts).toContain(formatBudgetAmount(5_300_000, "id", "IDR"));
    expect(facts).toContain(formatBudgetPercent(14.722222222222223, "id"));
    // A line inside the limit is named once, in a sentence, not given a row of its own.
    expect(facts).not.toContain("Program beasiswa");
  });

  // The guard is only as honest as this pair: whatever the facts print must also be allowed back.
  it("allows every figure the facts print, in both languages", () => {
    for (const locale of ["id", "en"] as const) {
      const facts = budgetPromptFacts(computed, locale);
      const unverified = guardNumbers(facts, allowed).flagged.filter((token) => !isFreeNumber(token));
      expect(unverified.map((token) => token.text), locale).toEqual([]);
      expect(extractNumbers(facts).length, locale).toBeGreaterThan(10);
    }
  });

  it("allows the confirmed rows and every computed figure", () => {
    expect(allowed).toContain(1_850_000_000);
    expect(allowed).toContain(-207_500_000);
    expect(allowed).toContain(-135_450_000);
    expect(allowed).toContain(9);
  });

  /**
   * The facts print "-Rp 207.500.000"; a narrator writes "di bawah anggaran Rp 207.500.000" and
   * "under budget by Rp 207.500.000". The sign has moved into the word, so the magnitude has to be
   * allowed back or the guard strikes out a figure the report itself computed.
   */
  it("allows a signed figure's magnitude as well, because that is how prose says it", () => {
    expect(allowed).toContain(207_500_000);
    expect(allowed).toContain(135_450_000);
    expect(allowed).toContain(-11.2);
    expect(allowed).toContain(11.2);
  });
});

describe("the retailer's flagged lines, quarter by quarter", () => {
  const computed = computeBudget(input(RETAIL_ITEMS, RETAIL_PARAMS));
  const report = budgetReport(computed, PROSE, { locale: "en" });
  const flags = tableOf(report, "flags");
  const named = (period: string) => flags.rows.filter((cells) => cells[0] === period).map((cells) => cells[1]);

  it("names each quarter's flagged lines, then the full period's", () => {
    expect(flags.columns[0]).toBe("Period");
    expect(named("Q1")).toEqual(["Shipping revenue", "Rent - flagship store"]);
    expect(named("Q4")).toEqual(["Shipping revenue", "Rent - flagship store"]);
    // The year flags a different set: the fee line only breaks the amount limit once summed.
    expect(named("Full period")).toEqual(["Bank & card processing fees", "Rent - flagship store"]);
  });

  /**
   * The row this task exists to find: four quarters that each break the limit in opposite directions
   * and net to nothing over the year. A report that only flags the year loses it entirely.
   */
  it("keeps a line that breaks every quarter but nets to nothing over the year", () => {
    expect(named("Q1")).toContain("Shipping revenue");
    expect(named("Q2")).toContain("Shipping revenue");
    expect(named("Full period")).not.toContain("Shipping revenue");
  });

  it("still carries the counts, so the shape of the year is readable before the detail", () => {
    const counts = tableOf(report, "flag-counts");
    expect(counts.rows.map((cells) => cells[1])).toEqual([2, 2, 2, 2, 2]);
  });
});
