import { describe, expect, it } from "vitest";
import { readDocx } from "./read";
import { FIXTURE_NAMES, R_NS, W_NS, buildDocx, loadFixture, wrapBody } from "./test-support";

const FIXTURE_REVISIONS = [
  ["depositary-bank-round-1-redline", 57, 44],
  ["borrower-round-2-comments", 28, 17],
  ["lender-round-3-counter-redline", 19, 37],
  ["lender-markup-term-sheet", 48, 34],
] as const;

const CLEAN_FIXTURES = ["lender-initial-aca-draft", "original-term-sheet"] as const;
const TERM_SHEETS = ["original-term-sheet", "lender-markup-term-sheet"] as const;
const TERM_SHEET_TABLES = 3;
const MIN_DELETION_CHARS = 20;
const MIN_ACA_DEFINED_TERMS = 3;

describe("readDocx on the fixtures", () => {
  it.each(FIXTURE_NAMES)("%s has body paragraphs and string meta", async (name) => {
    const doc = await readDocx(loadFixture(name));
    expect(doc.paragraphs.length).toBeGreaterThan(0);
    expect(typeof doc.meta.author).toBe("string");
    expect(typeof doc.meta.title).toBe("string");
    expect(doc.stats.paragraphs).toBe(doc.paragraphs.length);
    expect(doc.stats.words).toBeGreaterThan(100);
    doc.paragraphs.forEach((paragraph, index) => {
      expect(paragraph.index).toBe(index);
      expect(paragraph.anchor).toBe(`¶${index}`);
    });
  });

  it.each(FIXTURE_REVISIONS)("%s carries %i insertions and %i deletions", async (name, insertions, deletions) => {
    const doc = await readDocx(loadFixture(name));
    expect(doc.revisions.filter((revision) => revision.kind === "ins")).toHaveLength(insertions);
    expect(doc.revisions.filter((revision) => revision.kind === "del")).toHaveLength(deletions);
    expect(doc.stats.insertions).toBe(insertions);
    expect(doc.stats.deletions).toBe(deletions);
    expect(new Set(doc.revisions.map((revision) => revision.id)).size).toBe(doc.revisions.length);
    for (const revision of doc.revisions) {
      expect(revision.author).not.toBe("");
    }
  });

  it.each(CLEAN_FIXTURES)("%s has no revisions and identical views", async (name) => {
    const doc = await readDocx(loadFixture(name));
    expect(doc.revisions).toHaveLength(0);
    for (const paragraph of doc.paragraphs) {
      expect(paragraph.originalText).toBe(paragraph.text);
    }
  });

  it.each(TERM_SHEETS)("%s has three tables with a pricing grid first", async (name) => {
    const doc = await readDocx(loadFixture(name));
    expect(doc.tables).toHaveLength(TERM_SHEET_TABLES);
    expect(doc.stats.tables).toBe(TERM_SHEET_TABLES);
    const [first] = doc.tables;
    expect(first?.rows.length).toBeGreaterThan(1);
    expect(first?.rows[0]?.length).toBeGreaterThanOrEqual(2);
    expect(first?.rows[0]?.[0]).toBe("Total Leverage Ratio");
    expect(first?.after).toMatch(/^¶\d+$/);
  });

  it("reads the original term sheet grid with three columns", async () => {
    const doc = await readDocx(loadFixture("original-term-sheet"));
    expect(doc.tables[0]?.rows[0]).toHaveLength(3);
  });

  function occurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  it("excludes deleted words from text but keeps them in originalText", async () => {
    const doc = await readDocx(loadFixture("depositary-bank-round-1-redline"));
    const deletions = doc.revisions.filter(
      (revision) => revision.kind === "del" && revision.text.trim().length >= MIN_DELETION_CHARS,
    );
    expect(deletions.length).toBeGreaterThan(0);
    for (const deletion of deletions) {
      const paragraph = doc.paragraphs.find((candidate) => candidate.anchor === deletion.paragraph);
      expect(paragraph).toBeDefined();
      const needle = deletion.text.trim();
      expect(paragraph?.originalText).toContain(needle);
      // A deleted sentence may be re-typed later in the same paragraph, so compare counts rather than presence.
      expect(occurrences(paragraph?.text ?? "", needle)).toBeLessThan(occurrences(paragraph?.originalText ?? "", needle));
    }
  });

  it("includes inserted words in text but not in originalText", async () => {
    const doc = await readDocx(loadFixture("depositary-bank-round-1-redline"));
    const insertions = doc.revisions.filter(
      (revision) => revision.kind === "ins" && revision.text.trim().length >= MIN_DELETION_CHARS,
    );
    expect(insertions.length).toBeGreaterThan(0);
    for (const insertion of insertions) {
      const paragraph = doc.paragraphs.find((candidate) => candidate.anchor === insertion.paragraph);
      expect(paragraph?.text).toContain(insertion.text.trim());
      expect(paragraph?.originalText).not.toContain(insertion.text.trim());
    }
  });

  it("finds defined terms in the ACA draft", async () => {
    const doc = await readDocx(loadFixture("lender-initial-aca-draft"));
    const terms = doc.definedTerms.map((term) => term.term);
    console.info(`ACA defined terms (${terms.length}): ${terms.join(" | ")}`);
    expect(terms.length).toBeGreaterThanOrEqual(MIN_ACA_DEFINED_TERMS);
    expect(terms).toContain("Agreement");
    expect(terms).toContain("Depositary Bank");
    const agreement = doc.definedTerms.find((term) => term.term === "Agreement");
    expect(agreement?.definition.length).toBeGreaterThan(0);
    expect(agreement?.definition.length).toBeLessThanOrEqual(400);
  });

  it("detects section numbers and headings in the ACA draft", async () => {
    const doc = await readDocx(loadFixture("lender-initial-aca-draft"));
    const numbered = doc.paragraphs.filter((paragraph) => paragraph.number !== "");
    expect(numbered.length).toBeGreaterThan(20);
    expect(numbered.map((paragraph) => paragraph.number)).toContain("1.01");
    expect(numbered.map((paragraph) => paragraph.number)).toContain("(a)");
    const definitions = doc.paragraphs.find((paragraph) => paragraph.text.startsWith("SECTION 1"));
    expect(definitions?.isHeading).toBe(true);
    expect(definitions?.number).toBe("1");
  });

  it("never mutates its input bytes", async () => {
    const bytes = loadFixture("borrower-round-2-comments");
    const snapshot = Uint8Array.from(bytes);
    await readDocx(bytes);
    expect(bytes).toEqual(snapshot);
  });
});

