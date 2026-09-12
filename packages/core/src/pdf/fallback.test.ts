import { describe, expect, it, vi } from "vitest";
import { buildGarbagePdf, buildTextPdf } from "./__fixtures__/build-pdf";
import { PdfExtractError } from "./errors";
import { extractPdfText } from "./index";
import { pdfjsEntryUrl } from "./worker";

const PLANTED = "ZORBLAX-7719-PLANTED";

// The seam is mocked so extraction behaves like the packaged bundle: there, pdfjs is inlined into
// the host bundle and no module on disk exists for a worker to import.
vi.mock("./worker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./worker")>()),
  pdfjsEntryUrl: () => null,
}));

describe("extractPdfText without an on-disk pdfjs entry", () => {
  it("sees no worker entry to hand out", () => {
    expect(pdfjsEntryUrl()).toBeNull();
  });

  it("still extracts the whole document on this thread", async () => {
    const result = await extractPdfText(
      buildTextPdf(["fallback apples", "fallback pears", `fallback plums ${PLANTED}`]),
    );
    expect(result.pages).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain("fallback apples");
    expect(result.text).toContain(PLANTED);
  });

  it("still puts the page marker before the page that carries the token", async () => {
    const result = await extractPdfText(buildTextPdf(["one apples", "two pears", `three ${PLANTED}`]));
    const marker = result.text.lastIndexOf("<!-- page 3 -->");
    const token = result.text.indexOf(PLANTED);
    expect(marker).toBeGreaterThanOrEqual(0);
    expect(token).toBeGreaterThan(marker);
  });

  it("still calls a scan a scan", async () => {
    const error = await extractPdfText(buildTextPdf([""])).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PdfExtractError);
    expect((error as PdfExtractError).code).toBe("no_text_layer");
  });

  it("still rejects garbage as invalid", async () => {
    const error = await extractPdfText(buildGarbagePdf()).catch((caught: unknown) => caught);
    expect((error as PdfExtractError).code).toBe("invalid");
  });

  it("still enforces maxBytes before parsing", async () => {
    const error = await extractPdfText(buildTextPdf(["tiny"]), { maxBytes: 10 }).catch((caught: unknown) => caught);
    expect((error as PdfExtractError).code).toBe("too_large");
  });

  it("still times out with the timeout code", async () => {
    const error = await extractPdfText(buildTextPdf(["tiny"]), { timeoutMs: 1 }).catch((caught: unknown) => caught);
    expect((error as PdfExtractError).code).toBe("timeout");
  });
});
