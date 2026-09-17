/**
 * `POST /api/v1/finance/import` — a CSV, Excel or document upload read into the plain figures text
 * the paste box already takes. Nothing is stored and nothing is computed here: the owner still reads
 * the text, runs the existing parse, and confirms every line item before any number is used.
 *
 * Two readers, on purpose. A `.csv` / `.xlsx` / `.xls` keeps the spreadsheet path unchanged, because
 * that is where the Indonesian thousands-point and period-column logic lives. A `.pdf` / `.docx` /
 * `.pptx` goes through `file-extract`, which converts it locally: each table in the document becomes
 * a selectable "sheet" fed through the same `tableToFiguresText`, and the prose around the tables
 * comes back as `proseText` so figures that were only ever written in a sentence are not lost.
 *
 * The converter opens no socket and a scanned PDF is refused here rather than sent anywhere.
 *
 * The upload convention is the one the dataset and legal routes use: one multipart file under the
 * field `file`, surfaced by the HTTP adapter as `request.files`. Multipart form fields are not
 * surfaced, so a second sheet is chosen with `?sheet=<name>`.
 */
import { ApiError, scanInjection } from "@agentforge/core";
import {
  FINANCE_FIGURES_TEXT_MAX,
  FINANCE_IMPORT_EXTENSIONS,
  FINANCE_IMPORT_MAX_BYTES,
  FinanceImportError,
  financeImportExtension,
  financeWorkbookKind,
  readFinanceTable,
  type FinanceImportExtension,
  type FinanceImportWarning,
  type FinanceSheet,
} from "@agentforge/core/finance";
import { jsonError, jsonOk } from "../errors";
import {
  guardFinanceInput,
  mergeFinancePii,
  redactFinanceSheets,
  type FinancePiiSummary,
} from "../finance-privacy";
import { type ExtractedTable, FileExtractError, extractFile, markdownToText } from "../file-extract";
import type { HostFile, HostRequest, HostResult } from "../types";

/** Rows of each sheet shown back to the owner before they use the figures. */
export const FINANCE_IMPORT_PREVIEW_ROWS = 8;

/** Documents Finance reads as tables plus prose. Everything else still goes through SheetJS. */
export const FINANCE_IMPORT_DOCUMENT_EXTENSIONS = [".pdf", ".docx", ".pptx"] as const;

type FinanceDocumentExtension = (typeof FINANCE_IMPORT_DOCUMENT_EXTENSIONS)[number];

/** Every extension the route takes, spreadsheets first. */
export const FINANCE_IMPORT_ALL_EXTENSIONS = [
  ...FINANCE_IMPORT_EXTENSIONS,
  ...FINANCE_IMPORT_DOCUMENT_EXTENSIONS,
] as const;

const ACCEPTED = FINANCE_IMPORT_ALL_EXTENSIONS.join(", ");
const SIZE_CAP_MB = Math.round(FINANCE_IMPORT_MAX_BYTES / 1_000_000);
const UNREADABLE = "That file could not be read as a table. Open it, save it again as .csv or .xlsx, and try again.";
const INJECTION =
  "That file contains text written as instructions to the assistant, so it was not imported. Open the file and paste the figures you need instead.";
const NO_FIGURES = "No table and no figures were found in that document. Paste the figures you need instead.";
/** The sheet a document with prose but no tables is shown as, so the sentences are still visible. */
const PROSE_SHEET = "Document text";

function financeDocumentExtension(filename: string): FinanceDocumentExtension | null {
  const lower = filename.trim().toLowerCase();
  return FINANCE_IMPORT_DOCUMENT_EXTENSIONS.find((extension) => lower.endsWith(extension)) ?? null;
}

/** The bytes must be what the name claims: an OOXML workbook is a zip, a legacy .xls an OLE file. */
function requireMagicBytes(extension: FinanceImportExtension, bytes: Uint8Array): void {
  const kind = financeWorkbookKind(bytes);
  const wrong =
    (extension === ".xlsx" && kind !== "zip") ||
    (extension === ".xls" && kind === null) ||
    (extension === ".csv" && kind !== null);
  if (wrong) {
    throw new ApiError("unsupported_content_type", `That file is not really a ${extension} file`, 400);
  }
}

type Upload = { readonly file: HostFile; readonly document: FinanceDocumentExtension | null };

