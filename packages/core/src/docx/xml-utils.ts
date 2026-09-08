/**
 * Helpers over @xmldom/xmldom shared by the docx reader, redline writer, and validator: strict part parsing,
 * WordprocessingML lookups by namespace or local name, run text and splitting, and package constants.
 */
import { DOMParser, type Document, type Element, type Node, XMLSerializer } from "@xmldom/xmldom";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;
const XML_MIME_TYPE = "application/xml";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const PRESERVE_SPACE = "preserve";
const ANCHOR_RE = /^¶(\d+)$/;
const NO_ID = -1;

export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
/** Alias kept for readers that spell out the name. */
export const W_NAMESPACE = W_NS;
export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
export const PACKAGE_RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const COMMENTS_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
export const COMMENTS_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";

export const PART = {
  contentTypes: "[Content_Types].xml",
  rootRels: "_rels/.rels",
  document: "word/document.xml",
  documentRels: "word/_rels/document.xml.rels",
  comments: "word/comments.xml",
  styles: "word/styles.xml",
  numbering: "word/numbering.xml",
  core: "docProps/core.xml",
} as const;

/** Block-level wrappers whose children count as body children (content controls, custom XML). */
export const BLOCK_WRAPPERS: ReadonlySet<string> = new Set(["sdt", "sdtContent", "customXml"]);
/** Inline wrappers whose children count as paragraph children. */
export const INLINE_WRAPPERS: ReadonlySet<string> = new Set([
  "hyperlink",
  "smartTag",
  "sdt",
  "sdtContent",
  "fldSimple",
  "customXml",
  "dir",
  "bdo",
]);
export const TAB = "\t";
export const LINE_BREAK = "\n";

/** Raised for a part that is missing or not well-formed. Message starts with "docx:" and names the part. */
export class XmlPartError extends Error {
  readonly part: string;
  constructor(part: string, detail: string) {
    super(`docx: ${part} ${detail}`);
    this.name = "XmlPartError";
    this.part = part;
  }
}

/** Builds the reader's error: a plain Error whose message starts with "docx:". */
export function docxError(message: string): Error {
  return new Error(`docx: ${message}`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parses one XML part strictly: any parser error (not just fatal ones) rejects the part. */
export function parseXml(xml: string, partName: string): Document {
  const problems: string[] = [];
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") {
        problems.push(message);
      }
    },
  });
  let parsed: Document;
  try {
    parsed = parser.parseFromString(xml, XML_MIME_TYPE);
  } catch (error) {
    throw new XmlPartError(partName, `is not well-formed XML: ${describeError(error)}`);
  }
  if (problems.length > 0) {
    throw new XmlPartError(partName, `is not well-formed XML: ${problems[0]}`);
  }
  if (!parsed.documentElement) {
    throw new XmlPartError(partName, "has no root element");
  }
  return parsed;
}

/** Serialises a document with the standard XML declaration in front. */
export function serializeXml(doc: Document): string {
  const body = new XMLSerializer().serializeToString(doc);
  return body.startsWith("<?xml") ? body : `${XML_DECLARATION}${body}`;
}

export function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

export function localName(element: Element): string {
  return element.localName ?? element.nodeName.split(":").pop() ?? "";
}

export function isW(element: Element, local: string): boolean {
  return element.namespaceURI === W_NS && localName(element) === local;
}

export function childElements(node: Node): readonly Element[] {
  const children: Element[] = [];
  const list = node.childNodes;
  for (let index = 0; index < list.length; index += 1) {
    const child = list.item(index);
    if (child !== null && isElement(child)) {
      children.push(child);
    }
  }
  return children;
}

/** Alias of childElements for the writer. */
export const elementChildren = childElements;

export function firstChild(element: Element, name: string): Element | null {
  return childElements(element).find((child) => localName(child) === name) ?? null;
}

/** First w:<local> child. */
export function childW(element: Element, local: string): Element | null {
  return childElements(element).find((child) => isW(child, local)) ?? null;
}

/** All descendant elements with the given local name (any namespace), in document order. */
export function descendants(node: Node, name: string): readonly Element[] {
  return childElements(node).flatMap((child) =>
    localName(child) === name ? [child, ...descendants(child, name)] : descendants(child, name),
  );
}

/** All descendant w:<local> elements, in document order. */
export function descendantsW(root: Document | Element, local: string): readonly Element[] {
  return Array.from(root.getElementsByTagNameNS(W_NS, local));
}

/** Depth-first visit of every element beneath the node. */
export function walkElements(root: Node, visit: (element: Element) => void): void {
  for (const child of childElements(root)) {
    visit(child);
    walkElements(child, visit);
  }
}

/** Reads a WordprocessingML attribute ("w:id") by qualified name, namespace, or bare name. "" when absent. */
export function attr(element: Element, name: string): string {
  return element.getAttribute(`w:${name}`) ?? element.getAttributeNS(W_NS, name) ?? element.getAttribute(name) ?? "";
}

/** Namespace-resolved w: attribute, "" when absent. */
export function wAttr(element: Element, local: string): string {
  return element.getAttributeNS(W_NS, local) ?? "";
}

export function setWAttr(element: Element, local: string, value: string): void {
  element.setAttributeNS(W_NS, `w:${local}`, value);
}

export function createW(doc: Document, local: string): Element {
  return doc.createElementNS(W_NS, `w:${local}`);
}

