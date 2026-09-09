import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DOMParser, type Document, type Element, type Node } from "@xmldom/xmldom";
import fc from "fast-check";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { RedlineInsertParagraph, RedlinePatch } from "./types";
import { validateDocx } from "./validate";
import { applyRedline } from "./write";

const FIXTURES = path.join(__dirname, "fixtures");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const COMMENTS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const COMMENTS_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const OPTIONS = { author: "Reviewer One", date: "2026-09-08T10:00:00Z", initials: "RO" } as const;

// --- independent helpers (deliberately not imported from xml-utils so the writer is checked from the outside) ---

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES, name)));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function part(bytes: Uint8Array, name: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file(name);
  return entry ? entry.async("string") : null;
}

async function partBytes(bytes: Uint8Array, name: string): Promise<Uint8Array | null> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file(name);
  return entry ? entry.async("uint8array") : null;
}

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function isW(el: Element, local: string): boolean {
  return el.namespaceURI === W && el.localName === local;
}

function children(node: Node): Element[] {
  return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}

/** Body-level paragraphs in document order: direct w:p children of w:body plus sdt-wrapped ones; tables skipped. */
function bodyParagraphs(doc: Document): Element[] {
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  const collect = (node: Element): Element[] =>
    children(node).flatMap((child) => {
      if (isW(child, "p")) return [child];
      if (isW(child, "sdt") || isW(child, "sdtContent")) return collect(child);
      return [];
    });
  return body ? collect(body) : [];
}

/** Accepted-changes text: w:t outside w:del, tabs and breaks as control characters. */
function acceptedText(node: Node): string {
  return children(node)
    .map((child) => {
      if (isW(child, "pPr") || isW(child, "del") || isW(child, "moveFrom")) return "";
      if (isW(child, "t")) return child.textContent ?? "";
      if (isW(child, "tab")) return "\t";
      if (isW(child, "br")) return "\n";
      return acceptedText(child);
    })
    .join("");
}

/** Original text: w:t outside w:ins plus w:delText inside w:del. */
function originalText(node: Node): string {
  return children(node)
    .map((child) => {
      if (isW(child, "pPr") || isW(child, "ins") || isW(child, "moveTo")) return "";
      if (isW(child, "t") || isW(child, "delText")) return child.textContent ?? "";
      if (isW(child, "tab")) return "\t";
      if (isW(child, "br")) return "\n";
      return originalText(child);
    })
    .join("");
}

function textOf(elements: Iterable<Element>): string {
  return Array.from(elements)
    .map((el) => el.textContent ?? "")
    .join("");
}

function all(node: Node, local: string): Element[] {
  return Array.from((node as Element).getElementsByTagNameNS(W, local));
}

/** Ids of every w:ins / w:del as a depth-first walk meets them. */
function revisionIdsInDocumentOrder(node: Node): string[] {
  return children(node).flatMap((child) => {
    const own = isW(child, "ins") || isW(child, "del") ? [child.getAttributeNS(W, "id") ?? ""] : [];
    return [...own, ...revisionIdsInDocumentOrder(child)];
  });
}