const SYNTHETIC_BODY = [
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>ARTICLE I</w:t></w:r></w:p>',
  "<w:p>",
  '<w:commentRangeStart w:id="0"/>',
  '<w:r><w:t xml:space="preserve">The Borrower shall </w:t></w:r>',
  '<w:del w:id="1" w:author="Ann" w:date="2025-01-02T00:00:00Z"><w:r><w:delText xml:space="preserve">promptly </w:delText></w:r></w:del>',
  '<w:ins w:id="2" w:author="Bob" w:date="2025-01-03T00:00:00Z"><w:r><w:t xml:space="preserve">within ten days </w:t></w:r></w:ins>',
  "<w:r><w:t>pay</w:t></w:r>",
  '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>',
  "<w:r><w:tab/><w:t>the</w:t><w:br/><w:t>fee.</w:t></w:r>",
  "</w:p>",
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
  '<w:hyperlink r:id="rId9"><w:r><w:t xml:space="preserve">1.1 </w:t></w:r></w:hyperlink>',
  '<w:sdt><w:sdtContent><w:r><w:t>"Fee" means the amount in Schedule 1.</w:t></w:r></w:sdtContent></w:sdt>',
  "</w:p>",
  "<w:tbl><w:tr>",
  "<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>",
  '<w:tc><w:p><w:del w:id="3" w:author="Ann" w:date=""><w:r><w:delText>old</w:delText></w:r></w:del>',
  '<w:ins w:id="4" w:author="Ann" w:date=""><w:r><w:t>new</w:t></w:r></w:ins></w:p></w:tc>',
  "</w:tr></w:tbl>",
  "<w:p><w:smartTag><w:r><w:t>Tail</w:t></w:r></w:smartTag></w:p>",
  "<w:sectPr/>",
].join("");

const SYNTHETIC_COMMENTS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W_NS}"><w:comment w:id="0" w:author="Cara" w:date="2025-01-04T00:00:00Z"><w:p><w:r><w:t>First line</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:comment></w:comments>`;