function requireImportFile(request: HostRequest): Upload {
  const file = request.files?.find((item) => item.field === "file") ?? request.files?.[0];
  if (!file) {
    throw new ApiError("invalid_request", `Attach one ${ACCEPTED} file under the field "file"`, 400);
  }
  if (file.bytes.byteLength === 0) {
    throw new ApiError("invalid_request", "That file is empty", 400);
  }
  if (file.bytes.byteLength > FINANCE_IMPORT_MAX_BYTES) {
    throw new ApiError("invalid_request", `That file is over the ${SIZE_CAP_MB} MB cap`, 413);
  }
  const document = financeDocumentExtension(file.filename);
  if (document) {
    // `extractFile` reads the real container and refuses a name that lies about it, which is a
    // stronger check than four magic bytes: .docx and .pptx are both zips.
    return { file, document };
  }
  const extension = financeImportExtension(file.filename);
  if (!extension) {
    throw new ApiError("unsupported_content_type", `Only ${ACCEPTED} files can be imported`, 400);
  }
  requireMagicBytes(extension, file.bytes);
  return { file, document: null };
}

function readSheetParam(request: HostRequest): string {
  const fromBody = (request.body ?? null) as { sheet?: unknown } | null;
  const raw = request.query.sheet ?? (typeof fromBody?.sheet === "string" ? fromBody.sheet : "");
  return raw.trim();
}

function pickSheet(sheets: ReadonlyArray<FinanceSheet>, name: string): FinanceSheet {
  const first = sheets[0];
  if (!first) {
    throw new ApiError("invalid_request", "No rows of figures were found in that file", 400);
  }
  if (name === "") {
    return first;
  }
  const chosen = sheets.find((sheet) => sheet.name === name);
  if (!chosen) {
    throw new ApiError("invalid_request", "That sheet is not in this file", 400);
  }
  return chosen;
}

/**
 * The figures text is about to be read back by the model, so an uploaded sheet gets the same guard
 * a knowledge upload gets. The owner's way past a false positive is the paste box, which is untouched.
 */
function requireNoInjection(filename: string, text: string): void {
  if (scanInjection(filename) ?? scanInjection(text)) {
    throw new ApiError("injection_blocked", INJECTION, 400);
  }
}

/** Two tables under the same heading would be indistinguishable in the picker, so names are made unique. */
function uniqueNames(sheets: ReadonlyArray<FinanceSheet>): FinanceSheet[] {
  const seen = new Map<string, number>();
  return sheets.map((sheet) => {
    const used = seen.get(sheet.name) ?? 0;
    seen.set(sheet.name, used + 1);
    return used === 0 ? sheet : { ...sheet, name: `${sheet.name} (${used + 1})` };
  });
}

/** Each table in the document becomes a sheet, named after the heading above it. */
function documentSheets(tables: ReadonlyArray<ExtractedTable>): FinanceSheet[] {
  const named = tables.map((table, index) => ({
    name: table.title?.trim() || `Table ${index + 1}`,
    rows: table.rows.map((row) => [...row]),
  }));
  return uniqueNames(named.filter((sheet) => sheet.rows.length >= 2));
}

/** The prose is figures text in its own right, so it is cut on the same line boundary and cap. */
function capProse(text: string): string {
  const lines = text.split("\n");
  const kept = lines.reduce<{ lines: string[]; length: number }>(
    (acc, line) => {
      const length = acc.length + line.length + (acc.lines.length === 0 ? 0 : 1);
      return length > FINANCE_FIGURES_TEXT_MAX ? acc : { lines: [...acc.lines, line], length };
    },
    { lines: [], length: 0 },
  );
  return kept.lines.join("\n").trim();
}

type ImportPayload = {
  readonly sheets: ReadonlyArray<FinanceSheet>;
  readonly sheet: FinanceSheet;
  readonly figuresText: string;
  readonly proseText: string;
  /** What the table reader could not keep: dropped columns, dropped rows, a cut at the cap. */
  readonly warnings: ReadonlyArray<FinanceImportWarning>;
  /** What the privacy guard hid. Every field above is already the redacted copy. */
  readonly pii: FinancePiiSummary;
};

/**
 * A document with no table at all is still worth importing: an appraisal letter writes its figures
 * in sentences. Those lines are shown as one "sheet" so the preview and the picker keep working,
 * and they are handed over as written rather than squeezed through the table formatter.
 */
