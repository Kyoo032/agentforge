/**
 * Shared helpers for the docx test suites: fixture loading, an in-memory docx builder, and
 * a factory for hand-built DocxDocument values. Not a test file itself (vitest only runs *.test.ts).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import type { DefinedTerm, DocxDocument, DocxParagraph, DocxRun, DocxTable, ParagraphAnchor } from "./types";

export const FIXTURE_NAMES = [
  "lender-initial-aca-draft",
  "depositary-bank-round-1-redline",
  "borrower-round-2-comments",
  "lender-round-3-counter-redline",
  "original-term-sheet",
  "lender-markup-term-sheet",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function loadFixture(name: FixtureName): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURE_DIR, `${name}.docx`)));
}

export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export type DocxParts = {
  /** Inner XML of w:body. Wrapped in w:document/w:body with the w and r namespaces declared. */
  body?: string;
  /** Full word/document.xml text; overrides `body`. Pass null to omit the part entirely. */
  document?: string | null;
  comments?: string;
  numbering?: string;
  core?: string;
};

export function wrapBody(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body}</w:body></w:document>`;
}

/** Builds a minimal but valid docx package in memory. */
export async function buildDocx(parts: DocxParts): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  const documentXml = parts.document === undefined ? wrapBody(parts.body ?? "") : parts.document;
  if (documentXml !== null) {
    zip.file("word/document.xml", documentXml);
  }
  if (parts.comments !== undefined) {
    zip.file("word/comments.xml", parts.comments);
  }
  if (parts.numbering !== undefined) {
    zip.file("word/numbering.xml", parts.numbering);
  }
  if (parts.core !== undefined) {
    zip.file("docProps/core.xml", parts.core);
  }
  return zip.generateAsync({ type: "uint8array" });
}

export type ParagraphSpec = {
  text: string;
  originalText?: string;
  number?: string;
  style?: string;
  isHeading?: boolean;
  runs?: readonly DocxRun[];
  definedTerms?: readonly Omit<DefinedTerm, "paragraph">[];
};

export function anchorOf(index: number): ParagraphAnchor {
  return `¶${index}`;
}

export function makeParagraph(index: number, spec: ParagraphSpec | string): DocxParagraph {
  const resolved: ParagraphSpec = typeof spec === "string" ? { text: spec } : spec;
  return {
    anchor: anchorOf(index),
    index,
    style: resolved.style ?? "",
    number: resolved.number ?? "",
    text: resolved.text,
    originalText: resolved.originalText ?? resolved.text,
    runs: resolved.runs ?? [{ text: resolved.text }],
    isHeading: resolved.isHeading ?? false,
  };
}

export type DocumentSpec = {
  paragraphs: readonly (ParagraphSpec | string)[];
  tables?: readonly DocxTable[];
};

/** Hand-builds a DocxDocument from paragraph specs. Revisions/comments are derived from the runs. */
export function makeDocument(spec: DocumentSpec): DocxDocument {
  const paragraphs = spec.paragraphs.map((item, index) => makeParagraph(index, item));
  const definedTerms = spec.paragraphs.flatMap((item, index) =>
    typeof item === "string" ? [] : (item.definedTerms ?? []).map((term) => ({ ...term, paragraph: anchorOf(index) })),
  );
  const revisions = paragraphs.flatMap((paragraph) =>
    paragraph.runs
      .filter((run) => run.revision !== undefined)
      .map((run, offset) => ({
        id: `${paragraph.index}-${offset}`,
        kind: run.revision as "ins" | "del",
        author: "test",
        date: "",
        text: run.text,
        paragraph: paragraph.anchor,
      })),
  );
  const tables = spec.tables ?? [];
  const words = [...paragraphs.map((paragraph) => paragraph.text), ...tables.flatMap((table) => table.rows.flat())]
    .join(" ")
    .split(/\s+/)
    .filter((word) => word !== "").length;
  return {
    paragraphs,
    tables,
    revisions,
    comments: [],
    definedTerms,
    meta: { title: "", author: "test", created: "", modified: "" },
    stats: {
      paragraphs: paragraphs.length,
      words,
      tables: tables.length,
      insertions: revisions.filter((revision) => revision.kind === "ins").length,
      deletions: revisions.filter((revision) => revision.kind === "del").length,
      comments: 0,
    },
  };
}
