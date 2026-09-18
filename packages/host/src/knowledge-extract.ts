/**
 * Turning an uploaded file into indexable text.
 *
 * Split out of `knowledge.ts` so the parsers (and their caps) can be tested on their own and reused by
 * any knowledge backend. Every failure leaves as an `ApiError` with a code the Knowledge page can show:
 * the caller records the reason against the source instead of guessing.
 *
 * Runs entirely offline — `readDocx` is JSZip + xmldom, `extractPdfText` is pdfjs with workers, fetches
 * and font faces disabled, and the formats below those two never covered (.pptx, .xlsx, .odt, .rtf,
 * .epub and friends) go through `file-extract`, which converts them in-process and opens no socket.
 *
 * PDFs and .docx deliberately stay on the parsers above rather than moving to the converter: their
 * output is what the knowledge index, its page markers and its failure codes are built on, and the
 * point of this change is to add formats, not to re-cut every document already indexed.
 *
 * Both parsers are capped the same three ways as the paste and URL paths: input bytes, wall clock, and
 * the number of characters that reach the chunker.
 */
import { ApiError, htmlToText } from "@agentforge/core";
import { DOCX_MAX_INFLATED_BYTES, bodyOrder, declaredInflatedBytes, readDocx } from "@agentforge/core/docx";
import { PDF_MAX_BYTES, PdfExtractError, extractPdfText, type PdfExtractOptions } from "@agentforge/core/pdf";
import { FileExtractError, extractFile } from "./file-extract";
import { KNOWLEDGE_TEXT_MAX_CHARS, capKnowledgeText } from "./knowledge-text";
import { log } from "./log";

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

type SourceKind = "text" | "html" | "pdf" | "docx" | "document";

const HTML_MIMES = new Set(["text/html", "application/xhtml+xml"]);

/**
 * The formats the converter adds. `.pdf` and `.docx` are absent on purpose — they are matched
 * earlier and keep their own parsers.
 */
export const KNOWLEDGE_DOCUMENT_EXTENSIONS = [
  ".pptx",
  ".ppt",
  ".xlsx",
  ".xls",
  ".ods",
  ".odt",
  ".odp",
  ".doc",
  ".rtf",
  ".epub",
] as const;

/**
 * Everything `sourceKind` below says yes to, in one list, so the refusal names exactly what the
 * Knowledge page's picker offers. `apps/web/lib/knowledge-upload.ts` mirrors it and its test reads
 * this file, so a format added here and forgotten there fails the renderer's suite.
 */
export const KNOWLEDGE_FILE_EXTENSIONS = [
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".html",
  ".htm",
  ".pdf",
  ".docx",
  ...KNOWLEDGE_DOCUMENT_EXTENSIONS,
] as const;

function sourceKind(name: string, mime: string): SourceKind | null {
  const lower = name.toLowerCase();
  if (mime === PDF_MIME || lower.endsWith(".pdf")) {
    return "pdf";
  }
  if (mime === DOCX_MIME || lower.endsWith(".docx")) {
    return "docx";
  }
  // Ahead of the `text/*` test on purpose: HTML *is* text, and reading it as text is what put
  // `<script>` bodies into the trusted `## Retrieved sources` block. The extension counts as well as
  // the mime, so a page that arrives as `application/octet-stream` is still read as a page.
  if (HTML_MIMES.has(mime) || lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "html";
  }
  if (KNOWLEDGE_DOCUMENT_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    return "document";
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

/**
 * One `ApiError` code per converter failure, so a source row records *why* it could not be read.
 * `document_needs_ocr` says plainly that nothing was sent anywhere: that is the first question a
 * refused scan raises, and the answer has to be in the sentence itself.
 */
const DOCUMENT_STATUS: Readonly<Record<string, number>> = { too_large: 413 };

function documentFailure(error: FileExtractError): ApiError {
  return new ApiError(`document_${error.code}`, error.message, DOCUMENT_STATUS[error.code] ?? 400);
}

/** Text of any format the converter reads. Caps and format checks are enforced inside it. */
async function documentText(name: string, mime: string, bytes: Buffer): Promise<string> {
  try {
    const extracted = await extractFile({ bytes: new Uint8Array(bytes), filename: name, mime });
    return extracted.text;
  } catch (error) {
    if (error instanceof FileExtractError) {
      throw documentFailure(error);
    }
    log.warn("knowledge_extract_document_conversion_failed", { detail: detailOf(error) });
    throw new ApiError("document_malformed", "That file could not be read (it looks damaged).", 400);
  }
}

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
    log.warn("knowledge_extract_docx_directory_unreadable", { detail: detailOf(error) });
    throw docxFailure("invalid");
  }
  if (declared > (opts.maxInflatedBytes ?? DOCX_MAX_INFLATED_BYTES)) {
    log.warn("knowledge_extract_docx_too_large", { declaredBytes: declared });
    throw docxFailure("too_large");
  }
  try {
    return await withTimeout(readDocx(data), opts.timeoutMs ?? DOCX_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    log.warn("knowledge_extract_docx_parse_failed", { detail: detailOf(error) });
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
    case "document":
      return documentText(name, mime, bytes);
    case "html":
      // The same reader the URL path has always used, so an uploaded page and a fetched page are
      // indexed as the same prose instead of one of them carrying its markup, CSS and scripts.
      return Promise.resolve(htmlToText(bytes.toString("utf8"), { maxChars: KNOWLEDGE_TEXT_MAX_CHARS }).text);
    case "text":
      return Promise.resolve(bytes.toString("utf8"));
    default:
      throw new ApiError(
        "unsupported_content_type",
        `That file type is not indexed. Try ${KNOWLEDGE_FILE_EXTENSIONS.join(" ")}.`,
        400,
      );
  }
}