function proseOnly(prose: string): ImportPayload {
  // Prose has no columns, so it is redacted as text and the rows are cut from the redacted copy.
  const guarded = guardFinanceInput({ figuresText: prose });
  const rows = guarded.figuresText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => [line]);
  if (rows.length === 0) {
    throw new ApiError("invalid_request", NO_FIGURES, 400);
  }
  const sheet: FinanceSheet = { name: PROSE_SHEET, rows };
  return {
    sheets: [sheet],
    sheet,
    figuresText: guarded.figuresText,
    proseText: guarded.figuresText,
    // Prose has no columns, so the table reader never ran and there is nothing it could have dropped.
    warnings: [],
    pii: guarded.pii,
  };
}

async function readDocument(file: HostFile, wanted: string): Promise<ImportPayload> {
  const extracted = await extractFile({ bytes: file.bytes, filename: file.filename, mime: file.mime });
  const proseText = capProse(markdownToText(extracted.markdown, { withoutTables: true }));
  const sheets = documentSheets(extracted.tables);
  if (sheets.length === 0) {
    return proseOnly(proseText);
  }
  // The figures text is written from the redacted rows, not scrubbed afterwards: a name that became
  // "Karyawan 1" in the table reads as "Karyawan 1" in every line the parse box is handed.
  const guarded = guardFinanceInput({ sheet: pickSheet(sheets, wanted) });
  const prose = guardFinanceInput({ figuresText: proseText });
  return {
    sheets: redactFinanceSheets(sheets),
    sheet: guarded.sheet,
    figuresText: guarded.figuresText,
    proseText: prose.figuresText,
    warnings: guarded.warnings,
    pii: mergeFinancePii(guarded.pii, prose.pii),
  };
}

function readWorkbook(file: HostFile, wanted: string): ImportPayload {
  const { sheets } = readFinanceTable(file.bytes, file.filename);
  const guarded = guardFinanceInput({ sheet: pickSheet(sheets, wanted) });
  return {
    sheets: redactFinanceSheets(sheets),
    sheet: guarded.sheet,
    figuresText: guarded.figuresText,
    proseText: "",
    warnings: guarded.warnings,
    pii: guarded.pii,
  };
}

function sheetSummary(sheet: FinanceSheet) {
  return {
    name: sheet.name,
    rowCount: sheet.rows.length,
    preview: sheet.rows.slice(0, FINANCE_IMPORT_PREVIEW_ROWS).map((row) => [...row]),
  };
}

/** Import failures answer with a sentence the owner can act on; nothing else reaches the client. */
const EXTRACT_FAILURES: Readonly<Record<string, { readonly code: string; readonly status: number }>> = {
  unsupported: { code: "unsupported_content_type", status: 400 },
  format_mismatch: { code: "unsupported_content_type", status: 400 },
  too_large: { code: "invalid_request", status: 413 },
  needs_ocr: { code: "needs_ocr", status: 400 },
  timeout: { code: "timeout", status: 400 },
};

function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof FileExtractError) {
    const mapped = EXTRACT_FAILURES[error.code] ?? { code: "invalid_request", status: 400 };
    return new ApiError(mapped.code, error.message, mapped.status);
  }
  if (error instanceof FinanceImportError) {
    switch (error.code) {
      case "unsupported_type":
        return new ApiError("unsupported_content_type", error.message, 400);
      case "too_large":
        return new ApiError("invalid_request", error.message, 413);
      case "empty":
        return new ApiError("invalid_request", error.message, 400);
      default:
        return new ApiError("invalid_request", UNREADABLE, 400);
    }
  }
  return new ApiError("invalid_request", UNREADABLE, 400);
}

/** Reading a file needs no tenant and touches no store; only the document reader has to await. */
export async function handlePostFinanceImport(request: HostRequest): Promise<HostResult> {
  try {
    const { file, document } = requireImportFile(request);
    const wanted = readSheetParam(request);
    // Everything below is already redacted: the privacy guard runs inside the two readers, so the
    // only copy of the figures that exists past this line is the one the owner is shown.
    const { sheets, sheet, figuresText, proseText, warnings, pii } = document
      ? await readDocument(file, wanted)
      : readWorkbook(file, wanted);
    // Both the figures and the prose are about to be read back by the model, so both are scanned.
    requireNoInjection(file.filename, `${figuresText}\n${proseText}`);
    return jsonOk({
      sheets: sheets.map(sheetSummary),
      sheet: sheet.name,
      figuresText,
      proseText,
      warnings: warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
        detail: [...warning.detail],
      })),
      pii,
    });
  } catch (error) {
    return jsonError(asApiError(error));
  }
}
