/**
 * Walks w:body in order and collects raw paragraphs, tables, revisions, and comment ranges.
 * The walk keeps a local accumulator; nothing from the caller is mutated and the result is plain data.
 */
import type { Element } from "@xmldom/xmldom";
import type { DocxRevision, DocxRun, DocxTable, ParagraphAnchor, RevisionKind } from "./types";
import { BLOCK_WRAPPERS, INLINE_WRAPPERS, LINE_BREAK, attr, childElements, firstChild, localName, runText } from "./xml-utils";

const REVISION_TAGS: Readonly<Record<string, RevisionKind>> = { ins: "ins", del: "del", moveTo: "ins", moveFrom: "del" };
const NO_NUMBERING_ID = "0";
/** Anchor used for tables and their revisions when the table opens the body. */
const FIRST_ANCHOR: ParagraphAnchor = "¶0";
/** Cells of a nested table are flattened into the enclosing cell text with this separator. */
const NESTED_CELL_SEPARATOR = " | ";

export type RawParagraph = {
  style: string;
  listLevel?: number;
  runs: readonly DocxRun[];
  text: string;
  originalText: string;
};

export type RawBody = {
  paragraphs: readonly RawParagraph[];
  tables: readonly DocxTable[];
  revisions: readonly DocxRevision[];
  /** Comment id -> anchors of the paragraphs its range touches, in document order. */
  commentRanges: ReadonlyMap<string, readonly ParagraphAnchor[]>;
};

type WalkState = {
  paragraphs: RawParagraph[];
  tables: DocxTable[];
  revisions: DocxRevision[];
  commentRanges: Map<string, ParagraphAnchor[]>;
  activeComments: string[];
  validNumIds: ReadonlySet<string>;
};

export function anchorOf(index: number): ParagraphAnchor {
  return `¶${index}`;
}

export function readBody(body: Element, validNumIds: ReadonlySet<string>): RawBody {
  const state: WalkState = {
    paragraphs: [],
    tables: [],
    revisions: [],
    commentRanges: new Map(),
    activeComments: [],
    validNumIds,
  };
  walkBlocks(body, state);
  return {
    paragraphs: state.paragraphs,
    tables: state.tables,
    revisions: state.revisions,
    commentRanges: state.commentRanges,
  };
}

function walkBlocks(container: Element, state: WalkState): void {
  for (const child of childElements(container)) {
    const name = localName(child);
    if (name === "p") {
      state.paragraphs.push(readParagraph(child, anchorOf(state.paragraphs.length), state));
    } else if (name === "tbl") {
      state.tables.push(readTable(child, state));
    } else if (BLOCK_WRAPPERS.has(name)) {
      walkBlocks(child, state);
    } else if (name === "commentRangeStart") {
      openComment(attr(child, "id"), anchorOf(state.paragraphs.length), state);
    } else if (name === "commentRangeEnd") {
      closeComment(attr(child, "id"), state);
    }
  }
}

/** Direct block children of a cell or row container, descending through content-control wrappers. */
function blockChildren(container: Element): readonly Element[] {
  return childElements(container).flatMap((child) =>
    BLOCK_WRAPPERS.has(localName(child)) ? blockChildren(child) : [child],
  );
}

function readParagraph(paragraph: Element, anchor: ParagraphAnchor, state: WalkState): RawParagraph {
  registerActiveComments(anchor, state);
  const runs: DocxRun[] = [];
  const properties = firstChild(paragraph, "pPr");
  for (const child of childElements(paragraph)) {
    if (localName(child) !== "pPr") {
      collectInline(child, anchor, undefined, runs, state);
    }
  }
  const listLevel = properties ? readListLevel(properties, state.validNumIds) : undefined;
  return {
    style: properties ? attr(firstChild(properties, "pStyle") ?? properties, "val") : "",
    ...(listLevel === undefined ? {} : { listLevel }),
    runs,
    text: joinView(runs, "ins"),
    originalText: joinView(runs, "del"),
  };
}

function readListLevel(properties: Element, validNumIds: ReadonlySet<string>): number | undefined {
  const numbering = firstChild(properties, "numPr");
  if (!numbering) {
    return undefined;
  }
  const numId = attr(firstChild(numbering, "numId") ?? numbering, "val");
  if (numId === "" || numId === NO_NUMBERING_ID || (validNumIds.size > 0 && !validNumIds.has(numId))) {
    return undefined;
  }
  const level = Number.parseInt(attr(firstChild(numbering, "ilvl") ?? numbering, "val"), 10);
  return Number.isNaN(level) ? 0 : level;
}