const SYNTHETIC_NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W_NS}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const SYNTHETIC_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Loan Agreement</dc:title><dc:creator>Dana</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2025-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2025-02-01T00:00:00Z</dcterms:modified></cp:coreProperties>`;

describe("readDocx on a synthetic document", () => {
  async function readSynthetic() {
    const bytes = await buildDocx({
      body: SYNTHETIC_BODY,
      comments: SYNTHETIC_COMMENTS,
      numbering: SYNTHETIC_NUMBERING,
      core: SYNTHETIC_CORE,
    });
    return readDocx(bytes);
  }

  it("produces the accepted and original views with tabs and breaks", async () => {
    const doc = await readSynthetic();
    expect(doc.paragraphs.map((paragraph) => paragraph.text)).toEqual([
      "ARTICLE I",
      "The Borrower shall within ten days pay\tthe\nfee.",
      '1.1 "Fee" means the amount in Schedule 1.',
      "Tail",
    ]);
    expect(doc.paragraphs[1]?.originalText).toBe("The Borrower shall promptly pay\tthe\nfee.");
    expect(doc.paragraphs[0]?.originalText).toBe("ARTICLE I");
  });

  it("marks runs with revisions and comment ids", async () => {
    const doc = await readSynthetic();
    expect(doc.paragraphs[1]?.runs).toEqual([
      { text: "The Borrower shall ", comments: ["0"] },
      { text: "promptly ", revision: "del", comments: ["0"] },
      { text: "within ten days ", revision: "ins", comments: ["0"] },
      { text: "pay", comments: ["0"] },
      { text: "\tthe\nfee." },
    ]);
  });

  it("lists revisions in document order, including those inside tables", async () => {
    const doc = await readSynthetic();
    expect(doc.revisions).toEqual([
      { id: "1", kind: "del", author: "Ann", date: "2025-01-02T00:00:00Z", text: "promptly ", paragraph: "¶1" },
      { id: "2", kind: "ins", author: "Bob", date: "2025-01-03T00:00:00Z", text: "within ten days ", paragraph: "¶1" },
      { id: "3", kind: "del", author: "Ann", date: "", text: "old", paragraph: "¶2" },
      { id: "4", kind: "ins", author: "Ann", date: "", text: "new", paragraph: "¶2" },
    ]);
  });

  it("resolves comments from comments.xml with their paragraph ranges", async () => {
    const doc = await readSynthetic();
    expect(doc.comments).toEqual([
      { id: "0", author: "Cara", date: "2025-01-04T00:00:00Z", text: "First line\nSecond line", paragraphs: ["¶1"] },
    ]);
  });

  it("reads tables with accepted cell text and the preceding anchor", async () => {
    const doc = await readSynthetic();
    expect(doc.tables).toEqual([{ index: 0, after: "¶2", rows: [["A\nB", "new"]] }]);
  });

  it("detects style headings, numbers, and defined terms", async () => {
    const doc = await readSynthetic();
    expect(doc.paragraphs[0]).toMatchObject({ style: "Heading1", number: "ARTICLE I", isHeading: true });
    expect(doc.paragraphs[2]).toMatchObject({ number: "1.1", isHeading: false });
    expect(doc.definedTerms).toEqual([{ term: "Fee", paragraph: "¶2", definition: "means the amount in Schedule 1." }]);
  });

  it("reads core properties and computes stats", async () => {
    const doc = await readSynthetic();
    expect(doc.meta).toEqual({
      title: "Loan Agreement",
      author: "Dana",
      created: "2025-01-01T00:00:00Z",
      modified: "2025-02-01T00:00:00Z",
    });
    expect(doc.stats).toEqual({ paragraphs: 4, words: 23, tables: 1, insertions: 2, deletions: 2, comments: 1 });
  });

  it("returns empty meta and comments when the optional parts are missing", async () => {
    const doc = await readDocx(await buildDocx({ body: "<w:p><w:r><w:t>Only</w:t></w:r></w:p>" }));
    expect(doc.meta).toEqual({ title: "", author: "", created: "", modified: "" });
    expect(doc.comments).toEqual([]);
    expect(doc.paragraphs[0]?.text).toBe("Only");
  });

  it("collapses the double space left behind by a removed run", async () => {
    const body =
      '<w:p><w:r><w:t xml:space="preserve">from Party </w:t></w:r><w:del w:id="9" w:author="A" w:date=""><w:r><w:delText>(or Depositor)</w:delText></w:r></w:del><w:r><w:t xml:space="preserve"> directing</w:t></w:r></w:p>';
    const doc = await readDocx(await buildDocx({ body }));
    expect(doc.paragraphs[0]?.text).toBe("from Party directing");
    expect(doc.paragraphs[0]?.originalText).toBe("from Party (or Depositor) directing");
  });

  it("supports a comment range that spans paragraphs", async () => {
    const body = [
      '<w:p><w:commentRangeStart w:id="7"/><w:r><w:t>one</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>two</w:t></w:r><w:commentRangeEnd w:id="7"/></w:p>',
      "<w:p><w:r><w:t>three</w:t></w:r></w:p>",
    ].join("");
    const comments = `<w:comments xmlns:w="${W_NS}"><w:comment w:id="7" w:author="Z" w:date=""><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment></w:comments>`;
    const doc = await readDocx(await buildDocx({ body, comments }));
    expect(doc.comments[0]?.paragraphs).toEqual(["¶0", "¶1"]);
    expect(doc.paragraphs[2]?.runs[0]?.comments).toBeUndefined();
  });
});

describe("readDocx errors", () => {
  it("rejects bytes that are not a zip archive", async () => {
    await expect(readDocx(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/^docx:/);
  });

  it("rejects a package without word/document.xml", async () => {
    const bytes = await buildDocx({ document: null });
    await expect(readDocx(bytes)).rejects.toThrow(/^docx: .*word\/document\.xml/);
  });

  it("rejects malformed XML instead of returning partial results", async () => {
    const bytes = await buildDocx({ document: `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r><w:t>x</w:t></w:p>` });
    await expect(readDocx(bytes)).rejects.toThrow(/^docx:/);
  });

  it("rejects a document without a w:body", async () => {
    const bytes = await buildDocx({ document: wrapBody("").replace("<w:body></w:body>", "") });
    await expect(readDocx(bytes)).rejects.toThrow(/^docx:/);
  });

  it("rejects malformed comments.xml", async () => {
    const bytes = await buildDocx({ body: "<w:p/>", comments: "<w:comments><w:comment>" });
    await expect(readDocx(bytes)).rejects.toThrow(/^docx:/);
  });
});