function maxId(doc: Document): number {
  return [...all(doc, "ins"), ...all(doc, "del")].reduce(
    (max, el) => Math.max(max, Number(el.getAttributeNS(W, "id"))),
    -1,
  );
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const DOC_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function run(text: string, rPr = ""): string {
  const props = rPr ? `<w:rPr>${rPr}</w:rPr>` : "";
  return `<w:r>${props}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

async function buildDocx(bodyXml: string): Promise<Uint8Array> {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${bodyXml}<w:sectPr/></w:body></w:document>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", document);
  zip.file("word/_rels/document.xml.rels", DOC_RELS);
  return zip.generateAsync({ type: "uint8array" });
}

// --- tests ---

describe("applyRedline on the clean lender draft", () => {
  const REPLACE: RedlinePatch = {
    anchor: "¶2",
    find: "a Delaware corporation",
    replace: "a Nevada corporation",
    comment: "Confirm jurisdiction of incorporation.",
  };
  const DELETE: RedlinePatch = { anchor: "¶5", find: "national banking association", replace: "" };
  const INSERT: RedlineInsertParagraph = { after: "¶6", text: "DRAFT FOR DISCUSSION PURPOSES ONLY" };

  async function redline() {
    const input = await fixture("lender-initial-aca-draft.docx");
    const before = sha256(input);
    const result = await applyRedline(input, [REPLACE, DELETE], [INSERT], OPTIONS);
    return { input, before, result };
  }

  it("targets paragraphs the same way the reader does", async () => {
    const input = await fixture("lender-initial-aca-draft.docx");
    const paragraphs = bodyParagraphs(parse((await part(input, "word/document.xml")) as string));
    expect(acceptedText(paragraphs[2] as Element)).toContain(REPLACE.find);
    expect(acceptedText(paragraphs[5] as Element)).toContain(DELETE.find);
  });

  it("applies every instruction without failures and leaves the input untouched", async () => {
    const { input, before, result } = await redline();
    expect(result.failed).toEqual([]);
    expect(result.applied).toBe(3);
    expect(sha256(input)).toBe(before);
    expect(new Set(result.revisionIds).size).toBe(result.revisionIds.length);
    expect(result.revisionIds).toHaveLength(5);
    expect(await validateDocx(result.bytes)).toEqual({ ok: true, issues: [] });
  });

  it("writes tracked changes into document.xml", async () => {
    const { result } = await redline();
    const doc = parse((await part(result.bytes, "word/document.xml")) as string);
    expect(all(doc, "ins")).toHaveLength(3);
    expect(all(doc, "del")).toHaveLength(2);
    const paragraphs = bodyParagraphs(doc);
    const replaced = paragraphs[2] as Element;
    expect(textOf(replaced.getElementsByTagNameNS(W, "t"))).not.toContain(REPLACE.find);
    expect(textOf(replaced.getElementsByTagNameNS(W, "delText"))).toBe(REPLACE.find);
    expect(acceptedText(replaced)).toBe("GREYSTONE ADVANCED MATERIALS, INC., a Nevada corporation, as Depositor,");
    const insRun = all(replaced, "ins")[0] as Element;
    expect(textOf(insRun.getElementsByTagNameNS(W, "t"))).toBe(REPLACE.replace);
    const deleted = paragraphs[5] as Element;
    expect(textOf(deleted.getElementsByTagNameNS(W, "delText"))).toBe(DELETE.find);
    expect(acceptedText(deleted)).toBe("ATLANTIC FIDELITY BANK, N.A., a , as Depositary Bank");
    const inserted = paragraphs[7] as Element;
    expect(acceptedText(inserted)).toBe(INSERT.text);
    expect(all(inserted, "pPr")[0]?.getElementsByTagNameNS(W, "ins")).toHaveLength(1);
    expect(all(inserted, "jc")[0]?.getAttributeNS(W, "val")).toBe("center");
    for (const el of [...all(doc, "ins"), ...all(doc, "del")]) {
      expect(el.getAttributeNS(W, "author")).toBe(OPTIONS.author);
      expect(el.getAttributeNS(W, "date")).toBe(OPTIONS.date);
    }
  });

  it("creates and registers the comments part", async () => {
    const { result } = await redline();
    const comments = parse((await part(result.bytes, "word/comments.xml")) as string);
    const list = all(comments, "comment");
    expect(list).toHaveLength(1);
    expect(list[0]?.getAttributeNS(W, "author")).toBe(OPTIONS.author);
    expect(list[0]?.getAttributeNS(W, "initials")).toBe(OPTIONS.initials);
    expect(list[0]?.getAttributeNS(W, "date")).toBe(OPTIONS.date);
    expect(acceptedText(list[0] as Element)).toBe(REPLACE.comment);
    const doc = parse((await part(result.bytes, "word/document.xml")) as string);
    const id = list[0]?.getAttributeNS(W, "id");
    expect(all(doc, "commentRangeStart")[0]?.getAttributeNS(W, "id")).toBe(id);
    expect(all(doc, "commentRangeEnd")[0]?.getAttributeNS(W, "id")).toBe(id);
    expect(all(doc, "commentReference")[0]?.getAttributeNS(W, "id")).toBe(id);
    expect(await part(result.bytes, "[Content_Types].xml")).toContain(
      `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CT}"/>`,
    );
    const rels = (await part(result.bytes, "word/_rels/document.xml.rels")) as string;
    expect(rels).toContain(`Type="${COMMENTS_REL}"`);
    expect(rels).toContain('Target="comments.xml"');
  });

  it("copies every other part byte for byte", async () => {
    const { input, result } = await redline();
    const inZip = await JSZip.loadAsync(input);
    const outZip = await JSZip.loadAsync(result.bytes);
    const changed = new Set(["word/document.xml", "[Content_Types].xml", "word/_rels/document.xml.rels"]);
    const inNames = Object.keys(inZip.files);
    expect(Object.keys(outZip.files)).toEqual([...inNames, "word/comments.xml"]);
    for (const name of inNames.filter((entry) => !changed.has(entry))) {
      expect(sha256((await partBytes(result.bytes, name)) as Uint8Array), name).toBe(
        sha256((await partBytes(input, name)) as Uint8Array),
      );
    }
    for (const name of ["word/styles.xml", "docProps/core.xml", "docProps/thumbnail.jpeg"]) {
      expect(inZip.file(name), name).not.toBeNull();
    }
  });
});

