import ExcelJS from "exceljs";
import { resolvedProductName } from "@agentforge/core";
import {
  CALC_TABLE_ID,
  INPUTS_TABLE_ID,
  REPORT_TABLE_FIRST_DATA_ROW,
  type FinanceReport,
  type ReportCell,
  type ReportKpi,
  type ReportLocale,
  type ReportTable,
} from "@agentforge/core/finance";
import { safeCell, safeReportFilename, uniqueSheetName } from "./cells";
import { REPORT_MIME, type RenderedFile, type ReportRenderer } from "./types";
import {
  NUMBER_FORMAT,
  XLSX_COLORS,
  XLSX_FONT,
  addFlagFormatting,
  flagFill,
  freezeHeader,
  sizeColumns,
  styleHeaderRow,
} from "./xlsx-style";

export const SUMMARY_SHEET = "Summary";
export const INPUTS_SHEET = "Inputs";
export const CALC_SHEET = "Calc";
/** Columns of the KPI block and of the flags block on the Summary sheet. */
export const SUMMARY_COLUMNS = ["Metric", "Value", "Unit", "Status"] as const;
export const FLAG_COLUMNS = ["Level", "Flag"] as const;

/**
 * What a cell shows when the report has no figure for it — the same words every task's own
 * formatter writes, so a workbook and the screen say "not available" in one voice.
 */
const NO_FIGURE: Readonly<Record<ReportLocale, string>> = Object.freeze({
  id: "tidak tersedia",
  en: "not available",
});

const TITLE_ROW = 1;
const SUBTITLE_ROW = 2;
const KPI_HEADER_ROW = 4;
const BLOCK_GAP = 2;
const TITLE_SIZE = 16;
const BODY_SIZE = 11;

function writeHeader(sheet: ExcelJS.Worksheet, row: number, columns: readonly string[]): void {
  columns.forEach((name, index) => {
    sheet.getCell(row, index + 1).value = name;
  });
  styleHeaderRow(sheet, row, columns.length);
}

/** What one table cell becomes on the sheet: a live formula with its result, or a plain value. */
type CellPlan =
  | { readonly kind: "value"; readonly value: ReportCell }
  | { readonly kind: "formula"; readonly formula: string; readonly result: number | string };

/**
 * A formula is only ever written together with the number the report already computed for it.
 *
 * A formula cell with no cached result is the one thing a workbook must not carry: Protected View,
 * Quick Look, the web viewers and every preview pane show the cache rather than recalculating, so
 * such a cell reads blank until somebody opens the file in Excel and lets it calculate. When the
 * report states no figure the cell says so in the report's own words instead, and the renderer never
 * computes a replacement of its own — a number nobody verified is worse than a word that is true.
 *
 * `stated` is false when the report did not list that cell at all; that is a gap in the report, not
 * an undefined quantity, so it is left blank and reported as a warning.
 */
export function planCell(value: ReportCell, stated: boolean, formula: string | null, missing: string): CellPlan {
  if (!formula) {
    return { kind: "value", value };
  }
  if (typeof value === "number" || (typeof value === "string" && value !== "")) {
    return { kind: "formula", formula, result: value };
  }
  return { kind: "value", value: stated ? missing : null };
}

function writeCell(sheet: ExcelJS.Worksheet, row: number, column: number, plan: CellPlan): void {
  const cell = sheet.getCell(row, column);
  if (plan.kind === "formula") {
    // The engine's own number is cached as the result, so the sheet reads right before a recalculation.
    cell.value = { formula: plan.formula, result: plan.result };
    if (typeof plan.result === "number") {
      cell.numFmt = NUMBER_FORMAT;
    }
  } else {
    cell.value = safeCell(plan.value);
    if (typeof plan.value === "number") {
      cell.numFmt = NUMBER_FORMAT;
    }
  }
  cell.font = { name: XLSX_FONT, size: BODY_SIZE };
}

/** A plain value, the shape the Summary blocks write. */
function writeValue(sheet: ExcelJS.Worksheet, row: number, column: number, value: ReportCell): void {
  writeCell(sheet, row, column, { kind: "value", value });
}

/** One sheet per table: styled header on row 1, values (or live formulas) from row 2 down. */
function addTableSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  table: ReportTable,
  locale: ReportLocale,
  warn: (message: string) => void,
): void {
  const sheet = workbook.addWorksheet(name);
  const missing = NO_FIGURE[locale] ?? NO_FIGURE.en;
  writeHeader(sheet, TITLE_ROW, table.columns);
  table.rows.forEach((row, rowIndex) => {
    const target = REPORT_TABLE_FIRST_DATA_ROW + rowIndex;
    table.columns.forEach((_column, columnIndex) => {
      const formula = table.formulas?.[rowIndex]?.[columnIndex] ?? null;
      const plan = planCell(row[columnIndex] ?? null, columnIndex < row.length, formula, missing);
      if (formula && plan.kind === "value" && plan.value === null) {
        warn(`${name}!${sheet.getCell(target, columnIndex + 1).address}: ${formula}`);
      }
      writeCell(sheet, target, columnIndex + 1, plan);
    });
  });
  sizeColumns(sheet, table.columns, table.rows);
  freezeHeader(sheet, 1);
}

