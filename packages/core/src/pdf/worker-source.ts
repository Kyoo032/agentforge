/**
 * Source of the worker thread that owns one PDF parse (see `./worker.ts`).
 *
 * Kept as a string so it works the same under plain Node ESM (tests, dev) and inside the packaged
 * CommonJS host bundle: the parent passes the resolved pdfjs entry, the document bytes, the page
 * cap and one absolute deadline. Anything that throws on the worker is caught and reported as a
 * `{ok:false, code, message}` reply, with the same codes the caller maps onto `PdfExtractError`.
 *
 * Protocol: {moduleUrl, data, maxPages, deadline, minTextChars} arrives as `workerData` →
 *           {ok:true, result} | {ok:false, code, message}
 *
 * The pipeline mirrors `index.ts` on purpose: the in-process path there is the fallback for hosts
 * where pdfjs is not on disk to import, and both must keep the same caps, markers and scan rule.
 */
export const PDF_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");

function fail(code, message) {
  const error = new Error(message);
  error.pdfCode = code;
  return error;
}

function pageMarker(page) {
  return "<!-- page " + page + " -->";
}

function itemsToText(items) {
  let text = "";
  for (const item of items) {
    if (typeof item.str === "string") text += item.str + (item.hasEOL === true ? "\n" : "");
  }
  return text;
}

/** Rejects with a timeout error once the deadline passes, and lets the caller release the parser. */
function withDeadline(work, deadline, abort) {
  const remaining = Math.max(1, deadline - Date.now());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        abort();
      } catch {}
      reject(fail("timeout", "PDF parsing timed out"));
    }, remaining);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readPages(doc, limit, deadline) {
  const pages = [];
  for (let number = 1; number <= limit; number += 1) {
    if (Date.now() >= deadline) throw fail("timeout", "PDF parsing timed out");
    // getPage parses that page's object tree, so it is as capable of hanging on a crafted file as
    // getTextContent is; both get the same deadline.
    const page = await withDeadline(doc.getPage(number), deadline, () => undefined);
    const content = await withDeadline(page.getTextContent(), deadline, () => page.cleanup());
    pages.push({ text: itemsToText(content.items), items: content.items.length });
    page.cleanup();
  }
  return pages;
}

function hasNoTextLayer(pages, text, minTextChars) {
  if (text.replace(/<!-- page \d+ -->/g, "").trim().length === 0) return true;
  const body = pages.map((page) => page.text).join("");
  return pages.length >= 2 && body.trim().length < minTextChars && pages.every((page) => page.items === 0);
}

async function extract() {
  const { moduleUrl, data, maxPages, deadline, minTextChars } = workerData;
  const pdfjs = await import(moduleUrl);
  const task = pdfjs.getDocument({
    data,
    // No fetch for worker/CMap data, no font data URL: nothing here may touch the network.
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    const doc = await withDeadline(task.promise, deadline, () => { void task.destroy(); });
    const limit = Math.max(1, Math.min(doc.numPages, maxPages));
    const pages = await readPages(doc, limit, deadline);
    const text = pages.map((page, index) => pageMarker(index + 1) + "\n" + page.text).join("\n");
    if (hasNoTextLayer(pages, text, minTextChars)) throw fail("no_text_layer", "PDF has no text layer");
    return { text, pages: pages.length, truncated: doc.numPages > limit };
  } finally {
    await Promise.resolve(task.destroy()).catch(() => undefined);
  }
}

(async () => {
  try {
    parentPort.postMessage({ ok: true, result: await extract() });
  } catch (error) {
    const code = error && error.pdfCode;
    if (typeof code === "string") {
      parentPort.postMessage({ ok: false, code: code, message: error.message });
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      parentPort.postMessage({ ok: false, code: "invalid", message: "Could not read the PDF (" + detail + ")" });
    }
  }
})();
`;
