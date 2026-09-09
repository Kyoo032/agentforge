import { describe, expect, it } from "vitest";
import { readDocx } from "./read";
import { loadFixture, makeDocument } from "./test-support";
import { documentText, findQuote, paragraphByAnchor } from "./text";

const SAMPLE = makeDocument({
  paragraphs: [
    "ARTICLE I",
    'The Borrower shall pay the "Facility Fee"  within ten (10) days.',
    "Second paragraph\nwith a line break.",
    "Tail",
  ],
  tables: [
    { index: 0, after: "¶1", rows: [["Ratio", "Margin"], ["≤ 2.00x", "225 bps\nper annum"]] },
    { index: 1, after: null, rows: [["Opening", "table"]] },
  ],
});

describe("documentText", () => {
  it("renders paragraphs and tables in body order with anchors", () => {
    expect(documentText(SAMPLE)).toBe(
      [
        "[T1] Opening | table",
        "[¶0] ARTICLE I",
        '[¶1] The Borrower shall pay the "Facility Fee"  within ten (10) days.',
        "[T0] Ratio | Margin",
        "[T0] ≤ 2.00x | 225 bps per annum",
        "[¶2] Second paragraph\nwith a line break.",
        "[¶3] Tail",
      ].join("\n"),
    );
  });

  it("renders the empty document as an empty string", () => {
    expect(documentText(makeDocument({ paragraphs: [] }))).toBe("");
  });
});

describe("paragraphByAnchor", () => {
  it("returns the paragraph or null", () => {
    expect(paragraphByAnchor(SAMPLE, "¶2")?.text).toBe("Second paragraph\nwith a line break.");
    expect(paragraphByAnchor(SAMPLE, "¶9")).toBeNull();
  });
});

describe("findQuote", () => {
  it("finds an exact substring and reports its start offset", () => {
    expect(findQuote(SAMPLE, "within ten (10) days")).toEqual({ anchor: "¶1", start: 43 });
  });

  it("matches curly quotes against straight quotes", () => {
    expect(findQuote(SAMPLE, "pay the “Facility Fee”")).toEqual({ anchor: "¶1", start: 19 });
    expect(findQuote(SAMPLE, "pay the ‘Facility Fee’")).toEqual({ anchor: "¶1", start: 19 });
  });

  it("ignores double spaces and line breaks on either side", () => {
    expect(findQuote(SAMPLE, '"Facility Fee" within ten')).toEqual({ anchor: "¶1", start: 27 });
    expect(findQuote(SAMPLE, "Second   paragraph with a line break.")).toEqual({ anchor: "¶2", start: 0 });
    expect(findQuote(SAMPLE, "pay\nthe")).toEqual({ anchor: "¶1", start: 19 });
  });

  it("trims the quote and returns null for empty or missing text", () => {
    expect(findQuote(SAMPLE, "  Tail  ")).toEqual({ anchor: "¶3", start: 0 });
    expect(findQuote(SAMPLE, "")).toBeNull();
    expect(findQuote(SAMPLE, "   ")).toBeNull();
    expect(findQuote(SAMPLE, "not in the document")).toBeNull();
  });

  it("searches table cells and reports the table position", () => {
    expect(findQuote(SAMPLE, "225 bps per annum")).toEqual({
      anchor: "¶1",
      start: 0,
      table: { index: 0, row: 1, cell: 1 },
    });
    expect(findQuote(SAMPLE, "Opening")).toEqual({ anchor: "¶0", start: 0, table: { index: 1, row: 0, cell: 0 } });
  });

  it("returns the first hit in body order", () => {
    const doc = makeDocument({ paragraphs: ["alpha beta", "beta gamma", "alpha beta"] });
    expect(findQuote(doc, "alpha")).toEqual({ anchor: "¶0", start: 0 });
    expect(findQuote(doc, "beta")).toEqual({ anchor: "¶0", start: 6 });
  });

  it("verifies a verbatim quote taken from a fixture", async () => {
    const doc = await readDocx(loadFixture("lender-initial-aca-draft"));
    const hit = findQuote(doc, "“Agreement” shall mean this Account Control Agreement");
    expect(hit).not.toBeNull();
    expect(paragraphByAnchor(doc, hit?.anchor ?? "¶0")?.text).toContain('"Agreement" shall mean');
  });
});
