/**
 * The budget report as the four files the owner actually receives.
 *
 * A report that reads right on screen and drops a figure on the way into the workbook is a wrong
 * report, so the workbook is re-opened here and its numbers are read back out. The Calc sheet is
 * checked as live formulas over Inputs, with the owner's own wording referenced as a cell rather
 * than written into the formula string.
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { budgetInputSchema, budgetReport, computeBudget } from "@agentforge/core/finance";
import { renderReport } from "../renderers/registry";

const ITEMS = [
  { label: "Sewa kantor", period: "Anggaran 2024", amount: 240_000_000, currency: "IDR", category: "opex" as const },
  {
    label: "Biaya sewa gedung",
    period: "Realisasi 2024",
    amount: 264_000_000,
    currency: "IDR",
    category: "opex" as const,
  },
  {
    label: "Donasi individu",
    period: "Anggaran 2024",
    amount: 1_850_000_000,
    currency: "IDR",
    category: "revenue" as const,
  },
  {
    label: "Beban penyusutan inventaris",
    period: "Realisasi 2024",
    amount: 72_000_000,
    currency: "IDR",
    category: "opex" as const,
  },
];

const PROSE = {
  title: "Anggaran vs realisasi",
  sections: [{ id: "notes", heading: "Catatan", body: "Setiap angka dihitung di kode." }],
  assumptions: [],
};

const computed = computeBudget(budgetInputSchema.parse({ items: ITEMS, params: { flagPct: 10, flagAbs: 5_000_000 } }));
const report = budgetReport(computed, PROSE, { locale: "id" });

async function workbookOf(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer as ArrayBuffer);
  return workbook;
}

describe("exporting a budget report", () => {
  it("renders to every format the export menu offers", async () => {
    for (const format of ["xlsx", "pptx", "docx", "md"] as const) {
      const file = await renderReport(report, format);
      expect(file.bytes.byteLength, format).toBeGreaterThan(0);
    }
  });

  it("carries every computed figure into the workbook", async () => {
    const workbook = await workbookOf((await renderReport(report, "xlsx")).bytes);
    const values: number[] = [];
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const raw = cell.value;
          if (typeof raw === "number") {
            values.push(raw);
          } else if (raw && typeof raw === "object" && typeof (raw as { result?: unknown }).result === "number") {
            values.push((raw as { result: number }).result);
          }
        });
      });
    }
    expect(values).toContain(24_000_000);
    expect(values).toContain(-1_850_000_000);
    expect(values).toContain(72_000_000);
    expect(values).toContain(10);
  });

  it("writes the Calc sheet as live formulas that reference cells, never the owner's own words", async () => {
    const workbook = await workbookOf((await renderReport(report, "xlsx")).bytes);
    const calc = workbook.getWorksheet("Calc");
    expect(calc).toBeDefined();
    const formulas: string[] = [];
    calc?.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const raw = cell.value;
        if (raw && typeof raw === "object" && typeof (raw as { formula?: unknown }).formula === "string") {
          formulas.push((raw as { formula: string }).formula);
        }
      });
    });
    expect(formulas.length).toBeGreaterThan(0);
    expect(formulas.some((formula) => formula.startsWith("SUMIFS(Inputs!$D:$D"))).toBe(true);
    for (const formula of formulas) {
      expect(formula).not.toContain("Sewa kantor");
      expect(formula).not.toContain("Anggaran 2024");
    }
  });
});
