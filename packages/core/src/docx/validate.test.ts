import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { validateDocx } from "./validate";

const FIXTURES = path.join(__dirname, "fixtures");
const FIXTURE_NAMES = [
  "lender-initial-aca-draft.docx",
  "depositary-bank-round-1-redline.docx",
  "borrower-round-2-comments.docx",
  "lender-round-3-counter-redline.docx",
  "original-term-sheet.docx",
  "lender-markup-term-sheet.docx",
] as const;

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const CONTENT_TYPES = `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const ROOT_RELS = `${DECL}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

type Parts = Readonly<Record<string, string | null>>;

function relationship(id: string, type: string, target: string, external = false): string {
  const mode = external ? ' TargetMode="External"' : "";
  return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${mode}/>`;
}

function documentXml(body: string): string {
  return `${DECL}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

function docRels(inner: string): string {
  return `${DECL}<Relationships xmlns="${REL_NS}">${inner}</Relationships>`;
}

/** Builds a package from the defaults, overridden per part; a null value removes the part. */
async function buildDocx(overrides: Parts = {}): Promise<Uint8Array> {
  const parts: Parts = {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": documentXml("<w:p><w:r><w:t>Hello</w:t></w:r></w:p>"),
    "word/_rels/document.xml.rels": docRels(""),
    ...overrides,
  };
  const zip = new JSZip();
  for (const [name, content] of Object.entries(parts)) {
    if (content !== null) zip.file(name, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

describe("validateDocx on the fixtures", () => {
  for (const name of FIXTURE_NAMES) {
    it(`accepts ${name}`, async () => {
      const bytes = new Uint8Array(await readFile(path.join(FIXTURES, name)));
      expect(await validateDocx(bytes)).toEqual({ ok: true, issues: [] });
    });
  }
});

describe("validateDocx on broken packages", () => {
  it("reports bytes that are not a zip", async () => {
    const result = await validateDocx(new Uint8Array([0x50, 0x4b, 0x00, 0x01, 0x02]));
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(["not-a-zip"]);
  });

  it("reports a missing content types part", async () => {
    const result = await validateDocx(await buildDocx({ "[Content_Types].xml": null }));
    expect(result.issues.map((issue) => issue.code)).toContain("missing-content-types");
  });

  it("reports a missing main document", async () => {
    const result = await validateDocx(await buildDocx({ "word/document.xml": null }));
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("missing-document");
  });

  it("reports malformed xml with the part name", async () => {
    const result = await validateDocx(
      await buildDocx({
        "word/document.xml": `${DECL}<w:document xmlns:w="${W}"><w:body><w:p></w:body></w:document>`,
        "word/_rels/document.xml.rels": docRels("<Relationship"),
      }),
    );
    const malformed = result.issues.filter((issue) => issue.code === "xml-not-well-formed");
    expect(malformed).toHaveLength(2);
    expect(malformed.map((issue) => issue.detail).join("\n")).toContain("word/document.xml");
    expect(malformed.map((issue) => issue.detail).join("\n")).toContain("word/_rels/document.xml.rels");
  });

  it("reports r:id and r:embed values with no relationship", async () => {
    const body =
      '<w:p><w:hyperlink r:id="rId7"><w:r><w:t>link</w:t></w:r></w:hyperlink><w:r><w:drawing><a:blip xmlns:a="urn:a" r:embed="rId8"/></w:drawing></w:r></w:p>';
    const result = await validateDocx(
      await buildDocx({
        "word/document.xml": documentXml(body),
        "word/_rels/document.xml.rels": docRels(relationship("rId7", "hyperlink", "https://example.com", true)),
      }),
    );
    const dangling = result.issues.filter((issue) => issue.code === "dangling-relationship");
    expect(dangling).toHaveLength(1);
    expect(dangling[0]?.detail).toContain("rId8");
  });

  it("reports relationship targets that are missing or have no content type", async () => {
    const rels = docRels(
      relationship("rId1", "styles", "styles.xml") +
        relationship("rId2", "image", "media/image1.png") +
        relationship("rId3", "hyperlink", "https://example.com", true) +
        relationship("rId4", "customXml", "../customXml/item1.xml"),
    );
    const result = await validateDocx(
      await buildDocx({
        "word/_rels/document.xml.rels": rels,
        "word/media/image1.png": "not really a png",
        "customXml/item1.xml": "<x/>",
      }),
    );
    const unregistered = result.issues.filter((issue) => issue.code === "unregistered-part");
    expect(unregistered.map((issue) => issue.detail).join("\n")).toContain("word/styles.xml");
    expect(unregistered.map((issue) => issue.detail).join("\n")).toContain("word/media/image1.png");
    expect(unregistered.map((issue) => issue.detail).join("\n")).not.toContain("customXml/item1.xml");
    expect(unregistered).toHaveLength(2);
  });

  it("accepts parts registered through an Override and case-insensitive extension defaults", async () => {
    const contentTypes = CONTENT_TYPES.replace(
      "</Types>",
      '<Default Extension="PNG" ContentType="image/png"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    );
    const result = await validateDocx(
      await buildDocx({
        "[Content_Types].xml": contentTypes,
        "word/_rels/document.xml.rels": docRels(
          relationship("rId1", "styles", "styles.xml") + relationship("rId2", "image", "/word/media/image1.png"),
        ),
        "word/styles.xml": `<w:styles xmlns:w="${W}"/>`,
        "word/media/image1.png": "png bytes",
      }),
    );
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("reports duplicate revision ids across w:ins and w:del", async () => {
    const body =
      '<w:p><w:ins w:id="3" w:author="a" w:date="2026-01-01T00:00:00Z"><w:r><w:t>x</w:t></w:r></w:ins><w:del w:id="3" w:author="a" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>y</w:delText></w:r></w:del><w:ins w:id="4" w:author="a" w:date="2026-01-01T00:00:00Z"><w:r><w:t>z</w:t></w:r></w:ins></w:p>';
    const result = await validateDocx(await buildDocx({ "word/document.xml": documentXml(body) }));
    const duplicates = result.issues.filter((issue) => issue.code === "duplicate-revision-id");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.detail).toContain("3");
  });

  it("reports comment references without a range or a comment entry", async () => {
    const body =
      '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>x</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:commentRangeStart w:id="1"/><w:r><w:commentReference w:id="1"/></w:r><w:r><w:commentReference w:id="2"/></w:r></w:p>';
    const comments = `${DECL}<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="a" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:comment><w:comment w:id="1" w:author="a" w:date="2026-01-01T00:00:00Z"><w:p/></w:comment></w:comments>`;
    const contentTypes = CONTENT_TYPES.replace(
      "</Types>",
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>',
    );
    const result = await validateDocx(
      await buildDocx({
        "[Content_Types].xml": contentTypes,
        "word/document.xml": documentXml(body),
        "word/comments.xml": comments,
        "word/_rels/document.xml.rels": docRels(relationship("rId1", "comments", "comments.xml")),
      }),
    );
    const issues = result.issues.filter((issue) => issue.code === "comment-without-range");
    expect(issues).toHaveLength(2);
    expect(issues[0]?.detail).toContain('"1"');
    expect(issues[0]?.detail).toContain("commentRangeEnd");
    expect(issues[1]?.detail).toContain('"2"');
    expect(issues[1]?.detail).toContain("comments.xml");
  });

  it("collects several issues in one pass", async () => {
    const body = '<w:p><w:hyperlink r:id="rId9"/><w:ins w:id="1"/><w:del w:id="1"/></w:p>';
    const result = await validateDocx(
      await buildDocx({
        "word/document.xml": documentXml(body),
        "word/_rels/document.xml.rels": docRels(relationship("rId1", "styles", "styles.xml")),
        "word/comments.xml": "<w:comments",
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "xml-not-well-formed",
      "dangling-relationship",
      "unregistered-part",
      "duplicate-revision-id",
    ]);
  });
});