/** Creates w:t or w:delText with xml:space="preserve" so edge whitespace survives. */
export function createTextElement(doc: Document, local: "t" | "delText", text: string): Element {
  const element = createW(doc, local);
  element.setAttributeNS(XML_NS, "xml:space", PRESERVE_SPACE);
  element.appendChild(doc.createTextNode(text));
  return element;
}

/** Concatenated text of all text and CDATA nodes beneath the node. */
export function textOf(node: Node): string {
  const list = node.childNodes;
  let text = "";
  for (let index = 0; index < list.length; index += 1) {
    const child = list.item(index);
    if (child === null) {
      continue;
    }
    if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_SECTION_NODE) {
      text += child.nodeValue ?? "";
    } else if (isElement(child)) {
      text += textOf(child);
    }
  }
  return text;
}

/** Largest finite numeric value read from the elements, or -1 when there is none. */
export function maxNumericAttribute(elements: readonly Element[], read: (element: Element) => string): number {
  return elements.reduce((max, element) => {
    const value = Number(read(element));
    return Number.isFinite(value) && value > max ? value : max;
  }, NO_ID);
}

/** "¶12" -> 12; null for anything else. */
export function anchorIndex(anchor: string): number | null {
  const match = ANCHOR_RE.exec(anchor);
  return match ? Number.parseInt(match[1] as string, 10) : null;
}

/** Body-level paragraphs in document order, descending through content controls; table paragraphs excluded. */
export function bodyParagraphs(doc: Document): readonly Element[] {
  const body = descendantsW(doc, "body")[0];
  const collect = (container: Element): readonly Element[] =>
    childElements(container).flatMap((child) => {
      if (localName(child) === "p") {
        return [child];
      }
      return BLOCK_WRAPPERS.has(localName(child)) ? collect(child) : [];
    });
  return body ? collect(body) : [];
}

/** Text a run contributes: w:t / w:delText verbatim, w:tab as "\t", w:br and w:cr as "\n". */
export function runText(run: Element): string {
  return childElements(run)
    .map((child) => {
      const name = localName(child);
      if (name === "t" || name === "delText") {
        return textOf(child);
      }
      if (name === "tab") {
        return TAB;
      }
      return name === "br" || name === "cr" ? LINE_BREAK : "";
    })
    .join("");
}

function childWidth(child: Element): number {
  const name = localName(child);
  if (name === "t" || name === "delText") {
    return textOf(child).length;
  }
  return name === "tab" || name === "br" || name === "cr" ? 1 : 0;
}

/**
 * Splits a run at a text offset into two runs that share its properties. Text nodes are divided, one-character
 * elements (tab, br) and zero-width children go to the side their position falls on.
 */
export function splitRun(run: Element, at: number): [Element, Element] {
  const doc = run.ownerDocument as Document;
  const left = run.cloneNode(false) as Element;
  const right = run.cloneNode(false) as Element;
  let position = 0;
  for (const child of childElements(run)) {
    const name = localName(child);
    if (name === "rPr") {
      left.appendChild(child.cloneNode(true));
      right.appendChild(child.cloneNode(true));
      continue;
    }
    const width = childWidth(child);
    const isText = name === "t" || name === "delText";
    if (isText && position < at && position + width > at) {
      const text = textOf(child);
      left.appendChild(createTextElement(doc, name, text.slice(0, at - position)));
      right.appendChild(createTextElement(doc, name, text.slice(at - position)));
    } else {
      (position < at ? left : right).appendChild(child.cloneNode(true));
    }
    position += width;
  }
  return [left, right];
}

export type RunSegment = {
  run: Element;
  /** Offsets into ParagraphText.text; a deleted run is a point (start === end) at its position. */
  start: number;
  end: number;
  revision: "ins" | "del" | null;
};

export type ParagraphText = {
  /** Accepted-changes text, identical to DocxParagraph.text from the reader. */
  text: string;
  segments: readonly RunSegment[];
};

type TextState = { text: string; segments: RunSegment[]; dropped: boolean };

const REVISION_TAGS: Readonly<Record<string, "ins" | "del">> = { ins: "ins", del: "del", moveTo: "ins", moveFrom: "del" };

function appendRun(state: TextState, run: Element, revision: "ins" | "del" | null): void {
  const raw = runText(run);
  if (raw === "") {
    return;
  }
  if (revision === "del") {
    state.segments.push({ run, start: state.text.length, end: state.text.length, revision });
    state.dropped = true;
    return;
  }
  const collapse = state.dropped && state.text.endsWith(" ") && raw.startsWith(" ");
  const start = collapse ? state.text.length - 1 : state.text.length;
  state.text += collapse ? raw.slice(1) : raw;
  state.segments.push({ run, start, end: start + raw.length, revision });
  state.dropped = false;
}

function collectText(container: Element, revision: "ins" | "del" | null, state: TextState): void {
  for (const child of childElements(container)) {
    const name = localName(child);
    if (name === "r") {
      appendRun(state, child, revision);
    } else if (REVISION_TAGS[name] !== undefined) {
      collectText(child, REVISION_TAGS[name] as "ins" | "del", state);
    } else if (INLINE_WRAPPERS.has(name)) {
      collectText(child, revision, state);
    }
  }
}

/**
 * Accepted text of a paragraph with run offsets, using the same rules as the reader (deletions dropped, a
 * space doubled by a dropped run collapsed). A collapsed run's segment starts one character early so that
 * `offset - segment.start` still indexes into the run's own text.
 */
export function paragraphText(paragraph: Element): ParagraphText {
  const state: TextState = { text: "", segments: [], dropped: false };
  collectText(paragraph, null, state);
  return { text: state.text, segments: state.segments };
}
