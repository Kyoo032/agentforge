/**
 * Shared, immutable shapes for the docx reader, clause splitter, diff, and redline writer.
 * Everything here is plain data. Nothing mutates its input; every function returns new objects.
 */

/** A paragraph anchor is stable within one document read: "¶12" is the 13th body paragraph (0-based index 12). */
export type ParagraphAnchor = `¶${number}`;

export type RevisionKind = "ins" | "del";

export type DocxRevision = {
  /** w:id of the w:ins / w:del element. */
  id: string;
  kind: RevisionKind;
  author: string;
  /** ISO 8601 as written in the file, or "" when absent. */
  date: string;
  /** Text inside the revision. For "del" this is the w:delText content. */
  text: string;
  paragraph: ParagraphAnchor;
};

export type DocxComment = {
  id: string;
  author: string;
  date: string;
  text: string;
  /** Paragraph anchors whose range the comment covers (commentRangeStart .. commentRangeEnd). */
  paragraphs: readonly ParagraphAnchor[];
};

export type DocxRun = {
  text: string;
  /** "ins" | "del" when inside a revision, otherwise undefined. */
  revision?: RevisionKind;
  /** Comment ids whose range covers this run. */
  comments?: readonly string[];
};

export type DocxParagraph = {
  anchor: ParagraphAnchor;
  /** 0-based index in body order. Table cell paragraphs are not included here; see DocxTable. */
  index: number;
  /** Paragraph style id (w:pStyle), e.g. "Heading1", "ListParagraph". Empty string when unstyled. */
  style: string;
  /** Detected clause number from w:numPr level or from leading text like "7.2" / "(b)" / "Section 7.2". "" when none. */
  number: string;
  /** 0-based w:ilvl when the paragraph carries a w:numPr that resolves to a numbering definition; absent otherwise. */
  listLevel?: number;
  /**
   * Accepted-changes view: insertions included, deletions excluded. This is the text that citations,
   * quotes, and the diff work against.
   */
  text: string;
  /** Original view: deletions included, insertions excluded. Equal to `text` when the paragraph has no revisions. */
  originalText: string;
  runs: readonly DocxRun[];
  isHeading: boolean;
};

export type DocxTable = {
  index: number;
  /** Body paragraph anchor immediately before the table, or null when the table opens the body. */
  after: ParagraphAnchor | null;
  /** Accepted-changes text per cell. */
  rows: readonly (readonly string[])[];
};

export type DefinedTerm = {
  term: string;
  /** The paragraph that defines it. */
  paragraph: ParagraphAnchor;
  /** Definition text after the term, trimmed; may be truncated by the reader at 400 chars. */
  definition: string;
};

export type DocxDocument = {
  paragraphs: readonly DocxParagraph[];
  tables: readonly DocxTable[];
  revisions: readonly DocxRevision[];
  comments: readonly DocxComment[];
  definedTerms: readonly DefinedTerm[];
  /** Core properties when present. */
  meta: { title: string; author: string; created: string; modified: string };
  /** Simple counters for the UI and the coverage check. */
  stats: { paragraphs: number; words: number; tables: number; insertions: number; deletions: number; comments: number };
};

/** One clause as split by numbering, e.g. "§7.2(b)". */
export type DocxClause = {
  /** Display id with section sign: "§7.2(b)", "§1.1 \"Material Adverse Effect\"", "Article VII". */
  id: string;
  /** Sortable numeric path, e.g. [7, 2, 2] for 7.2(b). */
  path: readonly number[];
  heading: string;
  paragraphs: readonly ParagraphAnchor[];
  /** Accepted-changes text of all paragraphs in the clause, joined with newlines. */
  text: string;
  /** Id of the enclosing clause ("§7.2" for "§7.2(b)"), or null at top level. */
  parent: string | null;
};

export type ParagraphChangeKind = "unchanged" | "changed" | "added" | "removed";

/** A word-level edit inside one aligned paragraph pair. */
export type WordEdit = {
  kind: "equal" | "insert" | "delete";
  text: string;
};

export type ParagraphChange = {
  kind: ParagraphChangeKind;
  prior: ParagraphAnchor | null;
  next: ParagraphAnchor | null;
  before: string;
  after: string;
  /** Word-level edits for "changed" pairs; empty otherwise. */
  edits: readonly WordEdit[];
  /**
   * True when the next document carries tracked-change revisions inside this paragraph.
   * A "changed" paragraph with marked=false is an unmarked (silent) change.
   */
  marked: boolean;
  /** Clause id from the next document when known. */
  clause: string | null;
};

export type DocxDiff = {
  changes: readonly ParagraphChange[];
  /** Subset of changes with kind "changed" | "added" | "removed" and marked === false. */
  unmarked: readonly ParagraphChange[];
  /** Defined terms whose definition text differs between the two documents. */
  definitionChanges: readonly { term: string; before: string; after: string }[];
  /** Section numbers present in prior but whose heading text moved to a different number in next. */
  renumbered: readonly { before: string; after: string; heading: string }[];
};

/** One redline instruction for the writer. `find` must be an exact substring of the paragraph's accepted text. */
export type RedlinePatch = {
  anchor: ParagraphAnchor;
  find: string;
  replace: string;
  /** Margin comment attached to the inserted run. */
  comment?: string;
};

/** Insert a whole new paragraph (e.g. a missing clause) after `after`. */
export type RedlineInsertParagraph = {
  after: ParagraphAnchor;
  text: string;
  /** Copy paragraph properties (style, numbering, indent) from this anchor; defaults to `after`. */
  styleFrom?: ParagraphAnchor;
  comment?: string;
};

export type RedlineOptions = {
  author: string;
  /** ISO 8601; defaults to now. */
  date?: string;
  /** Initials shown in Word's comment bubble; defaults to the author's initials. */
  initials?: string;
};

export type RedlineFailure = {
  patch: RedlinePatch | RedlineInsertParagraph;
  reason: "anchor-not-found" | "find-not-found" | "find-ambiguous" | "inside-revision";
};

export type RedlineResult = {
  bytes: Uint8Array;
  applied: number;
  failed: readonly RedlineFailure[];
  /** Revision ids created, in document order. */
  revisionIds: readonly string[];
};

export type DocxValidationIssue = {
  code:
    | "not-a-zip"
    | "missing-content-types"
    | "missing-document"
    | "xml-not-well-formed"
    | "dangling-relationship"
    | "unregistered-part"
    | "duplicate-revision-id"
    | "comment-without-range";
  detail: string;
};

export type DocxValidation = {
  ok: boolean;
  issues: readonly DocxValidationIssue[];
};
