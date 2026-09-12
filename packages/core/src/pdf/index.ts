/**
 * Offline PDF text extraction.
 *
 * pdfjs-dist is pure JavaScript: no native module, no worker download, no network at runtime.
 * Workers, `eval`, font faces and remote font data are all switched off inside the parse so it is a
 * bounded, local, CPU-only operation. Every call is capped three ways — bytes, wall clock, page
 * count — because the bytes come from an upload.
 *
 * Page markers (`<!-- page N -->`) stay in the returned text so a later citation can name the page it
 * came from; the knowledge chunker treats them as ordinary text.
 *
 * Isolation: the parse runs in a fresh worker thread (`./worker.ts` + `./worker-source.ts`) and the
 * deadline lives in the parent, so a hang inside one synchronous stretch of pdfjs is still killable —
 * `terminate()` stops the worker mid-instruction at the deadline instead of waiting for an event loop
 * the parse is hogging. The worker checks the same deadline between pages too, so a normal overrun
 * exits on its own before the parent's kill lands.
 *
 * Fallback: when no pdfjs module exists on disk for a worker to import (the packaged host bundle
 * inlines it), extraction falls back to reading the document on the calling thread — the
 * pre-isolation behaviour, bounded between awaits and killable only there. Tests, dev and any host
 * that ships pdfjs on disk get the worker.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PdfExtractError } from "./errors";
import { pdfjsEntryUrl, runWorkerTask } from "./worker";
import { PDF_WORKER_SOURCE } from "./worker-source";

export { PdfExtractError, isPdfExtractError, type PdfExtractErrorCode } from "./errors";

export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_TIMEOUT_MS = 20_000;
export const PDF_MAX_PAGES = 500;
/** Under this many trimmed characters a document is treated as a scan with no text layer. */
export const PDF_MIN_TEXT_CHARS = 20;

export type PdfExtractOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  maxPages?: number;
};

export type PdfExtractResult = {
  /** Page text joined by `<!-- page N -->` markers, one before each page. */
  text: string;
  /** Pages actually read (never more than `maxPages`). */
  pages: number;
  /** True when the document had more pages than `maxPages`. */
  truncated: boolean;
};

export function pdfPageMarker(page: number): string {
  return `<!-- page ${page} -->`;
}

function ensureTime(deadline: number): void {
  if (Date.now() >= deadline) {
    throw new PdfExtractError("timeout", "PDF parsing timed out");
  }
}

