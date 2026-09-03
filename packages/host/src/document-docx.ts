import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { resolvedProductName } from "@agentforge/core";
import type { DocumentDraft } from "./document-outline";

function safeFilename(title: string): string {
  const base = title
    .trim()
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "document"}.docx`;
}

function paragraphsFromBody(body: string): Paragraph[] {
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) {
    return [new Paragraph({ children: [new TextRun({ text: body.trim(), font: "Calibri", size: 22 })] })];
  }
  return blocks.map(
    (block) =>
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ text: block, font: "Calibri", size: 22 })],
      }),
  );
}

export async function buildDocumentDocx(draft: DocumentDraft): Promise<{ buffer: Buffer; filename: string }> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 300 },
      children: [new TextRun({ text: draft.title, font: "Calibri", bold: true, size: 48, color: "0D2137" })],
    }),
  ];

  for (const section of draft.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280, after: 120 },
        children: [new TextRun({ text: section.heading, font: "Calibri", bold: true, size: 28, color: "1565C0" })],
      }),
      ...paragraphsFromBody(section.body),
    );
  }

  const doc = new Document({
    creator: resolvedProductName(),
    title: draft.title,
    sections: [{ children }],
  });
  const buffer = await Packer.toBuffer(doc);
  return { buffer, filename: safeFilename(draft.title) };
}
