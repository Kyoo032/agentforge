import { describe, expect, it } from "vitest";
import { buildGarbagePdf, buildTextPdf } from "./__fixtures__/build-pdf";
import { liveWorkers, waitUntil } from "./__fixtures__/worker-count";
import { PdfExtractError, extractPdfText, pdfPageMarker, readPages } from "./index";

const PLANTED = "ZORBLAX-7719-PLANTED";

function threePagePdf(): Uint8Array {
  return buildTextPdf(["First page about apples.", "Second page about pears.", `Third page mentions ${PLANTED} once.`]);
}

describe("extractPdfText", () => {
  it("extracts every page and reports the page count", async () => {
    const result = await extractPdfText(threePagePdf());
    expect(result.pages).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain("First page about apples");
    expect(result.text).toContain(PLANTED);
  });

  it("puts the page marker immediately before the page that carries the planted token", async () => {
    const result = await extractPdfText(threePagePdf());
    const marker = result.text.lastIndexOf(pdfPageMarker(3));
    const token = result.text.indexOf(PLANTED);
    expect(marker).toBeGreaterThanOrEqual(0);
    expect(token).toBeGreaterThan(marker);
    // No later page marker sits between the marker and the token.
    expect(result.text.slice(marker, token)).not.toContain(pdfPageMarker(4));
    expect(result.text.indexOf(pdfPageMarker(1))).toBeLessThan(result.text.indexOf(pdfPageMarker(2)));
  });

  it("stops at maxPages and reports truncated", async () => {
    const result = await extractPdfText(threePagePdf(), { maxPages: 2 });
    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.text).not.toContain(PLANTED);
  });

  it("rejects a PDF with no text layer", async () => {
    const error = await extractPdfText(buildTextPdf([""])).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PdfExtractError);
    expect((error as PdfExtractError).code).toBe("no_text_layer");
  });

  it("rejects a multi-page PDF where no page yielded a single text item", async () => {
    const error = await extractPdfText(buildTextPdf(["", "", ""])).catch((caught: unknown) => caught);
    expect((error as PdfExtractError).code).toBe("no_text_layer");
  });

  it("keeps a genuinely short multi-page PDF instead of calling it a scan", async () => {
    const result = await extractPdfText(buildTextPdf(["a", "b", ""]));
    expect(result.pages).toBe(3);
    expect(result.text).toContain("a");
    expect(result.text).toContain("b");
  });

  it("keeps a two-page PDF that carries only a signature block", async () => {
    const result = await extractPdfText(buildTextPdf(["Agreed.", "By: A. Okoro"]));
    expect(result.text).toContain("A. Okoro");
  });

  it("times out a page load that never resolves", async () => {
    const doc = { numPages: 2, getPage: () => new Promise<never>(() => undefined) };
    const error = await readPages(doc, 2, Date.now() + 20).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PdfExtractError);
    expect((error as PdfExtractError).code).toBe("timeout");
  });

  it("still times out when getTextContent never resolves", async () => {
    const page = { getTextContent: () => new Promise<never>(() => undefined), cleanup: () => undefined };
    const doc = { numPages: 1, getPage: () => Promise.resolve(page) };
    const error = await readPages(doc, 1, Date.now() + 20).catch((caught: unknown) => caught);
    expect((error as PdfExtractError).code).toBe("timeout");
  });

  it("rejects garbage bytes as invalid", async () => {
    const error = await extractPdfText(buildGarbagePdf()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PdfExtractError);
    expect((error as PdfExtractError).code).toBe("invalid");
  });

  it("rejects empty input as invalid", async () => {
    const error = await extractPdfText(new Uint8Array(0)).catch((caught: unknown) => caught);
    expect((error as PdfExtractError).code).toBe("invalid");
  });

  it("rejects bytes over maxBytes before parsing", async () => {
    const error = await extractPdfText(threePagePdf(), { maxBytes: 10 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PdfExtractError);
    expect((error as PdfExtractError).code).toBe("too_large");
    expect((error as PdfExtractError).message).toContain("10");
  });

  it("gives up with a timeout error when the deadline is already spent", async () => {
    const error = await extractPdfText(threePagePdf(), { timeoutMs: 1 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PdfExtractError);
    expect((error as PdfExtractError).code).toBe("timeout");
  });

  it("runs the parse on a worker thread and releases it when done", async () => {
    const baseline = liveWorkers();
    const pages = Array.from({ length: 300 }, (_, index) => `page ${index + 1} body text`);
    const pending = extractPdfText(buildTextPdf(pages));
    const spawned = await waitUntil(() => liveWorkers() > baseline, 2_000);
    expect(spawned).toBe(true);
    const result = await pending;
    expect(result.pages).toBe(300);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain("page 300 body text");
    expect(await waitUntil(() => liveWorkers() <= baseline, 3_000)).toBe(true);
  });
});
