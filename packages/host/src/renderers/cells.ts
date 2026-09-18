import type { ReportCell } from "@agentforge/core/finance";

/**
 * A leading apostrophe is how a spreadsheet is told "this is text". Without it a label the user
 * typed - "=1+1", "@SUM(A1)", "-cmd" - is evaluated when the file is opened, which is the standard
 * CSV/XLSX formula-injection path.
 */
export const FORMULA_ESCAPE = "'";

const FORMULA_START = /^\s*[=+\-@]/;

/** A leading NUL or bell hides the trigger from a naive check but not from the spreadsheet. */
function withoutControls(value: string): string {
  return Array.from(value)
    .filter((char) => (char.codePointAt(0) ?? 0) >= 0x20)
    .join("");
}
const FILENAME_MAX = 60;
const SHEET_NAME_MAX = 31;
const FILENAME_FALLBACK = "finance-report";
const SHEET_FALLBACK = "Sheet";
/** Excel rejects these outright in a sheet name. */
const SHEET_FORBIDDEN = /[[\]:*?/\\]+/g;

export function escapeCellText(value: string): string {
  return FORMULA_START.test(withoutControls(value)) ? `${FORMULA_ESCAPE}${value}` : value;
}

/** Any report cell, safe to write into a spreadsheet as a value. */
export function safeCell(value: ReportCell): ReportCell {
  return typeof value === "string" ? escapeCellText(value) : value;
}

export function safeReportFilename(title: string, extension: string): string {
  const base = title
    .trim()
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, FILENAME_MAX);
  return `${base || FILENAME_FALLBACK}.${extension}`;
}

export function safeSheetName(title: string): string {
  const base = title.replace(SHEET_FORBIDDEN, "").trim().slice(0, SHEET_NAME_MAX).trim();
  return base || SHEET_FALLBACK;
}

/** Sheet names must be unique in a workbook; a repeat gets a numeric suffix. */
export function uniqueSheetName(taken: Set<string>, title: string): string {
  const base = safeSheetName(title);
  let name = base;
  let counter = 2;
  while (taken.has(name.toLowerCase())) {
    const suffix = ` ${counter}`;
    name = `${base.slice(0, SHEET_NAME_MAX - suffix.length)}${suffix}`;
    counter += 1;
  }
  taken.add(name.toLowerCase());
  return name;
}