describe("applyRedline on a document that already carries revisions", () => {
  async function load() {
    const input = await fixture("depositary-bank-round-1-redline.docx");
    const doc = parse((await part(input, "word/document.xml")) as string);
    return { input, doc, paragraphs: bodyParagraphs(doc) };
  }

  it("numbers new revisions above the existing maximum", async () => {
    const { input, doc, paragraphs } = await load();
    const existingMax = maxId(doc);
    expect(existingMax).toBeGreaterThan(0);
    const index = paragraphs.findIndex(
      (p) => all(p, "ins").length === 0 && all(p, "del").length === 0 && acceptedText(p).includes("Depositor"),
    );
    const text = acceptedText(paragraphs[index] as Element);
    const result = await applyRedline(
      input,
      [{ anchor: `¶${index}`, find: "Depositor", replace: "Grantor" }],
      [],
      OPTIONS,
    );
    expect(text.indexOf("Depositor")).toBe(text.lastIndexOf("Depositor"));
    expect(result.failed).toEqual([]);
    expect(result.revisionIds.map(Number).every((id) => id > existingMax)).toBe(true);
    const out = parse((await part(result.bytes, "word/document.xml")) as string);
    expect(all(out, "ins")).toHaveLength(all(doc, "ins").length + 1);
    expect(all(out, "del")).toHaveLength(all(doc, "del").length + 1);
    expect(await validateDocx(result.bytes)).toEqual({ ok: true, issues: [] });
  });

  it("refuses a find that overlaps an existing insertion", async () => {
    const { input, paragraphs } = await load();
    const index = paragraphs.findIndex((p) => all(p, "ins").length > 0);
    const insertedText = acceptedText(all(paragraphs[index] as Element, "ins")[0] as Element);
    const find = insertedText.slice(0, 12);
    expect(acceptedText(paragraphs[index] as Element).split(find)).toHaveLength(2);
    const patch: RedlinePatch = { anchor: `¶${index}`, find, replace: "x" };
    const result = await applyRedline(input, [patch], [], OPTIONS);
    expect(result.applied).toBe(0);
    expect(result.failed).toEqual([{ patch, reason: "inside-revision" }]);
  });

  it("refuses an ambiguous find and reports a missing one", async () => {
    const { input, paragraphs } = await load();
    const index = paragraphs.findIndex((p) => acceptedText(p).split(" the ").length > 2);
    const ambiguous: RedlinePatch = { anchor: `¶${index}`, find: " the ", replace: " a " };
    const missing: RedlinePatch = { anchor: "¶0", find: "no such text anywhere", replace: "" };
    const outOfRange: RedlinePatch = { anchor: `¶${paragraphs.length}`, find: "x", replace: "" };
    const result = await applyRedline(input, [ambiguous, missing, outOfRange], [], OPTIONS);
    expect(result.applied).toBe(0);
    expect(result.failed).toEqual([
      { patch: ambiguous, reason: "find-ambiguous" },
      { patch: missing, reason: "find-not-found" },
      { patch: outOfRange, reason: "anchor-not-found" },
    ]);
  });
});

