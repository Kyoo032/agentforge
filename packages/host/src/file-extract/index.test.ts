import { describe, expect, it } from "vitest";
import { FILE_EXTRACT_MAX_BYTES, FileExtractError, extractFile } from "./index";
import type { FileExtractErrorCode } from "./index";
import {
  PLANTED,
  csvFixture,
  docxFixture,
  pdfFixture,
  pptxFixture,
  rtfFixture,
  scannedPdfFixture,
  xlsxFixture,
} from "./test-fixtures";

async function codeOf(work: Promise<unknown>): Promise<FileExtractErrorCode> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(FileExtractError);
  return (error as FileExtractError).code;
}

/** The rejection, narrowed. `.catch(x => x as FileExtractError)` widens to include the success type. */
async function failureOf(work: Promise<unknown>): Promise<FileExtractError> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(FileExtractError);
  return error as FileExtractError;
}

describe("extractFile", () => {
  it("reads every sheet of a workbook as its own titled table", async () => {
    const result = await extractFile({ bytes: await xlsxFixture(), filename: "figures.xlsx" });
    expect(result.format).toBe("xlsx");
    expect(result.meta.engine).toBe("anydoc");
    expect(result.meta.sheets).toBe(2);
    expect(result.tables.map((table) => table.title)).toEqual(["Ringkasan", "Anggaran"]);
    expect(result.tables[0]?.rows).toEqual([
      ["Label", "2023", "2024"],
      ["Pendapatan", "1000000", "1250000"],
      ["HPP", "600000", "730000"],
    ]);
    expect(result.tables[1]?.rows).toEqual([
      ["Label", "Rencana"],
      ["Sewa", "15000"],
    ]);
  });

  it("reads a .xls name as a workbook too", async () => {
    // The fixture is an OOXML workbook under a legacy name, which is what most "xls" exports are.
    const result = await extractFile({ bytes: await xlsxFixture(), filename: "figures.xls" });
    expect(result.format).toBe("xlsx");
    expect(result.tables).toHaveLength(2);
  });

  it("reads a report's prose and its table, and keeps the heading as the table title", async () => {
    const result = await extractFile({ bytes: await docxFixture(), filename: "laporan.docx" });
    expect(result.format).toBe("docx");
    expect(result.markdown).toContain("# Laporan PT Cemara Sintetis");
    expect(result.text).toContain(PLANTED);
    expect(result.text).not.toContain("# ");
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]?.title).toBe("Ringkasan laba rugi");
    expect(result.tables[0]?.rows[1]).toEqual(["Pendapatan", "1000000", "1250000"]);
    expect(result.meta.sheets).toBeUndefined();
  });

  it("reads a deck", async () => {
    const result = await extractFile({ bytes: await pptxFixture(), filename: "deck.pptx" });
    expect(result.format).toBe("pptx");
    expect(result.text).toContain(PLANTED);
    expect(result.tables[0]?.rows).toContainEqual(["Pendapatan", "1000000", "1250000"]);
  });

  it("reads a csv, whose format only the extension can name", async () => {
    const result = await extractFile({ bytes: csvFixture(), filename: "figures.csv" });
    expect(result.format).toBe("csv");
    expect(result.tables[0]?.rows).toEqual([
      ["Label", "2023", "2024"],
      ["Pendapatan", "1000000", "1250000"],
      ["HPP", "600000", "730000"],
    ]);
  });

  it("reads an rtf report", async () => {
    const result = await extractFile({ bytes: rtfFixture(), filename: "memo.rtf" });
    expect(result.format).toBe("rtf");
    expect(result.text).toContain(PLANTED);
  });

  it("reads a pdf with a text layer", async () => {
    const result = await extractFile({ bytes: pdfFixture(), filename: "report.pdf" });
    expect(result.format).toBe("pdf");
    expect(result.text).toContain(PLANTED);
  });

  it("refuses a scanned pdf locally, saying so in words and sending nothing", async () => {
    const error = await failureOf(extractFile({ bytes: scannedPdfFixture(), filename: "scan.pdf" }));
    expect(error.code).toBe("needs_ocr");
    expect(error.message).toContain("scanned");
    expect(error.message).toContain("nothing was sent anywhere");
    expect(error.localeKey).toBe("finance.upload.errors.needsOcr");
  });

  it("refuses a file whose extension and bytes disagree", async () => {
    const workbook = await xlsxFixture();
    expect(await codeOf(extractFile({ bytes: workbook, filename: "figures.csv" }))).toBe("format_mismatch");
    expect(await codeOf(extractFile({ bytes: workbook, filename: "report.pdf" }))).toBe("format_mismatch");
    expect(await codeOf(extractFile({ bytes: csvFixture(), filename: "figures.xlsx" }))).toBe("format_mismatch");
    expect(await codeOf(extractFile({ bytes: pdfFixture(), filename: "laporan.docx" }))).toBe("format_mismatch");
  });

  it("refuses a format it does not read at all", async () => {
    expect(await codeOf(extractFile({ bytes: new Uint8Array([1, 2, 3, 4]), filename: "photo.png" }))).toBe(
      "unsupported",
    );
  });

  it("refuses an empty file and a file over the byte cap before parsing anything", async () => {
    expect(await codeOf(extractFile({ bytes: new Uint8Array(0), filename: "figures.csv" }))).toBe("empty");
    const huge = new Uint8Array(FILE_EXTRACT_MAX_BYTES + 1);
    expect(await codeOf(extractFile({ bytes: huge, filename: "figures.csv" }))).toBe("too_large");
  });

  it("maps damaged bytes to malformed without leaking a path or a stack", async () => {
    const brokenZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]);
    const error = await failureOf(extractFile({ bytes: brokenZip, filename: "broken.xlsx" }));
    expect(["malformed", "format_mismatch", "missing_part"]).toContain(error.code);
    expect(error.message).not.toMatch(/[A-Za-z]:\\|\/src\/|\bat \S+ \(/);
    expect(error.message.length).toBeLessThan(200);
  });

  it("gives up on a conversion that runs past its deadline", async () => {
    const never: never[] = [];
    const stalling = {
      formatFromBytes: () => null,
      formatFromExtension: () => "csv" as const,
      toMarkdownBytes: () => new Promise<string>(() => never),
    };
    const code = await codeOf(
      extractFile({ bytes: csvFixture(), filename: "figures.csv" }, { loadAnydoc: () => stalling, timeoutMs: 5 }),
    );
    expect(code).toBe("timeout");
  });

  it("cuts an over-long conversion on a line boundary and says so", async () => {
    const giant = `${"| a | b |\n| --- | --- |\n"}${"| 1 | 2 |\n".repeat(400_000)}`;
    const huge = {
      formatFromBytes: () => null,
      formatFromExtension: () => "csv" as const,
      toMarkdownBytes: () => Promise.resolve(giant),
    };
    const result = await extractFile({ bytes: csvFixture(), filename: "figures.csv" }, { loadAnydoc: () => huge });
    expect(result.meta.truncated).toBe(true);
    expect(result.markdown.length).toBeLessThan(giant.length);
    expect(result.markdown.endsWith("| 1 | 2 |")).toBe(true);
  });
});