/** Rejects with a timeout error once the deadline passes, and lets the caller release the parser. */
function withDeadline<T>(work: Promise<T>, deadline: number, abort: () => void): Promise<T> {
  const remaining = Math.max(1, deadline - Date.now());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      abort();
      reject(new PdfExtractError("timeout", "PDF parsing timed out"));
    }, remaining);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function invalid(error: unknown): PdfExtractError {
  if (error instanceof PdfExtractError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new PdfExtractError("invalid", `Could not read the PDF (${detail})`);
}

type TextItem = { str?: unknown; hasEOL?: unknown };

function itemsToText(items: readonly TextItem[]): string {
  return items
    .map((item) => (typeof item.str === "string" ? `${item.str}${item.hasEOL === true ? "\n" : ""}` : ""))
    .join("");
}

/** pdf.js may detach the buffer it is handed, so it always gets a private copy of the caller's bytes. */
function checkedCopy(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (bytes.byteLength === 0) {
    throw new PdfExtractError("invalid", "Could not read the PDF (empty file)");
  }
  if (bytes.byteLength > maxBytes) {
    throw new PdfExtractError("too_large", `PDF is larger than the ${maxBytes} byte limit`);
  }
  return Uint8Array.from(bytes);
}

/** What one page yielded: its text, and how many text items pdfjs actually found on it. */
export type PdfPageText = { text: string; items: number };

type PdfPage = {
  getTextContent: () => Promise<{ items: readonly TextItem[] }>;
  cleanup: () => void;
};

/**
 * Reads every page under one shared deadline. Exported so a test can prove that a page load which
 * never resolves rejects with `timeout` instead of hanging the upload. Also the engine of the
 * fallback path below.
 */
export async function readPages(
  doc: { numPages: number; getPage: (n: number) => Promise<unknown> },
  limit: number,
  deadline: number,
): Promise<readonly PdfPageText[]> {
  const pages: PdfPageText[] = [];
  for (let number = 1; number <= limit; number += 1) {
    ensureTime(deadline);
    // `getPage` parses that page's object tree, so it is as capable of hanging on a crafted file as
    // `getTextContent` is; both get the same deadline.
    const page = (await withDeadline(doc.getPage(number), deadline, () => undefined)) as PdfPage;
    const content = await withDeadline(page.getTextContent(), deadline, () => page.cleanup());
    pages.push({ text: itemsToText(content.items), items: content.items.length });
    page.cleanup();
  }
  return pages;
}

export async function extractPdfText(bytes: Uint8Array, opts: PdfExtractOptions = {}): Promise<PdfExtractResult> {
  const maxBytes = opts.maxBytes ?? PDF_MAX_BYTES;
  const maxPages = opts.maxPages ?? PDF_MAX_PAGES;
  const timeoutMs = opts.timeoutMs ?? PDF_TIMEOUT_MS;
  const data = checkedCopy(bytes, maxBytes);
  const deadline = Date.now() + timeoutMs;
  const moduleUrl = pdfjsEntryUrl();
  if (moduleUrl) {
    // Fresh worker per call: nothing is shared between uploads, and a worker that had to be killed
    // can never be handed the next parse.
    return (await runWorkerTask({
      source: PDF_WORKER_SOURCE,
      workerData: { moduleUrl, data, maxPages, deadline, minTextChars: PDF_MIN_TEXT_CHARS },
      timeoutMs,
      // The private copy is transferred rather than cloned: pdfjs owns it from here and this thread
      // keeps no handle on it. `checkedCopy` already saw to it that the caller's array is untouched.
      transferList: [data.buffer as ArrayBuffer],
    })) as PdfExtractResult;
  }
  return readOnThisThread(data, maxPages, deadline);
}

/**
 * The pre-isolation pipeline, kept as the fallback for hosts where pdfjs is not on disk to import
 * (the packaged bundle inlines it). Bounded between awaits: a synchronous hang inside pdfjs cannot
 * be preempted from this thread.
 */
async function readOnThisThread(data: Uint8Array, maxPages: number, deadline: number): Promise<PdfExtractResult> {
  const task = getDocument({
    data,
    // No fetch for worker/CMap data, no font data URL: nothing here may touch the network.
    // (`isEvalSupported` is gone in pdfjs 6 — the library no longer uses `eval` at all.)
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    const doc = await withDeadline(task.promise, deadline, () => void task.destroy());
    const limit = Math.max(1, Math.min(doc.numPages, maxPages));
    const pages = await readPages(doc, limit, deadline);
    const text = pages.map((page, index) => `${pdfPageMarker(index + 1)}\n${page.text}`).join("\n");
    if (hasNoTextLayer(pages, text)) {
      throw new PdfExtractError("no_text_layer", "PDF has no text layer");
    }
    return { text, pages: pages.length, truncated: doc.numPages > limit };
  } catch (error) {
    throw invalid(error);
  } finally {
    // Releases the document, its page cache and the fake worker; safe to call twice.
    await Promise.resolve(task.destroy()).catch(() => undefined);
  }
}

/**
 * A scan, not a short document.
 *
 * The old rule refused any multi-page PDF under 20 characters, which threw away genuinely terse
 * documents (a two-page signature block, a cover sheet plus a stamp). Now a file is only called a
 * scan when it produced no readable text at all, or when several pages are near-empty *and* pdfjs
 * found no text items on any of them — which is what an image-only PDF actually looks like.
 */
function hasNoTextLayer(pages: readonly PdfPageText[], text: string): boolean {
  if (text.replace(/<!-- page \d+ -->/g, "").trim().length === 0) {
    return true;
  }
  const body = pages.map((page) => page.text).join("");
  return (
    pages.length >= 2 &&
    body.trim().length < PDF_MIN_TEXT_CHARS &&
    pages.every((page) => page.items === 0)
  );
}
