/**
 * One shared, LOCAL file → Markdown / text pipeline.
 *
 * Every uploaded document — spreadsheet, report, deck, ebook — becomes the same four things: the
 * Markdown the converter produced, that Markdown as plain text, the tables inside it as rows, and a
 * little metadata. Knowledge indexes the text; Finance treats each table as a selectable sheet and
 * the prose as figures that were only ever written in sentences.
 *
 * PRIVACY. Nothing here reaches the network, ever. The converter runs in-process on this machine,
 * `file-extract/anydoc.ts` never passes it an options object (so hosted OCR cannot be reached) and
 * never reads a `FIRECRAWL_*` variable, and a scanned PDF is refused locally with `needs_ocr`
 * instead of being sent anywhere. `privacy.test.ts` proves the sockets stay shut for every format,
 * including that refusal; `no-hosted-ocr.test.ts` greps the repository so it stays that way.
 */
import { FileExtractError, extractDetail, fileExtractErrorFrom } from "./errors";
import {
  FILE_EXTRACT_MAX_BYTES,
  FILE_EXTRACT_MAX_MARKDOWN_CHARS,
  FILE_EXTRACT_MAX_TABLES,
  FILE_EXTRACT_TIMEOUT_MS,
} from "./limits";
import { type AnydocFormat, type AnydocLoader, type AnydocModule, loadAnydoc, toMarkdownUnderDeadline } from "./anydoc";
import { detectFormat } from "./detect";
import { DEFAULT_FALLBACK, type FallbackExtractors, hasFallback, runFallback } from "./fallback";
import { type ExtractedTable, markdownToText, parseMarkdownTables } from "./markdown-tables";

export type { ExtractedTable } from "./markdown-tables";
export type { AnydocFormat, AnydocLoader, AnydocModule } from "./anydoc";
export type { FallbackExtractors, FallbackResult } from "./fallback";
export { FileExtractError, FILE_EXTRACT_COPY } from "./errors";
export type { FileExtractErrorCode } from "./errors";
export { markdownToText, parseMarkdownTables } from "./markdown-tables";
export { detectFormat, extensionOf } from "./detect";
export * from "./limits";

/** Which reader produced the result: the native converter, or the extractors that predate it. */
export type FileExtractEngine = "anydoc" | "fallback";

export type FileExtractMeta = {
  /** Pages, when the reader knew how many. The converter does not report a page count. */
  readonly pages?: number;
  /** Sheets or table-bearing sections, for the formats where that is a meaningful count. */
  readonly sheets?: number;
  /** True when the Markdown was cut at {@link FILE_EXTRACT_MAX_MARKDOWN_CHARS}. */
  readonly truncated: boolean;
  /** Size of the input, as received. */
  readonly bytes: number;
  readonly engine: FileExtractEngine;
};

export type ExtractedFile = {
  readonly format: AnydocFormat;
  readonly markdown: string;
  readonly text: string;
  readonly tables: ExtractedTable[];
  readonly meta: FileExtractMeta;
};

export type ExtractFileInput = {
  readonly bytes: Uint8Array;
  readonly filename: string;
  /** Advisory only. The format is decided by the extension and the bytes, never by a header. */
  readonly mime?: string;
};

export type ExtractFileOptions = {
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  /** Test seam: a loader that throws stands in for a platform with no native binding. */
  readonly loadAnydoc?: AnydocLoader;
  /** Test seam: the extractors used when the binding is missing. */
  readonly fallback?: FallbackExtractors;
};

const PAGE_MARKER = /<!-- page \d+ -->/g;
/** Formats whose tables are sheets, so `meta.sheets` is a count worth reporting. */
const SHEET_FORMATS = new Set<AnydocFormat>(["xlsx", "ods", "csv"]);

function requireReadableSize(bytes: Uint8Array, maxBytes: number): void {
  if (bytes.byteLength === 0) {
    throw new FileExtractError("empty");
  }
  if (bytes.byteLength > maxBytes) {
    throw new FileExtractError("too_large");
  }
}

