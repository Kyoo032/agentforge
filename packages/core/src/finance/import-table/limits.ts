/**
 * The caps, the typed failure and the typed *warning* every part of the spreadsheet import shares.
 *
 * A warning is the other half of a cap: whenever a column, a row or a line is left out of the
 * figures text the caller gets a `{ code, message, detail }` back so the screen can say "3 columns
 * were not imported" instead of losing them in silence. `message` is developer English; the screen
 * renders its own sentence from `code` and `detail`.
 */

/** Largest upload read as a table (matches the dataset upload cap). */
export const FINANCE_IMPORT_MAX_BYTES = 25_000_000;
/** Most sheets read from one workbook. */
export const FINANCE_IMPORT_MAX_SHEETS = 30;
/** Most rows kept per sheet, header included. */
export const FINANCE_IMPORT_MAX_ROWS = 5_000;
/** Most non-empty columns kept per sheet. */
export const FINANCE_IMPORT_MAX_COLS = 100;
/** Longest single cell kept; anything past this is sheet prose, not a figure. */
export const FINANCE_IMPORT_MAX_CELL_CHARS = 160;
/** Mirrors the host's FIGURES_TEXT_MAX, so the text we hand back is never cut mid-row later. */
export const FINANCE_FIGURES_TEXT_MAX = 12_000;
/** The only extensions Finance imports. */
export const FINANCE_IMPORT_EXTENSIONS = [".csv", ".xlsx", ".xls"] as const;

export type FinanceImportExtension = (typeof FINANCE_IMPORT_EXTENSIONS)[number];

export type FinanceImportErrorCode = "unsupported_type" | "too_large" | "unreadable" | "empty";

/** Typed failure so callers can map a cause to their own user-facing message. */
export class FinanceImportError extends Error {
  readonly code: FinanceImportErrorCode;

  constructor(code: FinanceImportErrorCode, message: string) {
    super(message);
    this.name = "FinanceImportError";
    this.code = code;
  }
}

/**
 * Why something did not reach the figures text.
 * - `dropped_columns` — columns the narrow reader could not name as a label, a period or a value.
 * - `dropped_rows` — rows with no figure in any period column.
 * - `truncated` — the text hit {@link FINANCE_FIGURES_TEXT_MAX} and lines were cut.
 * - `compacted` — a wide sheet was rewritten as `period=value` pairs so it would fit.
 * - `direction_mismatch` — a ledger row whose `direction` label disagrees with the sign of `amount`.
 * - `capped_cells` — cells longer than {@link FINANCE_IMPORT_MAX_CELL_CHARS}, cut to fit.
 * - `pii_amount_restored` — cells the privacy guard redacted although they held a figure, put back.
 */
export type FinanceImportWarningCode =
  | "dropped_columns"
  | "dropped_rows"
  | "truncated"
  | "compacted"
  | "direction_mismatch"
  | "capped_cells"
  | "pii_amount_restored";

export type FinanceImportWarning = {
  readonly code: FinanceImportWarningCode;
  /** Developer English. The screen writes its own sentence from `code` and `detail`. */
  readonly message: string;
  /** What was left out: column names, row labels, a count — whatever the code needs. */
  readonly detail: ReadonlyArray<string>;
};

/** A key/value line that sat above the header ("Saldo awal (1 Jan 2024) | 45.000.000"). */
export type FinanceSheetFact = { readonly label: string; readonly value: string };

export type FinanceSheet = {
  readonly name: string;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  /** Pre-table key/value rows, kept rather than dropped or promoted to the header. */
  readonly facts?: ReadonlyArray<FinanceSheetFact>;
};

export type FinanceTableFile = {
  readonly sheets: ReadonlyArray<FinanceSheet>;
  /** Everything the reader had to leave behind, additive so older callers are unaffected. */
  readonly warnings: ReadonlyArray<FinanceImportWarning>;
};

/** A figures text plus what did not make it into it. */
export type FinanceFiguresText = {
  readonly text: string;
  readonly warnings: ReadonlyArray<FinanceImportWarning>;
};
