import { describe, expect, it } from "vitest";
import type { DocxDocument } from "../docx/types";
import { definedTermsForClause, instructionPassagesForClause } from "./clause-reading";

function doc(terms: DocxDocument["definedTerms"]): DocxDocument {
  return {
    paragraphs: [],
    tables: [],
    revisions: [],
    comments: [],
    definedTerms: terms,
    meta: { title: "", author: "", created: "", modified: "" },
    stats: { paragraphs: 0, words: 0, tables: 0, insertions: 0, deletions: 0, comments: 0 },
  };
}

describe("definedTermsForClause", () => {
  const draft = doc([
    { term: "Agreement", paragraph: "¶1", definition: "means this agreement." },
    { term: "Fee", paragraph: "¶2", definition: "means the amount in Schedule 1." },
  ]);

  it("returns only terms the clause uses", () => {
    const terms = definedTermsForClause(draft, "This Agreement shall continue.");
    expect(terms.map((term) => term.term)).toEqual(["Agreement"]);
    expect(terms[0]?.paragraph).toBe("¶1");
  });

  it("does not match a term inside another word", () => {
    expect(definedTermsForClause(draft, "The agreement fee is unpaid.").map((term) => term.term)).toEqual([]);
  });
});

describe("instructionPassagesForClause", () => {
  it("keeps instruction lines that share the clause's words", () => {
    const passages = instructionPassagesForClause(
      [
        {
          source: "instructions",
          text: "Leave the fee open.\nThe governing law of the contract is England and Wales.",
        },
      ],
      "The governing law of this Agreement is the State of New York.",
    );
    expect(passages).toHaveLength(1);
    expect(passages[0]?.source).toBe("instructions");
    expect(passages[0]?.text).toContain("governing law");
  });
});
