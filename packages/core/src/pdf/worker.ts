/**
 * Worker-thread isolation for the PDF parser.
 *
 * pdfjs runs its "fake worker" on whatever thread it parses on, and a long synchronous stretch
 * inside it never returns to the event loop — so a deadline that only races a promise cannot stop a
 * file that wedges the thread. This module moves the parse to a fresh worker and keeps the deadline
 * here, in the caller: when it passes, `terminate()` kills the worker mid-instruction.
 *
 * The worker source is a string (`./worker-source.ts`) evaluated with `eval: true`, the same shape
 * as the dataset SQL runner in `packages/host/src/sql-runner.ts`, so it behaves identically under
 * plain Node ESM (tests, dev) and inside the esbuild CommonJS host bundle. In the packaged app the
 * pdfjs module is inlined into that bundle and is not resolvable on disk, so `pdfjsEntryUrl()`
 * answers null there and `extractPdfText` reads the document on the calling thread instead.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { PdfExtractError, type PdfExtractErrorCode } from "./errors";

/** One worker reply: `result` on success, otherwise the same codes the in-process path throws. */
type WorkerReply = { ok?: unknown; result?: unknown; code?: unknown; message?: unknown };

export type WorkerTaskOptions = {
  /** CommonJS source evaluated as the worker's entry point. */
  source: string;
  /** Structured-cloned to the worker, readable there as `workerData` (moved buffers included). */
  workerData: unknown;
  /** Hard deadline: at this many milliseconds the worker is terminated, however stuck it is. */
  timeoutMs: number;
  /** Buffers to move instead of clone — the PDF bytes, so an upload is never copied twice. */
  transferList?: readonly ArrayBuffer[];
};

/**
 * Where a worker finds pdfjs, or null when there is no module on disk to import.
 *
 * `require` is the branch that runs inside the CommonJS host bundle; `createRequire` the one that
 * runs under plain Node ESM. `resolveEntry` is a seam so a test can drive the null branch, which is
 * what the packaged app sees.
 */
export function pdfjsEntryUrl(resolveEntry?: () => string): string | null {
  try {
    const resolved = resolveEntry ? resolveEntry() : resolvePdfjsEntry();
    // A worker cannot read inside an app.asar archive; prefer the unpacked copy when one exists —
    // the same swap the SQL worker does for its native module. A no-op in dev and test trees.
    const unpacked = resolved.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
    const onDisk = unpacked !== resolved && existsSync(unpacked) ? unpacked : resolved;
    return pathToFileURL(onDisk).href;
  } catch {
    return null;
  }
}

function resolvePdfjsEntry(): string {
  const resolver = typeof require === "function" ? require : createRequire(import.meta.url);
  return resolver.resolve("pdfjs-dist/legacy/build/pdf.mjs");
}

const WORKER_CODES: readonly PdfExtractErrorCode[] = ["too_large", "timeout", "no_text_layer", "invalid"];

function workerCode(code: unknown): PdfExtractErrorCode {
  return WORKER_CODES.includes(code as PdfExtractErrorCode) ? (code as PdfExtractErrorCode) : "invalid";
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stopped(reason: string): PdfExtractError {
  return new PdfExtractError("invalid", `Could not read the PDF (${reason})`);
}

/**
 * Runs one task in a fresh worker and settles with what it reports.
 *
 * One call, one thread: the worker is terminated on the way out, so nothing is shared between
 * uploads and a worker that had to be killed can never answer the next parse. Rejects with a
 * `timeout` error at the deadline even when the worker is too stuck to answer, and with `invalid`
 * when the worker crashes or stops without answering.
 */
export function runWorkerTask(options: WorkerTaskOptions): Promise<unknown> {
  const { source, workerData, timeoutMs, transferList } = options;
  return new Promise<unknown>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(source, {
        eval: true,
        workerData,
        transferList: transferList ? [...transferList] : undefined,
      });
    } catch (error) {
      reject(stopped(`worker failed to start (${detail(error)})`));
      return;
    }
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (settle: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      worker.removeAllListeners();
      void worker.terminate().catch(() => undefined);
      settle();
    };
    worker.on("message", (reply: WorkerReply) => {
      if (reply?.ok === true) {
        finish(() => resolve(reply.result));
        return;
      }
      const message =
        typeof reply?.message === "string" && reply.message.length > 0 ? reply.message : "PDF parsing failed";
      finish(() => reject(new PdfExtractError(workerCode(reply?.code), message)));
    });
    worker.on("error", (error: Error) => {
      finish(() => reject(stopped(detail(error))));
    });
    worker.on("exit", () => {
      finish(() => reject(stopped("worker stopped before answering")));
    });
    timer = setTimeout(
      () => {
        finish(() => reject(new PdfExtractError("timeout", "PDF parsing timed out")));
      },
      Math.max(1, timeoutMs),
    );
  });
}
