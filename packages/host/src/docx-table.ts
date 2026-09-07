import { AlignmentType, BorderStyle, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "C9D3DE" };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const FONT = "Calibri";

export type DocxCell = string | number | boolean | null | undefined;

export function formatDocxCell(value: DocxCell, locale?: string): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) : "";
  }
  return String(value);
}

function cell(value: DocxCell, options: { header?: boolean; locale?: string }): TableCell {
  const numeric = typeof value === "number";
  return new TableCell({
    borders: BORDERS,
    shading: options.header ? { fill: "EEF3F8" } : undefined,
    children: [
      new Paragraph({
        alignment: numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [
          new TextRun({ text: formatDocxCell(value, options.locale), font: FONT, size: 20, bold: options.header }),
        ],
      }),
    ],
  });
}

/** A bordered table with a shaded header row; numbers right-aligned and locale-formatted. */
export function docxTable(
  columns: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<DocxCell>>,
  locale?: string,
): Table {
  const header = new TableRow({
    tableHeader: true,
    children: columns.map((column) => cell(column, { header: true, locale })),
  });
  const body = rows.map((row) => new TableRow({ children: columns.map((_, index) => cell(row[index], { locale })) }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] });
}