function addTitle(sheet: ExcelJS.Worksheet, report: FinanceReport): void {
  const title = sheet.getCell(TITLE_ROW, 1);
  title.value = safeCell(report.title);
  title.font = { name: XLSX_FONT, bold: true, size: TITLE_SIZE, color: { argb: XLSX_COLORS.text } };
  if (report.subtitle) {
    const subtitle = sheet.getCell(SUBTITLE_ROW, 1);
    subtitle.value = safeCell(report.subtitle);
    subtitle.font = { name: XLSX_FONT, size: BODY_SIZE, color: { argb: XLSX_COLORS.accent } };
  }
}

function addKpiBlock(sheet: ExcelJS.Worksheet, summary: readonly ReportKpi[]): number {
  writeHeader(sheet, KPI_HEADER_ROW, SUMMARY_COLUMNS);
  summary.forEach((kpi, index) => {
    const row = KPI_HEADER_ROW + 1 + index;
    writeValue(sheet, row, 1, kpi.label);
    writeValue(sheet, row, 2, kpi.value);
    writeValue(sheet, row, 3, kpi.unit ?? "");
    writeValue(sheet, row, 4, kpi.flag ?? "");
    if (kpi.flag) {
      sheet.getCell(row, 4).fill = flagFill(kpi.flag);
    }
  });
  return KPI_HEADER_ROW + summary.length;
}

function addFlagBlock(sheet: ExcelJS.Worksheet, report: FinanceReport, afterRow: number): void {
  if (report.flags.length === 0) {
    return;
  }
  const header = afterRow + BLOCK_GAP;
  writeHeader(sheet, header, FLAG_COLUMNS);
  report.flags.forEach((flag, index) => {
    const row = header + 1 + index;
    writeValue(sheet, row, 1, flag.level);
    writeValue(sheet, row, 2, flag.text);
    sheet.getCell(row, 1).fill = flagFill(flag.level);
  });
  addFlagFormatting(sheet, `A${header + 1}:A${header + report.flags.length}`);
}

function summaryRows(report: FinanceReport): ReportCell[][] {
  return [
    ...report.summary.map((kpi) => [kpi.label, kpi.value, kpi.unit ?? "", kpi.flag ?? ""]),
    ...report.flags.map((flag) => [flag.level, flag.text, "", ""]),
  ];
}

function addSummarySheet(workbook: ExcelJS.Workbook, report: FinanceReport): void {
  const sheet = workbook.addWorksheet(SUMMARY_SHEET);
  addTitle(sheet, report);
  addFlagBlock(sheet, report, addKpiBlock(sheet, report.summary));
  sizeColumns(sheet, SUMMARY_COLUMNS, summaryRows(report));
  freezeHeader(sheet, KPI_HEADER_ROW);
}

function sheetNameFor(table: ReportTable, taken: Set<string>): string {
  if (table.id === INPUTS_TABLE_ID) {
    taken.add(INPUTS_SHEET.toLowerCase());
    return INPUTS_SHEET;
  }
  if (table.id === CALC_TABLE_ID) {
    taken.add(CALC_SHEET.toLowerCase());
    return CALC_SHEET;
  }
  return uniqueSheetName(taken, table.title);
}

/**
 * Summary / Inputs / Calc / one sheet per extra table. The Calc sheet carries the engine's math as
 * live formulas over Inputs, so a reader can change a row and watch every metric move with it.
 *
 * Two things make that safe to open anywhere: every formula ships with the result the report already
 * computed, so a viewer that never recalculates still shows the right number, and the workbook asks
 * Excel to recalculate the whole book on open, so a reader who edits a row sees the rest move.
 */
export const renderXlsx: ReportRenderer = async (report: FinanceReport): Promise<RenderedFile> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = resolvedProductName();
  workbook.title = report.title;
  workbook.calcProperties.fullCalcOnLoad = true;
  addSummarySheet(workbook, report);
  const warnings: string[] = [];
  const taken = new Set([SUMMARY_SHEET.toLowerCase()]);
  for (const table of report.tables) {
    addTableSheet(workbook, sheetNameFor(table, taken), table, report.locale, (message) => warnings.push(message));
  }
  if (warnings.length > 0) {
    console.warn(`finance xlsx: ${warnings.length} formula cell(s) had no value in the report: ${warnings.join(", ")}`);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    bytes: new Uint8Array(buffer as ArrayBuffer),
    mime: REPORT_MIME.xlsx,
    filename: safeReportFilename(report.title, "xlsx"),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};
