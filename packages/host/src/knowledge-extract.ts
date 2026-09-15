/**
 * Turning an uploaded file into indexable text.
 *
 * Split out of `knowledge.ts` so the parsers (and their caps) can be tested on their own and reused by
 * any knowledge backend. Every failure leaves as an `ApiError` with a code the Knowledge page can show:
 * the caller records the reason against the source instead of guessing.
 *
 * Runs entirely offline — `readDocx` is JSZip + xmldom, `extractPdfText` is pdfjs with workers, fetches
 * and font faces disabled.
 *
 * Both parsers are capped the same three ways as the paste and URL paths: input bytes, wall clock, and
 * the number of characters that reach the chunker.
 */
import { ApiError } from "@agentforge/core";
import { DOCX_MAX_INFLATED_BYTES, bodyOrder, declaredInflatedBytes, readDocx } from "@agentforge/core/docx";
import { PDF_MAX_BYTES, PdfExtractError, extractPdfText, type PdfExtractOptions } from "@agentforge/core/pdf";
import { capKnowledgeText } from "./knowledge-text";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const PARAGRAPH_SEPARATOR = "\n\n";
const CELL_SEPARATOR = " | ";

/** One upload cap for every format: the PDF limit, applied to .docx too. */
export const KNOWLEDGE_FILE_MAX_BYTES = PDF_MAX_BYTES;
/** Wall clock for one .docx parse, matching the PDF deadline. */
export const DOCX_TIMEOUT_MS = 20_000;

export type DocxExtractOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  maxInflatedBytes?: number;
};

export type ExtractOptions = {
  /** Caps for the PDF parser. Defaults (25 MB / 20 s / 500 pages) apply when omitted. */
  pdf?: PdfExtractOptions;
  /** Caps for the DOCX parser. Defaults (25 MB / 20 s / 100 MB inflated) apply when omitted. */
  docx?: DocxExtractOptions;
};

type SourceKind = "text" | "pdf" | "docx";

function sourceKind(name: string, mime: string): SourceKind | null {
  const lower = name.toLowerCase();
  if (mime === PDF_MIME || lower.endsWith(".pdf")) {
    return "pdf";
  }
  if (mime === DOCX_MIME || lower.endsWith(".docx")) {
    return "docx";
  }
  const textLike =
    mime.startsWith("text/") ||
    mime === "application/json" ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".json");
  return textLike ? "text" : null;
}

const PDF_FAILURES: Record<PdfExtractError["code"], { code: string; message: string }> = {
  no_text_layer: {
    code: "pdf_no_text_layer",
    message: "This PDF has no text layer (scanned image). OCR is not supported yet.",
  },
  too_large: { code: "pdf_too_large", message: "This PDF is too large to index (limit 25 MB)." },
  timeout: { code: "pdf_timeout", message: "This PDF took too long to read and was not indexed." },
  invalid: { code: "pdf_invalid", message: "This PDF could not be read (the file looks damaged)." },
};

const DOCX_FAILURES = {
  too_large: { code: "docx_too_large", message: "This Word file is too large to index (limit 25 MB)." },
  timeout: { code: "docx_timeout", message: "This Word file took too long to read and was not indexed." },
  // Deliberately detail-free: this string is persisted on the source row and shown to the owner, so
  // JSZip / xmldom internals (which quote file bytes) must never reach it. Detail goes to the log.
  invalid: { code: "docx_invalid", message: "This Word file could not be read (the file looks damaged)." },
} as const;

function docxFailure(kind: keyof typeof DOCX_FAILURES): ApiError {
  const mapped = DOCX_FAILURES[kind];
  return new ApiError(mapped.code, mapped.message, 400);
}

async function pdfText(bytes: Buffer, opts: PdfExtractOptions | undefined): Promise<string> {
  try {
    const result = await extractPdfText(new Uint8Array(bytes), opts);
    return result.text;
  } catch (error) {
    if (error instanceof PdfExtractError) {
      const mapped = PDF_FAILURES[error.code];
      throw new ApiError(mapped.code, mapped.message, 400);
    }
    throw new ApiError(PDF_FAILURES.invalid.code, PDF_FAILURES.invalid.message, 400);
  }
}

/** Rejects once the deadline passes. `readDocx` keeps running in the background; nothing consumes it. */
function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(docxFailure("timeout")), Math.max(1, timeoutMs));
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Byte cap, then a declared-inflated-size pre-scan, then the parse itself under a deadline.
 *
 * The pre-scan reads only the zip directory, so a small archive claiming gigabytes of XML is refused
 * before `readDocx` inflates a single part. `read.ts` is untouched: Legal keeps its current behaviour.
 */
export async function readDocxUnderCaps(
  bytes: Buffer,
  opts: DocxExtractOptions,
): Promise<Awaited<ReturnType<typeof readDocx>>> {
  if (bytes.byteLength > (opts.maxBytes ?? KNOWLEDGE_FILE_MAX_BYTES)) {
    throw docxFailure("too_large");
  }
  const data = new Uint8Array(bytes);
  let declared: number;
  try {
    declared = await declaredInflatedBytes(data);
  } catch (error) {
    console.warn(`knowledge-extract: docx zip directory unreadable (${detailOf(error)})`);
    throw docxFailure("invalid");
  }
  if (declared > (opts.maxInflatedBytes ?? DOCX_MAX_INFLATED_BYTES)) {
    console.warn(`knowledge-extract: docx declares ${declared} inflated bytes, refusing to parse`);
    throw docxFailure("too_large");
  }
  try {
    return await withTimeout(readDocx(data), opts.timeoutMs ?? DOCX_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    console.warn(`knowledge-extract: docx parse failed (${detailOf(error)})`);
    throw docxFailure("invalid");
  }
}

function detailOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

/** Paragraphs separated by blank lines, table rows as pipe-joined cells, in body order. */
async function docxText(bytes: Buffer, opts: DocxExtractOptions): Promise<string> {
  const doc = await readDocxUnderCaps(bytes, opts);
  return bodyOrder(doc)
    .flatMap((item) =>
      item.kind === "paragraph" ? [item.paragraph.text] : item.table.rows.map((row) => row.join(CELL_SEPARATOR)),
    )
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(PARAGRAPH_SEPARATOR);
}

/**
 * Extracts indexable text from an uploaded knowledge file.
 *
 * Throws `ApiError` — `unsupported_content_type` for a format we do not read at all, and
 * `pdf_*` / `docx_*` when a supported format fails to parse. The returned text is always within the
 * shared character cap: an over-long document is truncated with a marker, never rejected.
 */
export async function extractText(
  name: string,
  mime: string,
  bytes: Buffer,
  options: ExtractOptions = {},
): Promise<string> {
  return capKnowledgeText(await rawText(name, mime, bytes, options));
}

function rawText(name: string, mime: string, bytes: Buffer, options: ExtractOptions): Promise<string> {
  switch (sourceKind(name, mime)) {
    case "pdf":
      return pdfText(bytes, options.pdf);
    case "docx":
      return docxText(bytes, options.docx ?? {});
    case "text":
      return Promise.resolve(bytes.toString("utf8"));
    default:
      throw new ApiError("unsupported_content_type", "v1 indexes .txt, .md, .csv, .json, .pdf, and .docx only", 400);
  }
}
