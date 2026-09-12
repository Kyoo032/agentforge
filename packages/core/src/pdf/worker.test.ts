import { describe, expect, it } from "vitest";
import { liveWorkers, waitUntil } from "./__fixtures__/worker-count";
import { PdfExtractError } from "./errors";
import { pdfjsEntryUrl, runWorkerTask } from "./worker";

/** Blocks its own thread for a minute: only `terminate()` can stop it before that. */
const BLOCKS_FOR_A_MINUTE = String.raw`const started = Date.now(); while (Date.now() - started < 60_000) {}`;

const ECHOES = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
parentPort.postMessage({ ok: true, result: { echo: workerData.echo } });
`;

const REFUSES = String.raw`
const { parentPort } = require("node:worker_threads");
parentPort.postMessage({ ok: false, code: "no_text_layer", message: "PDF has no text layer" });
`;

const UNKNOWN_CODE = String.raw`
const { parentPort } = require("node:worker_threads");
parentPort.postMessage({ ok: false, code: "kaboom", message: "unexpected" });
`;

const CRASHES = String.raw`throw new Error("worker exploded");`;

const STOPS_SILENTLY = String.raw`
const { parentPort } = require("node:worker_threads");
parentPort.close();
`;

/** Alive but silent: an open timer keeps this worker from exiting on its own. */
const WAITS_FOREVER = String.raw`setTimeout(() => {}, 30_000);`;

describe("runWorkerTask", () => {
  it("kills a worker that is blocked in a synchronous loop", async () => {
    const baseline = liveWorkers();
    const started = Date.now();
    const error = await runWorkerTask({ source: BLOCKS_FOR_A_MINUTE, workerData: null, timeoutMs: 250 }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PdfExtractError);
    expect((error as PdfExtractError).code).toBe("timeout");
    expect((error as PdfExtractError).message).toBe("PDF parsing timed out");
    expect(Date.now() - started).toBeLessThan(4_000);
    // The blocked thread is actually gone, not left burning for the rest of its minute.
    expect(await waitUntil(() => liveWorkers() <= baseline, 4_000)).toBe(true);
  });

  it("keeps the caller's event loop free while the worker is blocked", async () => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 10);
    try {
      const error = await runWorkerTask({ source: BLOCKS_FOR_A_MINUTE, workerData: null, timeoutMs: 300 }).catch(
        (caught: unknown) => caught,
      );
      expect((error as PdfExtractError).code).toBe("timeout");
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThanOrEqual(3);
  });

  it("resolves with the value the worker reported", async () => {
    const result = await runWorkerTask({ source: ECHOES, workerData: { echo: "round-trip" }, timeoutMs: 5_000 });
    expect(result).toEqual({ echo: "round-trip" });
  });

  it("rejects a worker-reported failure with its own code and message", async () => {
    const error = await runWorkerTask({ source: REFUSES, workerData: null, timeoutMs: 5_000 }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PdfExtractError);
    expect((error as PdfExtractError).code).toBe("no_text_layer");
    expect((error as PdfExtractError).message).toBe("PDF has no text layer");
  });

  it("maps a failure code it does not know to invalid", async () => {
    const error = await runWorkerTask({ source: UNKNOWN_CODE, workerData: null, timeoutMs: 5_000 }).catch(
      (caught: unknown) => caught,
    );
    expect((error as PdfExtractError).code).toBe("invalid");
  });

  it("maps a crashed worker to invalid and keeps the detail", async () => {
    const error = await runWorkerTask({ source: CRASHES, workerData: null, timeoutMs: 5_000 }).catch(
      (caught: unknown) => caught,
    );
    expect((error as PdfExtractError).code).toBe("invalid");
    expect((error as PdfExtractError).message).toContain("worker exploded");
  });

  it("maps a worker that stops without answering to invalid", async () => {
    const error = await runWorkerTask({ source: STOPS_SILENTLY, workerData: null, timeoutMs: 5_000 }).catch(
      (caught: unknown) => caught,
    );
    expect((error as PdfExtractError).code).toBe("invalid");
  });

  it("times out a worker that stays alive but silent past the deadline", async () => {
    const baseline = liveWorkers();
    const started = Date.now();
    const error = await runWorkerTask({ source: WAITS_FOREVER, workerData: null, timeoutMs: 250 }).catch(
      (caught: unknown) => caught,
    );
    expect((error as PdfExtractError).code).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(await waitUntil(() => liveWorkers() <= baseline, 4_000)).toBe(true);
  });

  it("resolves the on-disk pdfjs entry that the worker imports", () => {
    const url = pdfjsEntryUrl();
    expect(url).toMatch(/^file:\/\//);
    expect(url).toMatch(/pdf\.mjs$/);
  });

  it("treats a resolution failure as no worker entry", () => {
    const missing = pdfjsEntryUrl(() => {
      throw new Error("pdfjs-dist is not shipped on disk");
    });
    expect(missing).toBeNull();
  });
});
