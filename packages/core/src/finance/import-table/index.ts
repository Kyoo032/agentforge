/**
 * Spreadsheet import for Finance: file bytes in, the same plain figures text the paste box takes out.
 *
 * Nothing here bypasses the existing flow. {@link readFinanceTable} only turns a `.csv` / `.xlsx` /
 * `.xls` upload into rows of strings, and {@link tableToFiguresText} writes those rows as the
 * "label: value" text the parse endpoint already accepts — the owner still reads it, parses it and
 * confirms every row.
 *
 * Split across five modules because one file could not hold it: `limits` (caps, failures, warnings),
 * `numbers` (what a separator means), `periods` (which headers name a period), `layout` (where the
 * header and the blocks are), `derived` (which rows are totals), `long-format` (transaction lists)
 * and `text` (the figures text itself).
 */
export {
  FINANCE_FIGURES_TEXT_MAX,
  FINANCE_IMPORT_EXTENSIONS,
  FINANCE_IMPORT_MAX_BYTES,
  FINANCE_IMPORT_MAX_CELL_CHARS,
  FINANCE_IMPORT_MAX_COLS,
  FINANCE_IMPORT_MAX_ROWS,
  FINANCE_IMPORT_MAX_SHEETS,
  FinanceImportError,
} from "./limits";
export type {
  FinanceFiguresText,
  FinanceImportErrorCode,
  FinanceImportExtension,
  FinanceImportWarning,
  FinanceImportWarningCode,
  FinanceSheet,
  FinanceSheetFact,
  FinanceTableFile,
} from "./limits";

export { isCurrencyCode, isMonthWord } from "./currency";
export { cellValue, magnitudeText, normalizeAmount, sheetNumberStyle, sheetPointStyle } from "./numbers";
export type { NumberStyle, PointStyle } from "./numbers";
export { financePeriodColumns, financePeriodHeaders, isPeriodHeader, isPeriodLabel, ordinalPeriod } from "./periods";
export type { OrdinalPeriod, PeriodColumn } from "./periods";
export { cellKind, findHeaderIndex, isSectionHeading, scoreHeaderRow, sheetFacts, splitBlocks } from "./layout";
export type { CellKind, SheetBlock } from "./layout";
export { DERIVED_RELATIVE_TOLERANCE, isCountLabel, isDerivedLabel, markDerivedRows } from "./derived";
export {
  REGISTER_MIN_AMOUNT_COLUMNS,
  isAmountColumn,
  isRowCounterColumn,
  registerColumns,
  registerNetAt,
  registerSheetPeriod,
  registerShape,
} from "./register";
export type { RegisterColumns, RegisterShape } from "./register";
export { REGISTER_EXTRA_MARK, REGISTER_OPEN, registerSheetLines } from "./register-text";
export { LEDGER_MIN_ROWS, aggregateLedger, ledgerColumns, monthOf } from "./long-format";
export type { Ledger, LedgerColumns, LedgerGroup } from "./long-format";
export { financeImportExtension, financeWorkbookKind, readFinanceTable } from "./read";
export { DERIVED_TAG, financeFiguresFromSheet, tableToFiguresText } from "./text";