describe("applyRedline on a synthetic document", () => {
  const BOLD = "<w:b/>";
  const ITALIC = "<w:i/>";
  const PLAIN = '<w:color w:val="FF0000"/>';
  const FIRST = `<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr>${run("Hello ", BOLD)}${run("brave ", ITALIC)}<w:r><w:rPr>${PLAIN}</w:rPr><w:t>new</w:t><w:tab/><w:t xml:space="preserve"> world</w:t></w:r></w:p>`;
  const TABLE = `<w:tbl><w:tr><w:tc><w:p>${run("Cell text")}</w:p></w:tc></w:tr></w:tbl>`;
  const SECOND = `<w:p>${run("Second paragraph")}</w:p>`;

  it("skips tables when counting anchors and keeps run formatting across a split", async () => {
    const input = await buildDocx(FIRST + TABLE + SECOND);
    const result = await applyRedline(
      input,
      [
        { anchor: "¶0", find: "brave new\t w", replace: "cruel w" },
        { anchor: "¶1", find: "Second", replace: "2nd" },
        { anchor: "¶2", find: "Cell", replace: "x" },
      ],
      [],
      OPTIONS,
    );
    expect(result.failed).toEqual([
      { patch: { anchor: "¶2", find: "Cell", replace: "x" }, reason: "anchor-not-found" },
    ]);
    expect(result.applied).toBe(2);
    const doc = parse((await part(result.bytes, "word/document.xml")) as string);
    const [first, second] = bodyParagraphs(doc);
    expect(acceptedText(first as Element)).toBe("Hello cruel world");
    expect(originalText(first as Element)).toBe("Hello brave new\t world");
    expect(acceptedText(second as Element)).toBe("2nd paragraph");
    expect(acceptedText(all(doc, "tbl")[0] as Element)).toBe("Cell text");
    const runs = children(first as Element).filter((el) => isW(el, "r"));
    expect(runs.map((r) => acceptedText(r))).toEqual(["Hello ", "orld"]);
    expect(all(runs[1] as Element, "color")[0]?.getAttributeNS(W, "val")).toBe("FF0000");
    const deletedRuns = all(all(first as Element, "del")[0] as Element, "r");
    expect(deletedRuns.map((r) => textOf(r.getElementsByTagNameNS(W, "delText")))).toEqual(["brave ", "new w"]);
    expect(all(deletedRuns[0] as Element, "i")).toHaveLength(1);
    expect(all(deletedRuns[1] as Element, "color")).toHaveLength(1);
    expect(all(deletedRuns[1] as Element, "tab")).toHaveLength(1);
    expect(all(deletedRuns[1] as Element, "t")).toHaveLength(0);
    const insRun = all(all(first as Element, "ins")[0] as Element, "r")[0] as Element;
    expect(all(insRun, "i")).toHaveLength(1);
    expect(all(insRun, "t")[0]?.getAttribute("xml:space")).toBe("preserve");
    expect(await validateDocx(result.bytes)).toEqual({ ok: true, issues: [] });
  });

  it("counts sdt-wrapped body paragraphs and replaces a whole paragraph without dropping its mark", async () => {
    const input = await buildDocx(
      `<w:p>${run("Alpha")}</w:p><w:sdt><w:sdtContent><w:p>${run("Beta")}</w:p></w:sdtContent></w:sdt><w:p>${run("Gamma")}</w:p>`,
    );
    const result = await applyRedline(
      input,
      [
        { anchor: "¶1", find: "Beta", replace: "Delta" },
        { anchor: "¶2", find: "Gamma", replace: "" },
      ],
      [],
      OPTIONS,
    );
    expect(result.failed).toEqual([]);
    const doc = parse((await part(result.bytes, "word/document.xml")) as string);
    const paragraphs = bodyParagraphs(doc);
    expect(paragraphs.map((p) => acceptedText(p))).toEqual(["Alpha", "Delta", ""]);
    expect(paragraphs.map((p) => originalText(p))).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(all(paragraphs[2] as Element, "ins")).toHaveLength(0);
  });

  it("inserts paragraphs after original anchors, in order, with cloned properties and comments", async () => {
    const input = await buildDocx(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:sectPr/></w:pPr>${run("One", BOLD)}</w:p><w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr>${run("Two")}</w:p>`,
    );
    const inserts: RedlineInsertParagraph[] = [
      { after: "¶0", text: "One-a", comment: "New clause" },
      { after: "¶0", text: "One-b", styleFrom: "¶1" },
      { after: "¶1", text: "Two-a" },
      { after: "¶9", text: "nowhere" },
      { after: "¶0", text: "bad style", styleFrom: "¶9" },
    ];
    const result = await applyRedline(input, [{ anchor: "¶1", find: "Two", replace: "2" }], inserts, OPTIONS);
    expect(result.failed).toEqual([
      { patch: inserts[3], reason: "anchor-not-found" },
      { patch: inserts[4], reason: "anchor-not-found" },
    ]);
    expect(result.applied).toBe(4);
    const doc = parse((await part(result.bytes, "word/document.xml")) as string);
    const paragraphs = bodyParagraphs(doc);
    expect(paragraphs.map((p) => acceptedText(p))).toEqual(["One", "One-a", "One-b", "2", "Two-a"]);
    expect(paragraphs.map((p) => originalText(p))).toEqual(["One", "", "", "Two", ""]);
    const styles = paragraphs.map((p) => all(p, "pStyle")[0]?.getAttributeNS(W, "val"));
    expect(styles).toEqual(["Heading1", "Heading1", "Body", "Body", "Body"]);
    expect(all(paragraphs[1] as Element, "sectPr")).toHaveLength(0);
    expect(all(all(paragraphs[1] as Element, "pPr")[0] as Element, "ins")).toHaveLength(1);
    expect(all(all(paragraphs[1] as Element, "ins")[1] as Element, "b")).toHaveLength(1);
    expect(all(paragraphs[1] as Element, "commentRangeStart")).toHaveLength(1);
    expect(all(paragraphs[1] as Element, "commentReference")).toHaveLength(1);
    const comments = parse((await part(result.bytes, "word/comments.xml")) as string);
    expect(all(comments, "comment").map((c) => acceptedText(c))).toEqual(["New clause"]);
    expect(result.revisionIds).toHaveLength(8);
    expect(result.revisionIds).toEqual(revisionIdsInDocumentOrder(doc));
    expect(await validateDocx(result.bytes)).toEqual({ ok: true, issues: [] });
  });

  it("continues comment and relationship ids from the existing parts", async () => {
    const seed = await buildDocx(`<w:p>${run("Alpha")}</w:p>`);
    const first = await applyRedline(
      seed,
      [{ anchor: "¶0", find: "Alpha", replace: "Beta", comment: "one" }],
      [],
      OPTIONS,
    );
    const second = await applyRedline(first.bytes, [], [{ after: "¶0", text: "Gamma", comment: "two" }], OPTIONS);
    const comments = parse((await part(second.bytes, "word/comments.xml")) as string);
    expect(all(comments, "comment").map((c) => c.getAttributeNS(W, "id"))).toEqual(["0", "1"]);
    const rels = (await part(second.bytes, "word/_rels/document.xml.rels")) as string;
    expect(rels.match(/relationships\/comments"/g)).toHaveLength(1);
    const contentTypes = (await part(second.bytes, "[Content_Types].xml")) as string;
    expect(contentTypes.match(/comments\.xml/g)).toHaveLength(1);
    expect(second.revisionIds.map(Number).every((id) => id > Math.max(...first.revisionIds.map(Number)))).toBe(true);
    expect(await validateDocx(second.bytes)).toEqual({ ok: true, issues: [] });
  });

  it("defaults the date to a second-precision ISO timestamp and the initials to the author's", async () => {
    const input = await buildDocx(`<w:p>${run("Alpha beta")}</w:p>`);
    const result = await applyRedline(input, [{ anchor: "¶0", find: "beta", replace: "gamma", comment: "c" }], [], {
      author: "Ada Lovelace",
    });
    const doc = parse((await part(result.bytes, "word/document.xml")) as string);
    expect(all(doc, "ins")[0]?.getAttributeNS(W, "date")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const comments = parse((await part(result.bytes, "word/comments.xml")) as string);
    expect(all(comments, "comment")[0]?.getAttributeNS(W, "initials")).toBe("AL");
  });

  it("rejects an empty find and inputs that are not a docx", async () => {
    const input = await buildDocx(`<w:p>${run("Alpha")}</w:p>`);
    const empty: RedlinePatch = { anchor: "¶0", find: "", replace: "x" };
    const result = await applyRedline(input, [empty], [], OPTIONS);
    expect(result.failed).toEqual([{ patch: empty, reason: "find-not-found" }]);
    await expect(applyRedline(new Uint8Array([1, 2, 3]), [], [], OPTIONS)).rejects.toThrow();
  });
});

describe("applyRedline property: replacing a unique substring", () => {
  const ascii = fc.string({
    unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz ABC&<>\"'."),
    minLength: 1,
    maxLength: 40,
  });

  it("yields accepted text equal to String.replace and original text equal to the source", async () => {
    await fc.assert(
      fc.asyncProperty(
        ascii,
        fc.nat(),
        fc.nat(),
        fc.string({ unit: fc.constantFrom(..."xyz-&<>' "), maxLength: 10 }),
        fc.array(fc.nat(), { maxLength: 3 }),
        async (text, a, b, replacement, cuts) => {
          const start = a % text.length;
          const end = start + 1 + (b % (text.length - start));
          const find = text.slice(start, end);
          fc.pre(text.indexOf(find) === text.lastIndexOf(find));
          const bounds = [...new Set([0, ...cuts.map((cut) => cut % text.length), text.length])].sort((x, y) => x - y);
          const runs = bounds.slice(1).map((stop, i) => run(text.slice(bounds[i], stop)));
          const input = await buildDocx(`<w:p>${runs.join("")}</w:p>`);
          const result = await applyRedline(input, [{ anchor: "¶0", find, replace: replacement }], [], OPTIONS);
          expect(result.failed).toEqual([]);
          const doc = parse((await part(result.bytes, "word/document.xml")) as string);
          const paragraph = bodyParagraphs(doc)[0] as Element;
          expect(acceptedText(paragraph)).toBe(text.slice(0, start) + replacement + text.slice(end));
          expect(originalText(paragraph)).toBe(text);
        },
      ),
      { numRuns: 60 },
    );
  });
});
