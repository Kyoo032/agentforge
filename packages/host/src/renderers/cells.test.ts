import { describe, expect, it } from "vitest";
import { FORMULA_ESCAPE, escapeCellText, safeCell, safeReportFilename, safeSheetName } from "./cells";

describe("escapeCellText", () => {
  it("prefixes every cell a spreadsheet would treat as a formula", () => {
    for (const text of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=cmd", "\r-2"]) {
      expect(escapeCellText(text).startsWith(FORMULA_ESCAPE)).toBe(true);
    }
  });

  it("leaves ordinary text, negative-looking words and empty strings alone", () => {
    expect(escapeCellText("Revenue 2026")).toBe("Revenue 2026");
    expect(escapeCellText("")).toBe("");
    expect(escapeCellText("a-b")).toBe("a-b");
  });
});

describe("safeCell", () => {
  it("passes numbers, booleans and null through untouched", () => {
    expect(safeCell(1200)).toBe(1200);
    expect(safeCell(true)).toBe(true);
    expect(safeCell(null)).toBeNull();
  });

  it("escapes strings", () => {
    expect(safeCell("=1+1")).toBe(`${FORMULA_ESCAPE}=1+1`);
  });
});

describe("safeReportFilename", () => {
  it("keeps words and dashes and drops anything a path separator could use", () => {
    expect(safeReportFilename("Margins held/while cash: thinned", "xlsx")).toBe("Margins-heldwhile-cash-thinned.xlsx");
  });

  it("falls back to a stable name and caps the length", () => {
    expect(safeReportFilename("   ", "pptx")).toBe("finance-report.pptx");
    expect(safeReportFilename("x".repeat(200), "md").length).toBeLessThanOrEqual(64);
  });
});

describe("safeSheetName", () => {
  it("drops the characters Excel forbids and caps at 31 characters", () => {
    expect(safeSheetName("Totals: by [period]/*?")).toBe("Totals by period");
    expect(safeSheetName("y".repeat(60))).toHaveLength(31);
  });

  it("falls back when nothing usable is left", () => {
    expect(safeSheetName("[]")).toBe("Sheet");
  });
});
