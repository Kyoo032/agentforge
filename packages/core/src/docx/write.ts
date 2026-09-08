/**
 * Redline writer: applies find/replace patches and paragraph inserts to a .docx as Word tracked changes
 * (w:ins / w:del) with optional margin comments. The input bytes are never touched; a fresh zip is produced.
 */
import type { Document, Element, Node } from "@xmldom/xmldom";
import JSZip from "jszip";
import type { RedlineFailure, RedlineInsertParagraph, RedlineOptions, RedlinePatch, RedlineResult } from "./types";
import {
  anchorIndex,
  bodyParagraphs,
  CONTENT_TYPES_NS,
  childW,
  COMMENTS_CONTENT_TYPE,
  COMMENTS_REL_TYPE,
  createTextElement,
  createW,
  descendantsW,
  elementChildren,
  isW,
  maxNumericAttribute,
  PACKAGE_RELS_NS,
  PART,
  type ParagraphText,
  paragraphText,
  parseXml,
  type RunSegment,
  runText,
  serializeXml,
  setWAttr,
  splitRun,
  W_NS,
  wAttr,
  walkElements,
} from "./xml-utils";

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const EMPTY_COMMENTS = `${XML_DECLARATION}\n<w:comments xmlns:w="${W_NS}"></w:comments>`;
const EMPTY_RELS = `${XML_DECLARATION}\n<Relationships xmlns="${PACKAGE_RELS_NS}"></Relationships>`;
const COMMENTS_PART_NAME = `/${PART.comments}`;
const COMMENTS_TARGET = "comments.xml";
const REL_ID_PREFIX = "rId";
const COMMENT_REFERENCE_STYLE = "CommentReference";
const COMMENT_TEXT_STYLE = "CommentText";
const STORE_MAGIC = "\u0000\u0000";
/** Paragraph-property children that must not travel with a cloned w:pPr (section breaks, prior revisions). */
const PPR_STRIP = ["sectPr", "pPrChange"];
/** Run-property children that would carry a foreign revision id into a new run. */
const RPR_STRIP = ["ins", "del", "rPrChange"];
const MILLISECONDS = /\.\d{3}Z$/;

type Stamp = { readonly author: string; readonly date: string; readonly initials: string };
type Counter = { readonly next: () => string };

type Session = {
  readonly zip: JSZip;
  readonly doc: Document;
  /** Body paragraphs captured before any edit, so every anchor resolves against the original indexing. */
  readonly paragraphs: readonly Element[];
  readonly stamp: Stamp;
  readonly revisionIds: Counter;
  readonly firstRevisionId: number;
  readonly comments: Document;
  readonly commentIds: Counter;
  readonly styles: ReadonlySet<string>;
};

type Match = { readonly text: ParagraphText; readonly start: number; readonly end: number };
/** First and last element of a change, used to wrap it in a comment range. */
type Span = { readonly first: Element; readonly last: Element };

function counter(start: number): Counter {
  let value = start;
  return {
    next: () => {
      const current = value;
      value += 1;
      return String(current);
    },
  };
}

