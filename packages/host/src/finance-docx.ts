import { Document, HeadingLevel, Packer, Paragraph, TextRun, type Table } from "docx";
import { resolvedProductName } from "@agentforge/core";
import { formatMetricValue, type FinanceBrief } from "@agentforge/core/artifacts";
import { docxTable } from "./docx-table";
import { type AppLocale, financeBootLocale, financeCopy, financeIntlLocale } from "./finance-locale";

const FONT = "Calibri";

function resolveDocxLocale(locale?: string): { copy: AppLocale; intl: string } {
  if (locale === "id" || locale === "id-ID" || locale?.startsWith("id")) {
    return { copy: "id", intl: locale === "id" ? financeIntlLocale("id") : locale };
  }
  if (!locale || locale === "en") {
    return { copy: "en", intl: financeIntlLocale("en") };
  }
  return { copy: "en", intl: locale };
}

function safeFilename(title: string, fallback: string): string {
  const base = title
    .trim()
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || fallback}.docx`;
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

function metricsTable(brief: FinanceBrief, locale: AppLocale): Table | null {
  if (brief.computed.metrics.length === 0) {
    return null;
  }
  const copy = financeCopy(locale);
  return docxTable(
    [copy.preview.metric, copy.preview.value, copy.preview.period, copy.preview.formula],
    brief.computed.metrics.map((metric) => [
      metric.label,
      formatMetricValue(metric, copy.metrics.missing),
      metric.period,
      metric.formula,
    ]),
  );
}

/** Real tables for line items, computed metrics, and totals; an assumptions appendix at the end. */
export async function buildFinanceDocx(
  brief: FinanceBrief,
  locale?: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const resolved = resolveDocxLocale(locale ?? financeBootLocale());
  const copy = financeCopy(resolved.copy);
  const intl = resolved.intl;
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
      children.push(docxTable(table.columns, table.rows, intl), new Paragraph({ spacing: { after: 160 } }));
    }
  }
  const metrics = metricsTable(brief, resolved.copy);
  if (metrics) {
    children.push(
      heading(copy.preview.computedMetrics, HeadingLevel.HEADING_1, 28, "1565C0"),
      metrics,
      new Paragraph({ spacing: { after: 160 } }),
    );
  }
  for (const table of brief.computed.tables) {
    children.push(
      heading(table.name, HeadingLevel.HEADING_2, 24, "1565C0"),
      docxTable(table.columns, table.rows, intl),
      new Paragraph({ spacing: { after: 160 } }),
    );
  }
  children.push(heading(copy.preview.assumptions, HeadingLevel.HEADING_1, 28, "1565C0"));
  children.push(...(brief.assumptions.length > 0 ? brief.assumptions.map(bullet) : [bullet(copy.preview.noneStated)]));

  const doc = new Document({ creator: resolvedProductName(), title: brief.title, sections: [{ children }] });
  return { buffer: await Packer.toBuffer(doc), filename: safeFilename(brief.title, "finance-brief") };
}
