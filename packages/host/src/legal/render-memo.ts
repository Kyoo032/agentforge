/**
 * Issues memorandum renderer. The outline comes from the model; every word of substance is
 * expanded from findings in code. Both outputs (docx and plain text) are rendered from the same
 * block list so the verifier can run on the text and be sure it matches the document.
 */
import { Document, HeadingLevel, Packer, Paragraph, type Table, TextRun } from "docx";
import { resolvedProductName } from "@agentforge/core";
import type { Finding, LegalSide, MemoOutline } from "@agentforge/core/legal";
import { docxTable } from "../docx-table";
import {
  CLOSING_LINE,
  NOT_FOUND_TOKEN,
  findingLabel,
  findingsById,
  formatBasis,
  positionLine,
  proposedLanguage,
} from "./render-shared";

export const MEMO_TITLE = "MEMORANDUM";
export const PRIVILEGE_LINE = "PRIVILEGED AND CONFIDENTIAL — ATTORNEY WORK PRODUCT";
export const FINDINGS_TABLE_COLUMNS = ["Clause", "Provision", "Why adverse", "Severity", "Proposed language", "Basis"];

const TOKEN_PATTERN = /\{\{\s*(F[\w-]+)\s*\}\}/g;
const FONT = "Calibri";
const TITLE_COLOR = "0D2137";
const HEADING_COLOR = "1565C0";
const TEXT_ROW_SEPARATOR = " | ";

export type MemoContext = { side?: LegalSide; firm?: string };

export type MemoBlock =
  | { kind: "title"; text: string }
  | { kind: "line"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; columns: readonly string[]; rows: readonly (readonly string[])[] };

/** Replaces `{{F3}}` with the finding label; unknown ids become a visible marker rather than vanishing. */
export function expandFindingTokens(text: string, byId: ReadonlyMap<string, Finding>): string {
  return text.replace(TOKEN_PATTERN, (_match, id: string) => {
    const finding = byId.get(id);
    return finding ? findingLabel(finding) : NOT_FOUND_TOKEN;
  });
}

function tableRow(finding: Finding): readonly string[] {
  return [
    finding.clause,
    finding.quote,
    finding.why,
    finding.severity,
    proposedLanguage(finding),
    formatBasis(finding.basis),
  ];
}

function headerBlocks(outline: MemoOutline, context: MemoContext): MemoBlock[] {
  const optional: MemoBlock[] = [
    ...(outline.privileged ? [{ kind: "line", text: PRIVILEGE_LINE } as const] : []),
    ...(context.firm ? [{ kind: "line", text: `Firm: ${context.firm}` } as const] : []),
    ...(context.side ? [{ kind: "line", text: positionLine(context.side) } as const] : []),
  ];
  return [
    { kind: "title", text: MEMO_TITLE },
    ...optional,
    { kind: "line", text: `To: ${outline.to}` },
    { kind: "line", text: `From: ${outline.from}` },
    { kind: "line", text: `Date: ${outline.date}` },
    { kind: "line", text: `Re: ${outline.re}` },
  ];
}

function sectionBlocks(outline: MemoOutline, byId: ReadonlyMap<string, Finding>): MemoBlock[] {
  return outline.sections.flatMap((section) => {
    const listed = (section.findingsTable ?? []).flatMap((id) => {
      const finding = byId.get(id);
      return finding ? [tableRow(finding)] : [];
    });
    const table: MemoBlock[] =
      section.findingsTable === undefined ? [] : [{ kind: "table", columns: FINDINGS_TABLE_COLUMNS, rows: listed }];
    return [
      { kind: "heading", text: section.heading },
      ...section.paragraphs.map((text): MemoBlock => ({ kind: "paragraph", text: expandFindingTokens(text, byId) })),
      ...table,
    ];
  });
}

/** The full memo as ordered blocks; the closing line is always last. */
export function memoBlocks(outline: MemoOutline, findings: readonly Finding[], context: MemoContext = {}): MemoBlock[] {
  const byId = findingsById(findings);
  return [
    ...headerBlocks(outline, context),
    ...sectionBlocks(outline, byId),
    { kind: "paragraph", text: CLOSING_LINE },
  ];
}

function blockText(block: MemoBlock): string[] {
  if (block.kind !== "table") {
    return [block.text];
  }
  return [block.columns.join(TEXT_ROW_SEPARATOR), ...block.rows.map((row) => row.join(TEXT_ROW_SEPARATOR))];
}

/** Plain text with the same words as the docx, one block per line; tables as "a | b | c" rows. */
export function renderMemoText(outline: MemoOutline, findings: readonly Finding[], context: MemoContext = {}): string {
  return memoBlocks(outline, findings, context).flatMap(blockText).join("\n");
}

function run(text: string, options: { bold?: boolean; size: number; color?: string }): TextRun {
  return new TextRun({ text, font: FONT, ...options });
}

function blockDocx(block: MemoBlock): Array<Paragraph | Table> {
  switch (block.kind) {
    case "title":
      return [
        new Paragraph({
          heading: HeadingLevel.TITLE,
          spacing: { after: 200 },
          children: [run(block.text, { bold: true, size: 40, color: TITLE_COLOR })],
        }),
      ];
    case "line":
      return [new Paragraph({ spacing: { after: 60 }, children: [run(block.text, { size: 22, bold: true })] })];
    case "heading":
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 120 },
          children: [run(block.text, { bold: true, size: 28, color: HEADING_COLOR })],
        }),
      ];
    case "paragraph":
      return [new Paragraph({ spacing: { after: 200 }, children: [run(block.text, { size: 22 })] })];
    case "table":
      return [docxTable(block.columns, block.rows), new Paragraph({ spacing: { after: 160 } })];
  }
}

/** Memo docx plus the plain text it was rendered from, for the verifier. */
export async function renderMemoDocx(input: {
  outline: MemoOutline;
  findings: readonly Finding[];
  side: LegalSide;
  firm: string;
}): Promise<{ bytes: Uint8Array; text: string }> {
  const context: MemoContext = { side: input.side, firm: input.firm };
  const blocks = memoBlocks(input.outline, input.findings, context);
  const doc = new Document({
    creator: input.firm || resolvedProductName(),
    title: input.outline.re,
    description: MEMO_TITLE,
    sections: [{ children: blocks.flatMap(blockDocx) }],
  });
  const buffer = await Packer.toBuffer(doc);
  return {
    bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    text: blocks.flatMap(blockText).join("\n"),
  };
}
