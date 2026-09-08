import { describe, expect, it } from "vitest";
import { detectDefinedTerms, detectHeading, detectNumber, headingText } from "./paragraph-analysis";

describe("detectNumber", () => {
  it.each([
    ["7.2 The Bank shall", "7.2"],
    ["7.2(b) The Bank shall", "7.2(b)"],
    ["7.2(b)(iv) nested", "7.2(b)(iv)"],
    ["(b) Words in the singular", "(b)"],
    ["(iv) fourth", "(iv)"],
    ["(1) numeric item", "(1)"],
    ["Section 7.2 Payments", "7.2"],
    ["SECTION 7.2 PAYMENTS", "7.2"],
    ["Section 1: Parties", "1"],
    ["SECTION 1 — DEFINITIONS", "1"],
    ["Section 1.01 — Defined Terms. The following terms", "1.01"],
    ["§7.2(b) with section sign", "7.2(b)"],
    ["Article VII Miscellaneous", "Article VII"],
    ["ARTICLE 7 MISCELLANEOUS", "ARTICLE 7"],
    ["Article VII. Miscellaneous", "Article VII"],
    ["1. Introduction", "1"],
    ["1.1. Nested with trailing period", "1.1"],
    ["  3.4 leading spaces", "3.4"],
  ])("%j -> %j", (text, expected) => {
    expect(detectNumber(text)?.token).toBe(expected);
  });

  it.each([
    "Plain paragraph without a number",
    "2025 Annual Report",
    "(Reserved)",
    "A. Recital paragraphs are not numbered",
    "",
    "Section without a number",
  ])("returns null for %j", (text) => {
    expect(detectNumber(text)).toBeNull();
  });

  it("reports the consumed prefix length so callers can slice the title off", () => {
    const match = detectNumber("Section 1.01 — Defined Terms.");
    expect(match?.length).toBe("Section 1.01".length);
    expect(detectNumber("1. Intro")?.length).toBe(2);
  });
});

describe("detectHeading", () => {
  it("accepts Heading and Title styles", () => {
    expect(detectHeading("anything at all", "Heading2", null)).toBe(true);
    expect(detectHeading("anything at all", "Title", null)).toBe(true);
    expect(detectHeading("anything at all", "ListParagraph", null)).toBe(false);
  });

  it("accepts short all-caps paragraphs", () => {
    expect(detectHeading("ACCOUNT CONTROL AGREEMENT", "", null)).toBe(true);
    expect(detectHeading("SECTION 2 — THE CONTROLLED ACCOUNT; ESTABLISHMENT OF CONTROL", "", null)).toBe(true);
    expect(detectHeading("&nbsp;", "", null)).toBe(false);
    expect(detectHeading("2025", "", null)).toBe(false);
    expect(detectHeading(`THE ${"LONG ".repeat(20)}HEADING`, "", null)).toBe(false);
  });

  it("accepts Article/Section numbers followed by a short title", () => {
    const short = "Section 1: Parties";
    expect(detectHeading(short, "", detectNumber(short))).toBe(true);
    const long = `Section 1.01 — Defined Terms. ${"The following terms shall have the following meanings. ".repeat(3)}`;
    expect(detectHeading(long, "", detectNumber(long))).toBe(false);
    const list = "(b) Words in the singular";
    expect(detectHeading(list, "", detectNumber(list))).toBe(false);
  });
});

describe("headingText", () => {
  it.each([
    ["Section 1.01 — Defined Terms. The following terms shall have the meanings below.", "Defined Terms"],
    ["SECTION 1 — DEFINITIONS", "DEFINITIONS"],
    ["Section 1: Parties", "Parties"],
    ["Article VII Miscellaneous", "Miscellaneous"],
    ["7.2 Payments. The Borrower shall pay.", "Payments"],
    ["(b) Words in the singular shall include the plural, and words in the plural shall include the singular.", ""],
    ["ACCOUNT CONTROL AGREEMENT", "ACCOUNT CONTROL AGREEMENT"],
  ])("%j -> %j", (text, expected) => {
    expect(headingText(text)).toBe(expected);
  });
});

describe("detectDefinedTerms", () => {
  it("finds shall mean / means / has the meaning forms", () => {
    const text =
      '(c) "Agreement" shall mean this Account Control Agreement, as amended. "Bank" means Atlantic Fidelity Bank. "UCC" has the meaning given in Section 9.';
    expect(detectDefinedTerms(text, "¶3")).toEqual([
      { term: "Agreement", paragraph: "¶3", definition: "shall mean this Account Control Agreement, as amended." },
      { term: "Bank", paragraph: "¶3", definition: "means Atlantic Fidelity Bank." },
      { term: "UCC", paragraph: "¶3", definition: "has the meaning given in Section 9." },
    ]);
  });

  it("supports curly quotes and shall have the meaning", () => {
    const text = "“Liability Cap” shall have the meaning assigned to such term in Section 7.02.";
    expect(detectDefinedTerms(text, "¶0")).toEqual([
      { term: "Liability Cap", paragraph: "¶0", definition: "shall have the meaning assigned to such term in Section 7.02." },
    ]);
  });

  it("emits every alias in an or-chain", () => {
    const text = '"Notice of Exclusive Control" or "NEC" shall have the meaning assigned in the definition of "Activation Notice".';
    const terms = detectDefinedTerms(text, "¶1").map((term) => term.term);
    expect(terms).toEqual(["Notice of Exclusive Control", "NEC"]);
  });

  it("finds inline (the \"Term\") definitions and uses the preceding text", () => {
    const text = 'This ACCOUNT CONTROL AGREEMENT (this "Agreement") is entered into by Greystone (the "Depositor").';
    expect(detectDefinedTerms(text, "¶0")).toEqual([
      { term: "Agreement", paragraph: "¶0", definition: "This ACCOUNT CONTROL AGREEMENT" },
      { term: "Depositor", paragraph: "¶0", definition: 'This ACCOUNT CONTROL AGREEMENT (this "Agreement") is entered into by Greystone' },
    ]);
  });

  it("truncates definitions at 400 characters", () => {
    const text = `"Long" means ${"word ".repeat(200)}`;
    const [term] = detectDefinedTerms(text, "¶0");
    expect(term?.definition.length).toBe(400);
  });

  it("ignores quoted words that are not definitions", () => {
    const text = 'The words "include," "includes," and "including" shall be deemed to be followed by "without limitation."';
    expect(detectDefinedTerms(text, "¶0")).toEqual([]);
  });
});
