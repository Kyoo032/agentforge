/**
 * What runs when the native converter is not there.
 *
 * A packed build for a platform anydoc has no binary for must still read the files it always read.
 * These are the extractors this repository already shipped — pdfjs for PDFs, JSZip + xmldom for
 * .docx, SheetJS for workbooks and CSV, `toString("utf8")` for text — behind one interface, so
 * `extractFile` degrades to yesterday's behaviour instead of failing the upload. Formats that only
 * the converter could ever read (.pptx, .odt, .rtf, .epub) are refused as unsupported, which is
 * exactly what they were before it existed.
 *
 * Everything here is local. Nothing in this file opens a socket.
 */
import { bodyOrder } from "@agentforge/core/docx";
import { PdfExtractError, extractPdfText } from "@agentforge/core/pdf";
import { readFinanceTable } from "@agentforge/core/finance";
import { readDocxUnderCaps } from "../knowledge-extract";
import type { AnydocFormat } from "./anydoc";
import { FileExtractError } from "./errors";
import type { ExtractedTable } from "./markdown-tables";

const CELL_SEPARATOR = " | ";
const PARAGRAPH_SEPARATOR = "\n\n";

/** What a fallback conversion produces: the same two things the converter gives, minus Markdown. */
export type FallbackResult = { readonly text: string; readonly tables: ExtractedTable[] };

/** Injectable so the fallback path can be driven in a test without touching the real parsers. */
export type FallbackExtractors = {
  pdf(bytes: Uint8Array, timeoutMs: number): Promise<FallbackResult>;
  docx(bytes: Uint8Array, timeoutMs: number): Promise<FallbackResult>;
  workbook(bytes: Uint8Array, filename: string): Promise<FallbackResult>;
};

async function pdfFallback(bytes: Uint8Array, timeoutMs: number): Promise<FallbackResult> {
  try {
    const { text } = await extractPdfText(bytes, { timeoutMs });
    return { text, tables: [] };
  } catch (error) {
    throw new FileExtractError(error instanceof PdfExtractError && error.code === "timeout" ? "timeout" : "malformed");
  }
}

/** Paragraphs separated by blank lines, tables as both prose rows and real rows. */
async function docxFallback(bytes: Uint8Array, timeoutMs: number): Promise<FallbackResult> {
  const doc = await readDocxUnderCaps(Buffer.from(bytes), { timeoutMs });
  const items = bodyOrder(doc);
  const tables = items.flatMap((item) =>
    item.kind === "table" ? [{ rows: item.table.rows.map((row) => [...row]) }] : [],
  );
  const text = items
    .flatMap((item) =>
      item.kind === "paragraph" ? [item.paragraph.text] : item.table.rows.map((row) => row.join(CELL_SEPARATOR)),
    )
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(PARAGRAPH_SEPARATOR);
  return { text, tables };
}

function workbookFallback(bytes: Uint8Array, filename: string): Promise<FallbackResult> {
  const { sheets } = readFinanceTable(bytes, filename);
  const tables = sheets.map((sheet) => ({ title: sheet.name, rows: sheet.rows.map((row) => [...row]) }));
  const text = tables
    .map((table) => [table.title, ...table.rows.map((row) => row.join(CELL_SEPARATOR))].join("\n"))
    .join(PARAGRAPH_SEPARATOR);
  return Promise.resolve({ text, tables });
}

/** The parsers this repository already shipped, in the shape `extractFile` falls back to. */
export const DEFAULT_FALLBACK: FallbackExtractors = {
  pdf: pdfFallback,
  docx: docxFallback,
  workbook: workbookFallback,
};

/** Formats the old extractors can read. Everything else was never readable without the converter. */
const FALLBACK_FORMATS = new Set<AnydocFormat>(["pdf", "docx", "xlsx", "csv"]);

export function hasFallback(format: AnydocFormat): boolean {
  return FALLBACK_FORMATS.has(format);
}

export function runFallback(
  extractors: FallbackExtractors,
  format: AnydocFormat,
  bytes: Uint8Array,
  filename: string,
  timeoutMs: number,
): Promise<FallbackResult> {
  switch (format) {
    case "pdf":
      return extractors.pdf(bytes, timeoutMs);
    case "docx":
      return extractors.docx(bytes, timeoutMs);
    case "xlsx":
    case "csv":
      return extractors.workbook(bytes, filename);
    default:
      throw new FileExtractError("unsupported");
  }
}
