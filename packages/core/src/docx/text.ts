/**
 * Text views over a DocxDocument: the anchored plain-text rendering handed to the model, anchor lookup, and the
 * verbatim-quote check used to verify citations against the accepted text.
 */
import type { DocxDocument, DocxParagraph, DocxTable, ParagraphAnchor } from "./types";

const LINE = "\n";
const CELL_SEPARATOR = " | ";
const CELL_LINE_BREAK_RE = /\s*\n\s*/g;
/** Anchor reported for a table that opens the body (no preceding paragraph). */
const FIRST_ANCHOR: ParagraphAnchor = "¶0";

export type BodyItem = { kind: "paragraph"; paragraph: DocxParagraph } | { kind: "table"; table: DocxTable };

/** Paragraphs and tables interleaved in body order: a table follows the paragraph named by its `after`. */
export function bodyOrder(doc: DocxDocument): readonly BodyItem[] {
  const tablesAfter = new Map<ParagraphAnchor | null, DocxTable[]>();
  for (const table of doc.tables) {
    tablesAfter.set(table.after, [...(tablesAfter.get(table.after) ?? []), table]);
  }
  const placed = new Set<number>();
  const take = (anchor: ParagraphAnchor | null): BodyItem[] =>
    (tablesAfter.get(anchor) ?? []).map((table) => {
      placed.add(table.index);
      return { kind: "table", table };
    });
  const items: BodyItem[] = [
    ...take(null),
    ...doc.paragraphs.flatMap((paragraph): BodyItem[] => [{ kind: "paragraph", paragraph }, ...take(paragraph.anchor)]),
  ];
  const orphans = doc.tables.filter((table) => !placed.has(table.index)).map((table): BodyItem => ({ kind: "table", table }));
  return [...items, ...orphans];
}

function tableLines(table: DocxTable): readonly string[] {
  return table.rows.map(
    (row) => `[T${table.index}] ${row.map((cell) => cell.replace(CELL_LINE_BREAK_RE, " ")).join(CELL_SEPARATOR)}`,
  );
}

/** Whole document as anchored lines: "[¶12] text" per paragraph and "[T0] a | b" per table row, in body order. */
export function documentText(doc: DocxDocument): string {
  return bodyOrder(doc)
    .flatMap((item) => (item.kind === "paragraph" ? [`[${item.paragraph.anchor}] ${item.paragraph.text}`] : tableLines(item.table)))
    .join(LINE);
}

export function paragraphByAnchor(doc: DocxDocument, anchor: ParagraphAnchor): DocxParagraph | null {
  return doc.paragraphs.find((paragraph) => paragraph.anchor === anchor) ?? null;
}

export type QuoteHit = {
  anchor: ParagraphAnchor;
  /** Offset into the paragraph's (or cell's) accepted text where the quote starts. */
  start: number;
  /** Present when the hit is inside a table cell; `anchor` is then the paragraph the table follows. */
  table?: { index: number; row: number; cell: number };
};

const WHITESPACE_RE = /\s/;
const QUOTE_MARK_RE = /["'`´‘’‚‛“”„‟‹›«»]/;
const DASH_RE = /[‐‑‒–—−]/;
const CANONICAL_QUOTE = '"';
const CANONICAL_DASH = "-";
const CANONICAL_SPACE = " ";

type Normalized = { value: string; offsets: readonly number[] };

/** Collapses whitespace runs, unifies quote marks and dashes, and keeps a map back to original offsets. */
function normalizeForSearch(text: string): Normalized {
  let value = "";
  const offsets: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (WHITESPACE_RE.test(char)) {
      if (value.endsWith(CANONICAL_SPACE)) {
        continue;
      }
      value += CANONICAL_SPACE;
    } else if (QUOTE_MARK_RE.test(char)) {
      value += CANONICAL_QUOTE;
    } else if (DASH_RE.test(char)) {
      value += CANONICAL_DASH;
    } else {
      value += char;
    }
    offsets.push(index);
  }
  return { value, offsets };
}

function locate(haystack: string, needle: string): number | null {
  const { value, offsets } = normalizeForSearch(haystack);
  const at = value.indexOf(needle);
  return at === -1 ? null : (offsets[at] ?? null);
}

function findInTable(table: DocxTable, needle: string): QuoteHit | null {
  for (const [rowIndex, row] of table.rows.entries()) {
    for (const [cellIndex, cell] of row.entries()) {
      const start = locate(cell, needle);
      if (start !== null) {
        return { anchor: table.after ?? FIRST_ANCHOR, start, table: { index: table.index, row: rowIndex, cell: cellIndex } };
      }
    }
  }
  return null;
}

/**
 * Finds a quote in the accepted text of the document, tolerant of whitespace runs, line breaks, and straight vs
 * curly / single vs double quote marks. Returns the first hit in body order or null.
 */
export function findQuote(doc: DocxDocument, quote: string): QuoteHit | null {
  const needle = normalizeForSearch(quote).value.trim();
  if (needle === "") {
    return null;
  }
  for (const item of bodyOrder(doc)) {
    if (item.kind === "table") {
      const hit = findInTable(item.table, needle);
      if (hit) {
        return hit;
      }
      continue;
    }
    const start = locate(item.paragraph.text, needle);
    if (start !== null) {
      return { anchor: item.paragraph.anchor, start };
    }
  }
  return null;
}