function collectInline(
  element: Element,
  anchor: ParagraphAnchor,
  revision: RevisionKind | undefined,
  runs: DocxRun[],
  state: WalkState,
): void {
  const name = localName(element);
  if (name === "r") {
    const text = runText(element);
    if (text !== "") {
      runs.push(makeRun(text, revision, state.activeComments));
    }
    return;
  }
  const kind = REVISION_TAGS[name];
  if (kind !== undefined) {
    const inner: DocxRun[] = [];
    for (const child of childElements(element)) {
      collectInline(child, anchor, kind, inner, state);
    }
    state.revisions.push({
      id: attr(element, "id"),
      kind,
      author: attr(element, "author"),
      date: attr(element, "date"),
      text: inner.map((run) => run.text).join(""),
      paragraph: anchor,
    });
    runs.push(...inner);
    return;
  }
  if (name === "commentRangeStart") {
    openComment(attr(element, "id"), anchor, state);
  } else if (name === "commentRangeEnd") {
    closeComment(attr(element, "id"), state);
  } else if (INLINE_WRAPPERS.has(name)) {
    for (const child of childElements(element)) {
      collectInline(child, anchor, revision, runs, state);
    }
  }
}

function makeRun(text: string, revision: RevisionKind | undefined, activeComments: readonly string[]): DocxRun {
  return {
    text,
    ...(revision === undefined ? {} : { revision }),
    ...(activeComments.length === 0 ? {} : { comments: [...activeComments] }),
  };
}

/**
 * Joins the runs of one view. `keep` is the revision kind that belongs to the view ("ins" for the accepted
 * text, "del" for the original). When a dropped run leaves a space on both sides, one space is collapsed.
 */
function joinView(runs: readonly DocxRun[], keep: RevisionKind): string {
  let text = "";
  let dropped = false;
  for (const run of runs) {
    if (run.revision !== undefined && run.revision !== keep) {
      dropped = true;
      continue;
    }
    const collapse = dropped && text.endsWith(" ") && run.text.startsWith(" ");
    text += collapse ? run.text.slice(1) : run.text;
    dropped = false;
  }
  return text;
}

function openComment(id: string, anchor: ParagraphAnchor, state: WalkState): void {
  if (!state.activeComments.includes(id)) {
    state.activeComments.push(id);
  }
  registerComment(id, anchor, state);
}

function closeComment(id: string, state: WalkState): void {
  state.activeComments = state.activeComments.filter((active) => active !== id);
}

function registerActiveComments(anchor: ParagraphAnchor, state: WalkState): void {
  for (const id of state.activeComments) {
    registerComment(id, anchor, state);
  }
}

function registerComment(id: string, anchor: ParagraphAnchor, state: WalkState): void {
  const anchors = state.commentRanges.get(id) ?? [];
  if (anchors.at(-1) !== anchor) {
    state.commentRanges.set(id, [...anchors, anchor]);
  }
}

function readTable(table: Element, state: WalkState): DocxTable {
  const after = state.paragraphs.length > 0 ? anchorOf(state.paragraphs.length - 1) : null;
  return { index: state.tables.length, after, rows: tableRows(table, after ?? FIRST_ANCHOR, state) };
}

function tableRows(table: Element, anchor: ParagraphAnchor, state: WalkState): readonly (readonly string[])[] {
  return blockChildren(table)
    .filter((child) => localName(child) === "tr")
    .map((row) =>
      blockChildren(row)
        .filter((child) => localName(child) === "tc")
        .map((cell) => cellText(cell, anchor, state)),
    );
}

/** Accepted-changes text of a cell: paragraphs joined with newlines; nested tables flattened row by row. */
function cellText(cell: Element, anchor: ParagraphAnchor, state: WalkState): string {
  return blockChildren(cell)
    .flatMap((child) => {
      const name = localName(child);
      if (name === "p") {
        return [readParagraph(child, anchor, state).text];
      }
      if (name === "tbl") {
        return tableRows(child, anchor, state).map((row) => row.join(NESTED_CELL_SEPARATOR));
      }
      return [];
    })
    .join(LINE_BREAK);
}
