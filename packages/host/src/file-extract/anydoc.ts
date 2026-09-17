/**
 * The only place `@firecrawl/anydoc` is touched.
 *
 * PRIVACY — this is the whole point of the file being this small. anydoc converts everything itself,
 * on this machine, with one exception: its `ocr: 'hosted'` option, which uploads the document to
 * Firecrawl Parse. This module never constructs an options object at all, so that option cannot be
 * reached from here — `toMarkdownBytes` is called with exactly two arguments, bytes and format. It
 * also never reads a `FIRECRAWL_*` key or url variable; a scanned PDF fails locally instead.
 * `file-extract/privacy.test.ts` asserts both, and `file-extract/no-hosted-ocr.test.ts` greps the
 * repository so a future call site cannot quietly add the option back.
 *
 * TIMING — `toMarkdownBytes` is a napi-rs async task: the conversion runs on the libuv thread pool
 * and the returned promise settles on the event loop, so a slow document cannot block the request
 * thread and no worker thread is needed. The deadline below exists so a *pathological* document
 * cannot hold the request open, not to keep the loop free.
 */
import { createRequire } from "node:module";
import { FileExtractError } from "./errors";

/** The format names anydoc uses. Kept as a string union so this file needs no value import. */
export type AnydocFormat =
  | "doc"
  | "docx"
  | "odt"
  | "pdf"
  | "ppt"
  | "pptx"
  | "rtf"
  | "epub"
  | "xlsx"
  | "ods"
  | "odp"
  | "csv";

/** The three entry points this pipeline uses, and nothing else anydoc exports. */
export type AnydocModule = {
  formatFromBytes(bytes: Uint8Array): AnydocFormat | null;
  formatFromExtension(extension: string): AnydocFormat | null;
  toMarkdownBytes(bytes: Uint8Array, format?: AnydocFormat | null): Promise<string>;
};

/** How the module is obtained. Injectable so a test can make the native binding fail to load. */
export type AnydocLoader = () => AnydocModule;

let cached: AnydocModule | null = null;
let cachedFailure: Error | null = null;

/**
 * `createRequire` rather than a static import: the binding is a platform `.node` file, and a packed
 * build for an unsupported platform must degrade to the existing extractors instead of failing to
 * start. The outcome is remembered both ways so a missing binding is not re-resolved per upload.
 */
export function loadAnydoc(): AnydocModule {
  if (cached) {
    return cached;
  }
  if (cachedFailure) {
    throw cachedFailure;
  }
  try {
    cached = createRequire(import.meta.url)("@firecrawl/anydoc") as AnydocModule;
    return cached;
  } catch (error) {
    cachedFailure = error instanceof Error ? error : new Error(String(error));
    throw cachedFailure;
  }
}

/**
 * Convert bytes to Markdown under a deadline.
 *
 * The call is `toMarkdownBytes(bytes, format)` — two arguments, deliberately. Do not add a third:
 * the third parameter is the options bag that carries hosted OCR.
 */
export async function toMarkdownUnderDeadline(
  anydoc: AnydocModule,
  bytes: Uint8Array,
  format: AnydocFormat | null,
  timeoutMs: number,
): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new FileExtractError("timeout")), Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([anydoc.toMarkdownBytes(bytes, format), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
