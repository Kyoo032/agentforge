/**
 * readDocx: unzip a .docx, parse its XML parts, and produce an immutable DocxDocument with accepted and
 * original text views, revisions, comments, tables, defined terms, and stats.
 */
import type { Element } from "@xmldom/xmldom";
import JSZip from "jszip";
import { detectDefinedTerms, detectHeading, detectNumber } from "./paragraph-analysis";
import { type RawParagraph, anchorOf, readBody } from "./read-body";
import type { DocxComment, DocxDocument, DocxParagraph, DocxTable, ParagraphAnchor } from "./types";
import { attr, childElements, descendants, docxError, firstChild, localName, parseXml, textOf } from "./xml-utils";

const DOCUMENT_PART = "word/document.xml";
const COMMENTS_PART = "word/comments.xml";
const NUMBERING_PART = "word/numbering.xml";
const CORE_PART = "docProps/core.xml";
const COMMENT_PARAGRAPH_SEPARATOR = "\n";
const WHITESPACE_RE = /\s+/;

export async function readDocx(bytes: Uint8Array): Promise<DocxDocument> {
  const zip = await openZip(bytes);
  const documentXml = await requiredPart(zip, DOCUMENT_PART);
  const body = findBody(parseXml(documentXml, DOCUMENT_PART).documentElement);
  const validNumIds = readNumberingIds(await optionalPart(zip, NUMBERING_PART));
  const raw = readBody(body, validNumIds);
  const paragraphs = raw.paragraphs.map((paragraph, index) => analyseParagraph(paragraph, index));
  const comments = readComments(await optionalPart(zip, COMMENTS_PART), raw.commentRanges);
  const meta = readMeta(await optionalPart(zip, CORE_PART));
  const definedTerms = paragraphs.flatMap((paragraph) => detectDefinedTerms(paragraph.text, paragraph.anchor));
  return {
    paragraphs,
    tables: raw.tables,
    revisions: raw.revisions,
    comments,
    definedTerms,
    meta,
    stats: {
      paragraphs: paragraphs.length,
      words: countWords(paragraphs, raw.tables),
      tables: raw.tables.length,
      insertions: raw.revisions.filter((revision) => revision.kind === "ins").length,
      deletions: raw.revisions.filter((revision) => revision.kind === "del").length,
      comments: comments.length,
    },
  };
}

async function openZip(bytes: Uint8Array): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw docxError(`not a zip archive (${detail})`);
  }
}

async function requiredPart(zip: JSZip, name: string): Promise<string> {
  const part = await optionalPart(zip, name);
  if (part === null) {
    throw docxError(`missing ${name}`);
  }
  return part;
}

async function optionalPart(zip: JSZip, name: string): Promise<string | null> {
  const file = zip.file(name);
  return file ? file.async("string") : null;
}

function findBody(root: Element | null): Element {
  const body = root && localName(root) === "document" ? firstChild(root, "body") : null;
  if (!body) {
    throw docxError(`${DOCUMENT_PART} has no w:document/w:body`);
  }
  return body;
}

/** Ids of w:num definitions; an empty set means numbering.xml is absent and any numId is accepted. */
function readNumberingIds(xml: string | null): ReadonlySet<string> {
  if (xml === null) {
    return new Set();
  }
  const root = parseXml(xml, NUMBERING_PART).documentElement;
  const ids = root ? descendants(root, "num").map((num) => attr(num, "numId")) : [];
  return new Set(ids.filter((id) => id !== ""));
}

function analyseParagraph(raw: RawParagraph, index: number): DocxParagraph {
  const number = detectNumber(raw.text);
  return {
    anchor: anchorOf(index),
    index,
    style: raw.style,
    number: number?.token ?? "",
    ...(raw.listLevel === undefined ? {} : { listLevel: raw.listLevel }),
    text: raw.text,
    originalText: raw.originalText,
    runs: raw.runs,
    isHeading: detectHeading(raw.text, raw.style, number),
  };
}

function readComments(
  xml: string | null,
  ranges: ReadonlyMap<string, readonly ParagraphAnchor[]>,
): readonly DocxComment[] {
  const root = xml === null ? null : parseXml(xml, COMMENTS_PART).documentElement;
  const declared = root ? descendants(root, "comment").map((comment) => commentFrom(comment, ranges)) : [];
  const declaredIds = new Set(declared.map((comment) => comment.id));
  const referencedOnly = [...ranges.entries()]
    .filter(([id]) => !declaredIds.has(id))
    .map(([id, paragraphs]) => ({ id, author: "", date: "", text: "", paragraphs }));
  return [...declared, ...referencedOnly];
}

function commentFrom(comment: Element, ranges: ReadonlyMap<string, readonly ParagraphAnchor[]>): DocxComment {
  const id = attr(comment, "id");
  const text = descendants(comment, "p")
    .map((paragraph) =>
      descendants(paragraph, "t")
        .map((run) => textOf(run))
        .join(""),
    )
    .join(COMMENT_PARAGRAPH_SEPARATOR);
  return { id, author: attr(comment, "author"), date: attr(comment, "date"), text, paragraphs: ranges.get(id) ?? [] };
}

function readMeta(xml: string | null): DocxDocument["meta"] {
  const root = xml === null ? null : parseXml(xml, CORE_PART).documentElement;
  const field = (name: string): string => {
    const element = root ? childElements(root).find((child) => localName(child) === name) : undefined;
    return element ? textOf(element).trim() : "";
  };
  return { title: field("title"), author: field("creator"), created: field("created"), modified: field("modified") };
}

function countWords(paragraphs: readonly DocxParagraph[], tables: readonly DocxTable[]): number {
  const texts = [...paragraphs.map((paragraph) => paragraph.text), ...tables.flatMap((table) => table.rows.flat())];
  return texts.reduce((total, text) => total + text.split(WHITESPACE_RE).filter((word) => word !== "").length, 0);
}
