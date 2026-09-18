/**
 * Tiny synthetic documents, generated in-process, for the file-extract tests.
 *
 * Every figure and every name here is invented (PT Cemara Sintetis does not exist). Nothing is read
 * from disk and nothing is downloaded: each fixture is built by the same libraries the host already
 * depends on, so the suite has no binary blobs to review and no fixture can drift from its format.
 */
import ExcelJS from "exceljs";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import PptxGenJS from "pptxgenjs";
import { buildTextPdf } from "@agentforge/core/pdf/test-fixtures";

/** The string every fixture carries exactly once, so a test can prove it read that fixture. */
export const PLANTED = "CEMARA-7781";

export const FIXTURE_TABLE: ReadonlyArray<ReadonlyArray<string>> = [
  ["Label", "2023", "2024"],
  ["Pendapatan", "1000000", "1250000"],
  ["HPP", "600000", "730000"],
];

export function csvFixture(): Uint8Array {
  return new TextEncoder().encode(`Label,2023,2024\nPendapatan,1000000,1250000\nHPP,600000,730000\n`);
}

export async function xlsxFixture(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("Ringkasan");
  summary.addRows(FIXTURE_TABLE.map((row) => [...row]));
  const budget = workbook.addWorksheet("Anggaran");
  budget.addRows([
    ["Label", "Rencana"],
    ["Sewa", "15000"],
  ]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function docxFixture(): Promise<Uint8Array> {
  const rows = FIXTURE_TABLE.map(
    (row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph(cell)] })) }),
  );
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "Laporan PT Cemara Sintetis", heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun({ text: `Pendapatan naik 25 persen, kode ${PLANTED}.` })] }),
          new Paragraph({ text: "Ringkasan laba rugi", heading: HeadingLevel.HEADING_2 }),
          new Table({ rows }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

export async function pptxFixture(): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  const slide = pptx.addSlide();
  slide.addText("Ringkasan laba rugi", { x: 0.5, y: 0.5, fontSize: 24 });
  slide.addText(`Pendapatan naik 25 persen, kode ${PLANTED}.`, { x: 0.5, y: 1.5, fontSize: 14 });
  slide.addTable(
    FIXTURE_TABLE.map((row) => row.map((cell) => ({ text: cell }))),
    { x: 0.5, y: 2.5 },
  );
  return new Uint8Array((await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer);
}

export function pdfFixture(): Uint8Array {
  return buildTextPdf([`${PLANTED} Pendapatan 1250000.`, "Halaman dua: HPP 730000."]);
}

/** A PDF whose pages carry no text layer at all — the scan the converter refuses with `needsOcr`. */
export function scannedPdfFixture(): Uint8Array {
  return buildTextPdf(["", ""]);
}

export function rtfFixture(): Uint8Array {
  return new TextEncoder().encode(`{\\rtf1\\ansi Pendapatan naik 25 persen, kode ${PLANTED}.\\par}`);
}