/** Cut on a line boundary so the last row of a table is never half a row. */
function capMarkdown(markdown: string): { readonly markdown: string; readonly truncated: boolean } {
  if (markdown.length <= FILE_EXTRACT_MAX_MARKDOWN_CHARS) {
    return { markdown, truncated: false };
  }
  const cut = markdown.slice(0, FILE_EXTRACT_MAX_MARKDOWN_CHARS);
  const lastBreak = cut.lastIndexOf("\n");
  return { markdown: lastBreak > 0 ? cut.slice(0, lastBreak) : cut, truncated: true };
}

function sheetCount(format: AnydocFormat, tables: ReadonlyArray<ExtractedTable>): number | undefined {
  return SHEET_FORMATS.has(format) ? tables.length : undefined;
}

/** The binding, or null when this platform has none. A failure is logged once and never rethrown. */
function tryLoad(loader: AnydocLoader): AnydocModule | null {
  try {
    return loader();
  } catch (error) {
    console.warn(`file-extract: native converter unavailable, falling back (${extractDetail(error)})`);
    return null;
  }
}

async function viaAnydoc(
  anydoc: AnydocModule,
  format: AnydocFormat,
  bytes: Uint8Array,
  timeoutMs: number,
): Promise<ExtractedFile> {
  const raw = await toMarkdownUnderDeadline(anydoc, bytes, format, timeoutMs).catch((error: unknown) => {
    throw fileExtractErrorFrom(error);
  });
  const { markdown, truncated } = capMarkdown(raw);
  const tables = parseMarkdownTables(markdown).slice(0, FILE_EXTRACT_MAX_TABLES);
  return {
    format,
    markdown,
    text: markdownToText(markdown),
    tables,
    meta: { truncated, bytes: bytes.byteLength, engine: "anydoc", sheets: sheetCount(format, tables) },
  };
}

async function viaFallback(
  format: AnydocFormat,
  input: ExtractFileInput,
  extractors: FallbackExtractors,
  timeoutMs: number,
): Promise<ExtractedFile> {
  if (!hasFallback(format)) {
    throw new FileExtractError("unsupported");
  }
  const { text, tables } = await runFallback(extractors, format, input.bytes, input.filename, timeoutMs).catch(
    (error: unknown) => {
      throw fileExtractErrorFrom(error);
    },
  );
  const pages = format === "pdf" ? (text.match(PAGE_MARKER)?.length ?? undefined) : undefined;
  return {
    format,
    // The fallback extractors produce text, not Markdown; the text is the honest answer for both.
    markdown: text,
    text,
    tables: [...tables],
    meta: {
      truncated: false,
      bytes: input.bytes.byteLength,
      engine: "fallback",
      sheets: sheetCount(format, tables),
      ...(pages === undefined ? {} : { pages }),
    },
  };
}

/**
 * Read one local file into Markdown, text and tables.
 *
 * Throws {@link FileExtractError} and nothing else: `empty` / `too_large` before a byte is parsed,
 * `unsupported` or `format_mismatch` when the name and the bytes do not agree, `needs_ocr` for a
 * scan, `timeout` past the deadline, and `malformed` / `encrypted` / `resource_limit` /
 * `missing_part` for the ways a document can be unreadable.
 */
export async function extractFile(input: ExtractFileInput, options: ExtractFileOptions = {}): Promise<ExtractedFile> {
  const maxBytes = options.maxBytes ?? FILE_EXTRACT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? FILE_EXTRACT_TIMEOUT_MS;
  requireReadableSize(input.bytes, maxBytes);
  const anydoc = tryLoad(options.loadAnydoc ?? loadAnydoc);
  const format = detectFormat(input.filename, input.bytes, anydoc);
  if (anydoc === null) {
    return viaFallback(format, input, options.fallback ?? DEFAULT_FALLBACK, timeoutMs);
  }
  return viaAnydoc(anydoc, format, input.bytes, timeoutMs);
}
