import type { Borders, Fill, Font, Worksheet } from "exceljs";
import type { ReportCell, ReportFlagLevel } from "@agentforge/core/finance";

/** Quiet-tool tokens as Office ARGB. Same palette the deck and the document use. */
export const XLSX_COLORS = {
  text: "FF292929",
  header: "FFECECE8",
  accent: "FF0F766E",
  good: "FFE7F4EC",
  watch: "FFFDF0D5",
  risk: "FFFBE4E2",
} as const;

export const XLSX_FONT = "Calibri";
export const NUMBER_FORMAT = "#,##0.####";
const COLUMN_WIDTH_MIN = 12;
const COLUMN_WIDTH_MAX = 42;
const COLUMN_WIDTH_PAD = 2;

export function solidFill(argb: string): Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

export function flagFill(level: ReportFlagLevel): Fill {
  return solidFill(XLSX_COLORS[level]);
}

const HEADER_FONT: Partial<Font> = { name: XLSX_FONT, bold: true, size: 11, color: { argb: XLSX_COLORS.text } };
const HEADER_BORDER: Partial<Borders> = { bottom: { style: "thin", color: { argb: XLSX_COLORS.accent } } };

/** Bold, filled, underlined header row, frozen so it stays put while a reader scrolls. */
export function styleHeaderRow(sheet: Worksheet, rowNumber: number, columns: number): void {
  const row = sheet.getRow(rowNumber);
  for (let index = 1; index <= columns; index += 1) {
    const cell = row.getCell(index);
    cell.font = HEADER_FONT;
    cell.fill = solidFill(XLSX_COLORS.header);
    cell.border = HEADER_BORDER;
  }
  row.commit();
}

export function freezeHeader(sheet: Worksheet, rows: number): void {
  sheet.views = [{ state: "frozen", ySplit: rows }];
}

function cellLength(value: ReportCell): number {
  return value === null ? 0 : String(value).length;
}

/** Widths from the widest cell in each column, clamped so one long note cannot swallow the sheet. */
export function sizeColumns(
  sheet: Worksheet,
  columns: readonly string[],
  rows: readonly (readonly ReportCell[])[],
): void {
  columns.forEach((name, index) => {
    const widest = rows.reduce((max, row) => Math.max(max, cellLength(row[index] ?? null)), name.length);
    sheet.getColumn(index + 1).width = Math.min(
      COLUMN_WIDTH_MAX,
      Math.max(COLUMN_WIDTH_MIN, widest + COLUMN_WIDTH_PAD),
    );
  });
}

/** Conditional formatting so the RAG bands keep working when a reader edits the sheet. */
export function addFlagFormatting(sheet: Worksheet, ref: string): void {
  sheet.addConditionalFormatting({
    ref,
    rules: (["risk", "watch", "good"] as const).map((level, index) => ({
      type: "containsText",
      operator: "containsText",
      text: level,
      priority: index + 1,
      style: { fill: flagFill(level) },
    })),
  });
}
