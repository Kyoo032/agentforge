import { describe, expect, it } from "vitest";
import { readDocx } from "./read";
import { splitClauses } from "./sections";
import { loadFixture, makeDocument } from "./test-support";
import type { DocxClause, DocxDocument } from "./types";

const MIN_FIXTURE_CLAUSES = 5;

function expectWellFormed(doc: DocxDocument, clauses: readonly DocxClause[]): void {
  const ids = clauses.map((clause) => clause.id);
  expect(new Set(ids).size).toBe(ids.length);
  const seen = clauses.flatMap((clause) => clause.paragraphs);
  expect(seen.length).toBe(doc.paragraphs.length);
  expect(new Set(seen).size).toBe(doc.paragraphs.length);
  for (const clause of clauses) {
    if (clause.parent !== null) {
      expect(ids).toContain(clause.parent);
    }
    expect(clause.text).toBe(
      clause.paragraphs.map((anchor) => doc.paragraphs.find((paragraph) => paragraph.anchor === anchor)?.text).join("\n"),
    );
  }
}

describe("splitClauses on the fixtures", () => {
  it("splits the ACA draft into a numbered tree", async () => {
    const doc = await readDocx(loadFixture("lender-initial-aca-draft"));
    const clauses = splitClauses(doc);
    expect(clauses.length).toBeGreaterThan(MIN_FIXTURE_CLAUSES);
    expectWellFormed(doc, clauses);
    expect(clauses[0]?.id).toBe("Preamble");
    expect(clauses[0]?.path).toEqual([0]);
    const definitions = clauses.find((clause) => clause.id === "§1.01");
    expect(definitions?.path).toEqual([1, 1]);
    expect(definitions?.parent).toBe("§1");
    expect(definitions?.heading).toBe("Defined Terms");
    const agreement = clauses.find((clause) => clause.id === '§1.01(c) "Agreement"');
    expect(agreement?.path).toEqual([1, 1, 3]);
    expect(agreement?.parent).toBe("§1.01");
  });

  it("splits the term sheet into sections", async () => {
    const doc = await readDocx(loadFixture("original-term-sheet"));
    const clauses = splitClauses(doc);
    expect(clauses.length).toBeGreaterThan(MIN_FIXTURE_CLAUSES);
    expectWellFormed(doc, clauses);
    const parties = clauses.find((clause) => clause.id === "§1");
    expect(parties?.heading).toBe("Parties");
    expect(parties?.parent).toBeNull();
  });

  it("splits the redline fixtures without losing paragraphs", async () => {
    for (const name of ["depositary-bank-round-1-redline", "lender-markup-term-sheet"] as const) {
      const doc = await readDocx(loadFixture(name));
      expectWellFormed(doc, splitClauses(doc));
    }
  });
});

describe("splitClauses on a synthetic document", () => {
  const doc = makeDocument({
    paragraphs: [
      "LOAN AGREEMENT",
      "This agreement is made between the parties.",
      { text: "Article I Definitions", number: "Article I", isHeading: true },
      { text: '1.1 "Material Adverse Effect" means a material adverse change.', number: "1.1" },
      { text: "1.2 Interpretation. Headings are for convenience.", number: "1.2" },
      { text: "(a) first item", number: "(a)" },
      { text: "(b) second item", number: "(b)" },
      { text: "(i) roman one", number: "(i)" },
      { text: "(ii) roman two", number: "(ii)" },
      "continuation paragraph without a number",
      { text: "(c) third item", number: "(c)" },
      { text: "ARTICLE II Covenants", number: "ARTICLE II", isHeading: true },
      { text: "2.1 Term. The term is five years.", number: "2.1" },
      { text: "7.2(b) direct sub-clause", number: "7.2(b)" },
    ],
  });

  it("builds ids, paths, and parents", () => {
    const clauses = splitClauses(doc);
    expect(clauses.map((clause) => [clause.id, clause.path, clause.parent])).toEqual([
      ["Preamble", [0], null],
      ["Article I", [1], null],
      ['§1.1 "Material Adverse Effect"', [1, 1], "Article I"],
      ["§1.2", [1, 2], "Article I"],
      ["§1.2(a)", [1, 2, 1], "§1.2"],
      ["§1.2(b)", [1, 2, 2], "§1.2"],
      ["§1.2(b)(i)", [1, 2, 2, 1], "§1.2(b)"],
      ["§1.2(b)(ii)", [1, 2, 2, 2], "§1.2(b)"],
      ["§1.2(c)", [1, 2, 3], "§1.2"],
      ["ARTICLE II", [2], null],
      ["§2.1", [2, 1], "ARTICLE II"],
      ["§7.2(b)", [7, 2, 2], null],
    ]);
  });

  it("attaches unnumbered paragraphs to the current clause and fills headings", () => {
    const clauses = splitClauses(doc);
    expect(clauses[0]?.paragraphs).toEqual(["¶0", "¶1"]);
    expect(clauses.find((clause) => clause.id === "§1.2(b)(ii)")?.paragraphs).toEqual(["¶8", "¶9"]);
    expect(clauses.find((clause) => clause.id === "§1.2")?.heading).toBe("Interpretation");
    expect(clauses.find((clause) => clause.id === "Article I")?.heading).toBe("Definitions");
    expect(clauses.find((clause) => clause.id === '§1.1 "Material Adverse Effect"')?.heading).toBe(
      "Material Adverse Effect",
    );
    expect(clauses.find((clause) => clause.id === "§2.1")?.text).toBe("2.1 Term. The term is five years.");
  });

  it("treats (i) after (h) as the letter i, not roman one", () => {
    const letters = "abcdefghi".split("").map((letter) => ({ text: `(${letter}) item`, number: `(${letter})` }));
    const clauses = splitClauses(makeDocument({ paragraphs: [{ text: "3.1 List", number: "3.1" }, ...letters] }));
    expect(clauses.at(-1)?.id).toBe("§3.1(i)");
    expect(clauses.at(-1)?.path).toEqual([3, 1, 9]);
  });

  it("keeps ids unique when a list restarts under the same parent", () => {
    const clauses = splitClauses(
      makeDocument({
        paragraphs: [
          { text: "4.1 Lists", number: "4.1" },
          { text: "(a) one", number: "(a)" },
          "bridge",
          { text: "(a) again", number: "(a)" },
        ],
      }),
    );
    const ids = clauses.map((clause) => clause.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(clauses.flatMap((clause) => clause.paragraphs)).toEqual(["¶0", "¶1", "¶2", "¶3"]);
  });

  it("returns a single preamble for an unnumbered document and nothing for an empty one", () => {
    expect(splitClauses(makeDocument({ paragraphs: ["a", "b"] }))).toEqual([
      { id: "Preamble", path: [0], heading: "Preamble", paragraphs: ["¶0", "¶1"], text: "a\nb", parent: null },
    ]);
    expect(splitClauses(makeDocument({ paragraphs: [] }))).toEqual([]);
  });
});
