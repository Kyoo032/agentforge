import { Document, HeadingLevel, Packer, Paragraph, TextRun, type Table } from "docx";
import { resolvedProductName } from "@agentforge/core";
import { formatMetricValue, type FinanceBrief } from "@agentforge/core/artifacts";
import { docxTable } from "./docx-table";

const FONT = "Calibri";

function safeFilename(title: string): string {
  const base = title
    .trim()
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "finance-brief"}.docx`;
}

function heading(
  text: string,
  level: (typeof HeadingLevel)[keyof typeof HeadingLevel],
  size: number,
  color: string,
): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, font: FONT, bold: true, size, color })],
  });
}

function bodyParagraphs(body: string): Paragraph[] {
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return (blocks.length > 0 ? blocks : [body.trim()]).map(
    (block) =>
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: block, font: FONT, size: 22 })] }),
  );
}

function bullet(text: string): Paragraph {
  return new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text, font: FONT, size: 22 })] });
}

function metricsTable(brief: FinanceBrief): Table | null {
  if (brief.computed.metrics.length === 0) {
    return null;
  }
  return docxTable(
    ["Metric", "Value", "Period", "Formula"],
    brief.computed.metrics.map((metric) => [metric.label, formatMetricValue(metric), metric.period, metric.formula]),
  );
}

/** Real tables for line items, computed metrics, and totals; an assumptions appendix at the end. */
export async function buildFinanceDocx(
  brief: FinanceBrief,
  locale?: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 300 },
      children: [new TextRun({ text: brief.title, font: FONT, bold: true, size: 48, color: "0D2137" })],
    }),
  ];
  for (const section of brief.sections) {
    children.push(heading(section.heading, HeadingLevel.HEADING_1, 28, "1565C0"), ...bodyParagraphs(section.body));
    for (const table of section.tables) {
      children.push(docxTable(table.columns, table.rows, locale), new Paragraph({ spacing: { after: 160 } }));
    }
  }
  const metrics = metricsTable(brief);
  if (metrics) {
    children.push(
      heading("Computed metrics", HeadingLevel.HEADING_1, 28, "1565C0"),
      metrics,
      new Paragraph({ spacing: { after: 160 } }),
    );
  }
  for (const table of brief.computed.tables) {
    children.push(
      heading(table.name, HeadingLevel.HEADING_2, 24, "1565C0"),
      docxTable(table.columns, table.rows, locale),
      new Paragraph({ spacing: { after: 160 } }),
    );
  }
  children.push(heading("Assumptions", HeadingLevel.HEADING_1, 28, "1565C0"));
  children.push(...(brief.assumptions.length > 0 ? brief.assumptions.map(bullet) : [bullet("None stated.")]));

  const doc = new Document({ creator: resolvedProductName(), title: brief.title, sections: [{ children }] });
  return { buffer: await Packer.toBuffer(doc), filename: safeFilename(brief.title) };
}
