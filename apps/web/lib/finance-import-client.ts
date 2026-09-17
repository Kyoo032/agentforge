import { apiFetch } from "./api-client";
import { mergeFigures } from "./finance-brief";
import {
  parseFinancePii,
  parseFinanceWarnings,
  type FinanceImportWarning,
  type FinancePiiSummary,
} from "./finance-import-warnings";
import { t } from "./i18n";

export type { FinanceImportWarning, FinancePiiSummary };

/** One sheet of an uploaded file, as the host summarises it. */
export type FinanceImportSheet = { name: string; rowCount: number; preview: string[][] };

/** What `POST /api/v1/finance/import` answers: every sheet, the one that was read, and its figures. */
export type FinanceImportResult = {
  sheets: FinanceImportSheet[];
  sheet: string;
  figuresText: string;
  /** What the table reader could not keep. Empty when the whole file made it through. */
  warnings: FinanceImportWarning[];
  /** What the privacy guard hid before the host answered. `count` is 0 when nothing was found. */
  pii: FinancePiiSummary;
  /** A document's prose, already redacted. Empty for a spreadsheet, which has none. */
  proseText: string;
};

/** Mirrors FINANCE_IMPORT_MAX_BYTES on the host. */
export const FINANCE_IMPORT_MAX_BYTES = 25_000_000;
/**
 * The `accept` attribute of the file input, and the extensions checked before an upload starts.
 * Spreadsheets go through SheetJS on the host; the three documents are converted locally, each of
 * their tables becoming a selectable sheet.
 */
export const FINANCE_IMPORT_ACCEPT = ".csv,.xlsx,.xls,.pdf,.docx,.pptx";

const IMPORT_PATH = "/api/v1/finance/import";
/** More tables than anyone would add by hand. A runaway document stops here, as it does on the host. */
export const FINANCE_IMPORT_MAX_SHEETS = 12;
/** Documents are read whole: their tables are chapters of one report, not alternatives to each other. */
const DOCUMENT_EXTENSION = /\.(?:pdf|docx|pptx)$/i;

export function financeImportIsDocument(filename: string): boolean {
  return DOCUMENT_EXTENSION.test(filename.trim());
}
const EXTENSIONS = FINANCE_IMPORT_ACCEPT.split(",");

export function financeImportFileAllowed(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  return EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

function sheetsFrom(value: unknown): FinanceImportSheet[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = (item ?? {}) as { name?: unknown; rowCount?: unknown; preview?: unknown };
    if (typeof record.name !== "string") {
      return [];
    }
    const preview = Array.isArray(record.preview)
      ? record.preview.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []))
      : [];
    return [{ name: record.name, rowCount: typeof record.rowCount === "number" ? record.rowCount : 0, preview }];
  });
}

/** Never trust the wire: a malformed answer reads as "could not be read" rather than half a result. */
export function parseFinanceImport(payload: unknown): FinanceImportResult | null {
  const record = (payload ?? {}) as {
    sheets?: unknown;
    sheet?: unknown;
    figuresText?: unknown;
    warnings?: unknown;
    pii?: unknown;
    proseText?: unknown;
  };
  const sheets = sheetsFrom(record.sheets);
  if (sheets.length === 0 || typeof record.figuresText !== "string") {
    return null;
  }
  const sheet = typeof record.sheet === "string" && record.sheet ? record.sheet : (sheets[0]?.name ?? "");
  // Both are additive: an older host that answers without them reads as "nothing to report".
  return {
    sheets,
    sheet,
    figuresText: record.figuresText,
    warnings: parseFinanceWarnings(record.warnings),
    pii: parseFinancePii(record.pii),
    proseText: typeof record.proseText === "string" ? record.proseText : "",
  };
}

/**
 * Upload one spreadsheet and get the plain figures text back. The file is checked here first so an
 * obvious mistake never leaves the machine; the host checks the same things again, plus magic bytes.
 */
export async function importFinanceFile(file: File, sheet?: string): Promise<FinanceImportResult> {
  if (!financeImportFileAllowed(file.name)) {
    throw new Error(t("finance.upload.errors.type"));
  }
  if (file.size > FINANCE_IMPORT_MAX_BYTES) {
    throw new Error(t("finance.upload.errors.tooLarge", { mb: FINANCE_IMPORT_MAX_BYTES / 1_000_000 }));
  }
  const form = new FormData();
  form.append("file", file, file.name);
  const path = sheet ? `${IMPORT_PATH}?sheet=${encodeURIComponent(sheet)}` : IMPORT_PATH;
  const res = await apiFetch(path, { method: "POST", body: form });
  const payload = await res.json().catch(() => null);
  const fallback = t("finance.upload.errors.failed");
  if (!res.ok) {
    throw new Error(errorMessage(payload, fallback));
  }
  const parsed = parseFinanceImport(payload);
  if (!parsed) {
    throw new Error(fallback);
  }
  return parsed;
}

/**
 * Every table of one file, read one at a time and merged the way the paste box merges two uploads.
 *
 * This is what a document means: an annual report's income statement and its cash position are two
 * chapters of the same figures, and picking one of them was how half a report's rows went missing
 * without anyone being told. A spreadsheet still offers its sheets as alternatives.
 */
export async function importFinanceFileAllSheets(file: File): Promise<FinanceImportResult> {
  const first = await importFinanceFile(file);
  const rest = first.sheets
    .filter((sheet) => sheet.name !== first.sheet)
    .slice(0, FINANCE_IMPORT_MAX_SHEETS - 1);
  let figuresText = first.figuresText;
  const warnings = [...first.warnings];
  for (const sheet of rest) {
    const next = await importFinanceFile(file, sheet.name);
    figuresText = mergeFigures(figuresText, next.figuresText);
    warnings.push(...next.warnings);
  }
  return { ...first, figuresText, warnings };
}