function initialsOf(author: string): string {
  return author
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function stampFrom(options: RedlineOptions): Stamp {
  return {
    author: options.author,
    date: options.date ?? new Date().toISOString().replace(MILLISECONDS, "Z"),
    initials: options.initials ?? initialsOf(options.author),
  };
}

async function readPart(zip: JSZip, name: string): Promise<string | null> {
  const entry = zip.file(name);
  return entry ? entry.async("string") : null;
}

async function requirePart(zip: JSZip, name: string): Promise<string> {
  const text = await readPart(zip, name);
  if (text === null) throw new Error(`Not a Word document: ${name} is missing`);
  return text;
}

function maxWId(doc: Document): number {
  const carriers: Element[] = [];
  walkElements(doc, (el) => {
    if (el.getAttributeNS(W_NS, "id") !== null) carriers.push(el);
  });
  return maxNumericAttribute(carriers, (el) => wAttr(el, "id"));
}

async function openSession(zip: JSZip, options: RedlineOptions): Promise<Session> {
  const doc = parseXml(await requirePart(zip, PART.document), PART.document);
  const commentsXml = await readPart(zip, PART.comments);
  const comments = parseXml(commentsXml ?? EMPTY_COMMENTS, PART.comments);
  const stylesXml = await readPart(zip, PART.styles);
  const styles = stylesXml
    ? new Set(descendantsW(parseXml(stylesXml, PART.styles), "style").map((style) => wAttr(style, "styleId")))
    : new Set<string>();
  const firstRevisionId = maxWId(doc) + 1;
  const commentStart = maxNumericAttribute(descendantsW(comments, "comment"), (el) => wAttr(el, "id")) + 1;
  return {
    zip,
    doc,
    paragraphs: bodyParagraphs(doc),
    stamp: stampFrom(options),
    revisionIds: counter(firstRevisionId),
    firstRevisionId,
    comments,
    commentIds: counter(commentStart),
    styles,
  };
}

function paragraphAt(session: Session, anchor: string): Element | null {
  const index = anchorIndex(anchor);
  return index === null ? null : (session.paragraphs[index] ?? null);
}

function createRevision(session: Session, kind: "ins" | "del"): Element {
  const el = createW(session.doc, kind);
  setWAttr(el, "id", session.revisionIds.next());
  setWAttr(el, "author", session.stamp.author);
  setWAttr(el, "date", session.stamp.date);
  return el;
}

function removeChildrenW(el: Element, locals: readonly string[]): void {
  for (const child of elementChildren(el)) {
    if (locals.some((local) => isW(child, local))) el.removeChild(child);
  }
}

/** Deep copy of a run's w:rPr without revision markers, or null when the run has none. */
function cloneRunProperties(run: Element | null): Element | null {
  const rPr = run ? childW(run, "rPr") : null;
  if (!rPr) return null;
  const copy = rPr.cloneNode(true) as Element;
  removeChildrenW(copy, RPR_STRIP);
  return copy;
}

function createRun(session: Session, rPr: Element | null, text: string): Element {
  const run = createW(session.doc, "r");
  if (rPr) run.appendChild(rPr);
  run.appendChild(createTextElement(session.doc, "t", text));
  return run;
}

function overlapsRevision(segment: RunSegment, start: number, end: number): boolean {
  if (!segment.revision) return false;
  const isPoint = segment.start === segment.end;
  return isPoint ? segment.start > start && segment.start < end : segment.start < end && segment.end > start;
}

function locate(session: Session, patch: RedlinePatch): Match | RedlineFailure["reason"] {
  const paragraph = paragraphAt(session, patch.anchor);
  if (!paragraph) return "anchor-not-found";
  const text = paragraphText(paragraph);
  if (patch.find === "") return "find-not-found";
  const start = text.text.indexOf(patch.find);
  if (start < 0) return "find-not-found";
  if (text.text.indexOf(patch.find, start + 1) >= 0) return "find-ambiguous";
  const end = start + patch.find.length;
  if (text.segments.some((segment) => overlapsRevision(segment, start, end))) return "inside-revision";
  return { text, start, end };
}

function parentOf(node: Node): Node {
  const parent = node.parentNode;
  if (!parent) throw new Error("Detached node encountered while editing document.xml");
  return parent;
}

/** Replaces `run` in its parent with up to three runs so that exactly [from, to) sits in one run, which is returned. */
function isolate(run: Element, from: number, to: number): Element {
  const parent = parentOf(run);
  const length = runText(run).length;
  let target = run;
  let cut = to;
  if (from > 0) {
    const [left, rest] = splitRun(run, from);
    parent.insertBefore(left, run);
    parent.replaceChild(rest, run);
    target = rest;
    cut -= from;
  }
  if (cut < length - from) {
    const [middle, right] = splitRun(target, cut);
    parent.insertBefore(middle, target);
    parent.replaceChild(right, target);
    target = middle;
  }
  return target;
}

/** Consecutive runs that share a parent form one group, so each group can become a single w:del. */
function groupByParent(runs: readonly Element[]): readonly (readonly Element[])[] {
  const groups: Element[][] = [];
  for (const run of runs) {
    const last = groups[groups.length - 1];
    if (last && last[0]?.parentNode === run.parentNode) last.push(run);
    else groups.push([run]);
  }
  return groups;
}

function markDeleted(session: Session, runs: readonly Element[]): Element {
  const first = runs[0];
  if (!first) throw new Error("Cannot delete an empty run group");
  const del = createRevision(session, "del");
  parentOf(first).insertBefore(del, first);
  for (const run of runs) {
    parentOf(run).removeChild(run);
    del.appendChild(run);
    for (const t of descendantsW(run, "t")) {
      parentOf(t).replaceChild(createTextElement(session.doc, "delText", t.textContent ?? ""), t);
    }
  }
  return del;
}

function replaceMatch(session: Session, match: Match, replace: string): Span {
  const hits = match.text.segments.filter(
    (segment) => !segment.revision && segment.start < match.end && segment.end > match.start,
  );
  const isolated = hits.map((segment) =>
    isolate(
      segment.run,
      Math.max(match.start, segment.start) - segment.start,
      Math.min(match.end, segment.end) - segment.start,
    ),
  );
  const deletions = groupByParent(isolated).map((group) => markDeleted(session, group));
  const firstDel = deletions[0];
  const lastDel = deletions[deletions.length - 1];
  if (!firstDel || !lastDel) throw new Error("A located match produced no runs to delete");
  if (replace === "") return { first: firstDel, last: lastDel };
  const ins = createRevision(session, "ins");
  ins.appendChild(createRun(session, cloneRunProperties(isolated[0] ?? null), replace));
  parentOf(lastDel).insertBefore(ins, lastDel.nextSibling);
  return { first: firstDel, last: ins };
}

function addComment(session: Session, text: string): string {
  const doc = session.comments;
  const id = session.commentIds.next();
  const comment = createW(doc, "comment");
  setWAttr(comment, "id", id);
  setWAttr(comment, "author", session.stamp.author);
  setWAttr(comment, "date", session.stamp.date);
  setWAttr(comment, "initials", session.stamp.initials);
  const paragraph = createW(doc, "p");
  if (session.styles.has(COMMENT_TEXT_STYLE)) {
    const pPr = createW(doc, "pPr");
    const pStyle = createW(doc, "pStyle");
    setWAttr(pStyle, "val", COMMENT_TEXT_STYLE);
    pPr.appendChild(pStyle);
    paragraph.appendChild(pPr);
  }
  const annotation = createW(doc, "r");
  const annotationRef = createW(doc, "annotationRef");
  annotation.appendChild(annotationRef);
  const body = createW(doc, "r");
  body.appendChild(createTextElement(doc, "t", text));
  paragraph.appendChild(annotation);
  paragraph.appendChild(body);
  comment.appendChild(paragraph);
  doc.documentElement?.appendChild(comment);
  return id;
}

function commentReferenceRun(session: Session, id: string): Element {
  const run = createW(session.doc, "r");
  if (session.styles.has(COMMENT_REFERENCE_STYLE)) {
    const rPr = createW(session.doc, "rPr");
    const rStyle = createW(session.doc, "rStyle");
    setWAttr(rStyle, "val", COMMENT_REFERENCE_STYLE);
    rPr.appendChild(rStyle);
    run.appendChild(rPr);
  }
  const reference = createW(session.doc, "commentReference");
  setWAttr(reference, "id", id);
  run.appendChild(reference);
  return run;
}

/** Wraps [span.first .. span.last] in commentRangeStart/End followed by the reference run. */
function attachComment(session: Session, span: Span, text: string): void {
  const id = addComment(session, text);
  const start = createW(session.doc, "commentRangeStart");
  setWAttr(start, "id", id);
  const end = createW(session.doc, "commentRangeEnd");
  setWAttr(end, "id", id);
  parentOf(span.first).insertBefore(start, span.first);
  const parent = parentOf(span.last);
  parent.insertBefore(end, span.last.nextSibling);
  parent.insertBefore(commentReferenceRun(session, id), end.nextSibling);
}

function applyPatch(session: Session, patch: RedlinePatch): RedlineFailure | null {
  const located = locate(session, patch);
  if (typeof located === "string") return { patch, reason: located };
  const span = replaceMatch(session, located, patch.replace);
  if (patch.comment !== undefined) attachComment(session, span, patch.comment);
  return null;
}

/** Cloned paragraph properties with the paragraph mark flagged as inserted. */
function insertedParagraphProperties(session: Session, source: Element): Element {
  const existing = childW(source, "pPr");
  const pPr = existing ? (existing.cloneNode(true) as Element) : createW(session.doc, "pPr");
  removeChildrenW(pPr, PPR_STRIP);
  const existingRPr = childW(pPr, "rPr");
  const rPr = existingRPr ?? createW(session.doc, "rPr");
  if (!existingRPr) pPr.appendChild(rPr);
  removeChildrenW(rPr, RPR_STRIP);
  rPr.insertBefore(createRevision(session, "ins"), rPr.firstChild);
  return pPr;
}

function buildInsertedParagraph(session: Session, source: Element, text: string): { p: Element; span: Span } {
  const p = createW(session.doc, "p");
  p.appendChild(insertedParagraphProperties(session, source));
  const ins = createRevision(session, "ins");
  const firstRun = descendantsW(source, "r").find((run) => runText(run) !== "") ?? descendantsW(source, "r")[0];
  ins.appendChild(createRun(session, cloneRunProperties(firstRun ?? null), text));
  p.appendChild(ins);
  return { p, span: { first: ins, last: ins } };
}

type InsertResult = { readonly failure: RedlineFailure | null; readonly tail: Element | null };

function applyInsert(session: Session, insert: RedlineInsertParagraph, previousTail: Element | null): InsertResult {
  const after = paragraphAt(session, insert.after);
  const source = insert.styleFrom === undefined ? after : paragraphAt(session, insert.styleFrom);
  if (!after || !source) return { failure: { patch: insert, reason: "anchor-not-found" }, tail: previousTail };
  const built = buildInsertedParagraph(session, source, insert.text);
  const anchorNode = previousTail ?? after;
  parentOf(after).insertBefore(built.p, anchorNode.nextSibling);
  if (insert.comment !== undefined) attachComment(session, built.span, insert.comment);
  return { failure: null, tail: built.p };
}

/** Inserts run in descending anchor order; equal anchors keep their given order by chaining after the previous tail. */
function applyInserts(session: Session, inserts: readonly RedlineInsertParagraph[]): readonly RedlineFailure[] {
  const ordered = inserts
    .map((insert, order) => ({ insert, order, index: anchorIndex(insert.after) ?? -1 }))
    .sort((a, b) => b.index - a.index || a.order - b.order);
  const tails = new Map<string, Element>();
  const failures: RedlineFailure[] = [];
  for (const { insert } of ordered) {
    const result = applyInsert(session, insert, tails.get(insert.after) ?? null);
    if (result.failure) failures.push(result.failure);
    if (result.tail) tails.set(insert.after, result.tail);
  }
  return failures;
}

function newRevisionIds(session: Session): readonly string[] {
  const ids: string[] = [];
  walkElements(session.doc, (el) => {
    if ((isW(el, "ins") || isW(el, "del")) && Number(wAttr(el, "id")) >= session.firstRevisionId)
      ids.push(wAttr(el, "id"));
  });
  return ids;
}

/** Returns the [Content_Types].xml text with the comments Override added, or null when it is already registered. */
async function registerCommentsContentType(zip: JSZip): Promise<string | null> {
  const doc = parseXml(await requirePart(zip, PART.contentTypes), PART.contentTypes);
  const overrides = Array.from(doc.getElementsByTagNameNS(CONTENT_TYPES_NS, "Override"));
  if (overrides.some((el) => el.getAttribute("PartName") === COMMENTS_PART_NAME)) return null;
  const override = doc.createElementNS(CONTENT_TYPES_NS, "Override");
  override.setAttribute("PartName", COMMENTS_PART_NAME);
  override.setAttribute("ContentType", COMMENTS_CONTENT_TYPE);
  doc.documentElement?.appendChild(override);
  return serializeXml(doc);
}

/** Returns the document rels text with a comments relationship added, or null when one already exists. */
async function registerCommentsRelationship(zip: JSZip): Promise<string | null> {
  const doc = parseXml((await readPart(zip, PART.documentRels)) ?? EMPTY_RELS, PART.documentRels);
  const relationships = Array.from(doc.getElementsByTagNameNS(PACKAGE_RELS_NS, "Relationship"));
  if (relationships.some((el) => el.getAttribute("Type") === COMMENTS_REL_TYPE)) return null;
  const nextId =
    maxNumericAttribute(relationships, (el) => (el.getAttribute("Id") ?? "").replace(REL_ID_PREFIX, "")) + 1;
  const relationship = doc.createElementNS(PACKAGE_RELS_NS, "Relationship");
  relationship.setAttribute("Id", `${REL_ID_PREFIX}${nextId}`);
  relationship.setAttribute("Type", COMMENTS_REL_TYPE);
  relationship.setAttribute("Target", COMMENTS_TARGET);
  doc.documentElement?.appendChild(relationship);
  return serializeXml(doc);
}

async function commentParts(session: Session, before: number): Promise<ReadonlyMap<string, string>> {
  if (descendantsW(session.comments, "comment").length === before) return new Map();
  const entries: [string, string][] = [[PART.comments, serializeXml(session.comments)]];
  const contentTypes = await registerCommentsContentType(session.zip);
  const rels = await registerCommentsRelationship(session.zip);
  if (contentTypes !== null) entries.push([PART.contentTypes, contentTypes]);
  if (rels !== null) entries.push([PART.documentRels, rels]);
  return new Map(entries);
}

function compressionOf(entry: JSZip.JSZipObject): "STORE" | "DEFLATE" {
  const internal = entry as unknown as { _data?: { compression?: { magic?: string } } };
  return internal._data?.compression?.magic === STORE_MAGIC ? "STORE" : "DEFLATE";
}

/** Builds a new package: untouched entries are copied byte for byte with their compression, replaced parts are re-encoded. */
async function repack(zip: JSZip, parts: ReadonlyMap<string, string>): Promise<Uint8Array> {
  const out = new JSZip();
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    seen.add(name);
    const replaced = parts.get(name);
    const content = replaced === undefined ? await entry.async("uint8array") : encoder.encode(replaced);
    out.file(name, content, { compression: compressionOf(entry), date: entry.date, createFolders: false });
  }
  for (const [name, content] of parts) {
    if (!seen.has(name)) out.file(name, encoder.encode(content), { compression: "DEFLATE", createFolders: false });
  }
  return out.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/**
 * Applies patches then inserts as tracked changes by `options.author`. Anchors refer to the input document's body
 * paragraphs. Failures are reported, never thrown; the remaining instructions are still applied.
 */
export async function applyRedline(
  bytes: Uint8Array,
  patches: readonly RedlinePatch[],
  inserts: readonly RedlineInsertParagraph[],
  options: RedlineOptions,
): Promise<RedlineResult> {
  const zip = await JSZip.loadAsync(bytes);
  const session = await openSession(zip, options);
  const commentsBefore = descendantsW(session.comments, "comment").length;
  const patchFailures = patches.flatMap((patch) => {
    const failure = applyPatch(session, patch);
    return failure ? [failure] : [];
  });
  const insertFailures = applyInserts(session, inserts);
  const failed = [...patchFailures, ...insertFailures];
  const parts = new Map([[PART.document, serializeXml(session.doc)], ...(await commentParts(session, commentsBefore))]);
  return {
    bytes: await repack(zip, parts),
    applied: patches.length + inserts.length - failed.length,
    failed,
    revisionIds: newRevisionIds(session),
  };
}
