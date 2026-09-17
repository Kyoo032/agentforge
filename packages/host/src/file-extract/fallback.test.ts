/**
 * What a packed build on a platform with no native binding does.
 *
 * The loader is replaced by one that throws, exactly as a missing `.node` file would, and the
 * formats the app could always read must still be readable — through the extractors that predate
 * the converter — while the ones only the converter could read are refused, not crashed.
 */
import { describe, expect, it, vi } from "vitest";
import { FileExtractError, extractFile } from "./index";
import { csvFixture, docxFixture, pdfFixture, pptxFixture, xlsxFixture } from "./test-fixtures";

const noBinding = () => {
  throw new Error("Cannot find native binding");
};

async function withoutBinding(bytes: Uint8Array, filename: string) {
  return extractFile({ bytes, filename }, { loadAnydoc: noBinding });
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

describe("extractFile without the native converter", () => {
  it("logs the missing binding once instead of failing the upload", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await withoutBinding(csvFixture(), "figures.csv");
      expect(result.meta.engine).toBe("fallback");
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0]?.[0])).toContain("native converter unavailable");
    } finally {
      warn.mockRestore();
    }
  });

  it("still reads a csv and a workbook through the spreadsheet reader", async () => {
    const csv = await withoutBinding(csvFixture(), "figures.csv");
    expect(csv.meta.engine).toBe("fallback");
    expect(csv.tables[0]?.rows[1]).toEqual(["Pendapatan", "1000000", "1250000"]);

    const workbook = await withoutBinding(await xlsxFixture(), "figures.xlsx");
    expect(workbook.meta.engine).toBe("fallback");
    expect(workbook.tables.map((table) => table.title)).toEqual(["Ringkasan", "Anggaran"]);
    expect(workbook.meta.sheets).toBe(2);
  });

  it("still reads a .docx through the zip reader, tables included", async () => {
    const result = await withoutBinding(await docxFixture(), "laporan.docx");
    expect(result.meta.engine).toBe("fallback");
    expect(result.text).toContain("CEMARA-7781");
    expect(result.tables[0]?.rows[0]).toEqual(["Label", "2023", "2024"]);
  });

  it("still reads a pdf through pdfjs and reports the page count", async () => {
    const result = await withoutBinding(pdfFixture(), "report.pdf");
    expect(result.meta.engine).toBe("fallback");
    expect(result.text).toContain("CEMARA-7781");
    expect(result.meta.pages).toBe(2);
  });

  it("refuses the formats only the converter could ever read", async () => {
    const error = await failureOf(withoutBinding(await pptxFixture(), "deck.pptx"));
    expect(error.code).toBe("unsupported");
  });

  it("still catches a name that lies about the bytes, with no converter to ask", async () => {
    const error = await failureOf(withoutBinding(await xlsxFixture(), "figures.csv"));
    expect(error.code).toBe("format_mismatch");
  });

  it("uses injected extractors when the caller supplies them", async () => {
    const result = await extractFile(
      { bytes: csvFixture(), filename: "figures.csv" },
      {
        loadAnydoc: noBinding,
        fallback: {
          pdf: () => Promise.reject(new FileExtractError("malformed")),
          docx: () => Promise.reject(new FileExtractError("malformed")),
          workbook: () => Promise.resolve({ text: "stubbed", tables: [{ rows: [["a"]] }] }),
        },
      },
    );
    expect(result.text).toBe("stubbed");
    expect(result.tables).toEqual([{ rows: [["a"]] }]);
  });
});
