import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { DocxClause, DocxDocument, DocxParagraph, ParagraphAnchor } from "../docx/types";
import { FINDING_KINDS, NEGOTIABILITY, SEVERITIES, type Finding, type VerifyCheckCode } from "./types";
import { type CodeCheckInput, runCodeChecks, summarizeChecks, VERIFY_CHECK_ORDER, verifyOk } from "./verify";
import { extractDefinedTermCandidates, extractXrefs, normaliseClauseId } from "./verify-text";

type ParagraphSpec = { text: string; definedTerms?: readonly string[] };

function paragraph(index: number, text: string): DocxParagraph {
  const anchor: ParagraphAnchor = `¶${index}`;
  return { anchor, index, style: "", number: "", text, originalText: text, runs: [{ text }], isHeading: false };
}

/** Hand-built DocxDocument: no zip parsing, every field of the shape filled in. */
function makeDoc(specs: readonly ParagraphSpec[]): DocxDocument {
  const paragraphs = specs.map((spec, index) => paragraph(index, spec.text));
  const definedTerms = specs.flatMap((spec, index) =>
    (spec.definedTerms ?? []).map((term) => ({ term, paragraph: `¶${index}` as ParagraphAnchor, definition: "" })),
  );
  const words = specs.flatMap((spec) => spec.text.split(/\s+/)).filter((word) => word !== "").length;
  return {
    paragraphs,
    tables: [],
    revisions: [],
    comments: [],
    definedTerms,
    meta: { title: "", author: "test", created: "", modified: "" },
    stats: { paragraphs: paragraphs.length, words, tables: 0, insertions: 0, deletions: 0, comments: 0 },
  };
}

function clause(id: string, path: readonly number[], parent: string | null): DocxClause {
  return { id, path, heading: "", paragraphs: [], text: "", parent };
}

const DRAFT = makeDoc([
  { text: "ARTICLE VII COVENANTS" },
  { text: "7.1 Financial Covenants. The Borrower shall maintain a Leverage Ratio of not more than 4.50x." },
  {
    text: 'The Borrower shall pay the "Facility Fee" within ten (10) Business Days of demand by the Agent.',
    definedTerms: ["Facility Fee", "Business Day", "Leverage Ratio"],
  },
  {
    text: "(b) Any Facility Fee not paid when due bears interest at the Default Rate.",
    definedTerms: ["Default Rate"],
  },
]);

const CLAUSES: readonly DocxClause[] = [
  clause("§7", [7], null),
  clause("§7.1", [7, 1], "§7"),
  clause("§7.2", [7, 2], "§7"),
  clause("§7.2(b)", [7, 2, 2], "§7.2"),
];

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F1",
    clause: "§7.2",
    kind: "adverse",
    quote: "",
    quoteAnchor: null,
    title: "Fee timing",
    why: "Ten days is short.",
    severity: "medium",
    negotiability: "fallback",
    proposedText: null,
    basis: [],
    reservedFor: null,
    checklist: [],
    round: 1,
    ...overrides,
  };
}

function baseInput(overrides: Partial<CodeCheckInput> = {}): CodeCheckInput {
  return {
    findings: [],
    docs: new Map([["S1", DRAFT]]),
    counterpartyDocId: "S1",
    clauses: CLAUSES,
    memo: {
      to: "Jane Doe, General Counsel",
      from: "Acme Legal",
      date: "2026-09-08",
      re: "ACA",
      privileged: true,
      sections: [],
    },
    memoText: "Acme Holdings and First National Bank. The Leverage Ratio covenant is set at 4.50x.",
    allowedNumbers: [4.5, 10],
    facts: {
      parties: ["Acme Holdings", "First National Bank"],
      addressee: "Jane Doe",
      author: "Acme Legal",
      dateIso: "2026-09-08",
    },
    instructions: [],
    redline: null,
    readDocIds: ["S1"],
    citedDocIds: ["S1"],
    skipped: [],
    ...overrides,
  };
}

function checkOf(input: CodeCheckInput, code: VerifyCheckCode) {
  const check = runCodeChecks(input).find((candidate) => candidate.code === code);
  if (!check) {
    throw new Error(`missing check ${code}`);
  }
  return check;
}

describe("runCodeChecks shape", () => {
  it("returns all eight checks in contract order with nothing to flag on a clean input", () => {
    const checks = runCodeChecks(baseInput());
    expect(checks.map((check) => check.code)).toEqual(VERIFY_CHECK_ORDER);
    expect(checks.every((check) => check.failed === 0)).toBe(true);
    expect(verifyOk(checks)).toBe(true);
  });
});

describe("quotes-verbatim", () => {
  it("passes when finding quotes are in the counterparty draft and memo quotes are in some doc", () => {
    const input = baseInput({
      findings: [finding({ quote: "within ten (10) Business Days of demand" })],
      memoText: "The draft says “within ten (10) Business  Days of demand by the Agent”.",
    });
    const check = checkOf(input, "quotes-verbatim");
    expect(check).toMatchObject({ passed: 2, failed: 0, failures: [] });
  });

  it("fails a finding whose quote is not verbatim and a memo quote found nowhere", () => {
    const input = baseInput({
      findings: [finding({ id: "F9", quote: "within twenty (20) Business Days of demand" })],
      memoText: 'The lender wrote "this sentence appears in no document at all".',
    });
    const check = checkOf(input, "quotes-verbatim");
    expect(check.failed).toBe(2);
    expect(check.failures[0]).toMatchObject({ code: "quotes-verbatim", target: "F9", autoFixable: false });
    expect(check.failures[1]).toMatchObject({ target: "memo", deliverable: "issues-memo" });
    expect(check.failures[1]?.detail).toContain("this sentence appears in no document at all");
  });

  it("ignores short memo quotes and empty finding quotes", () => {
    const input = baseInput({ findings: [finding({ kind: "missing", quote: "" })], memoText: 'A "short quote" only.' });
    expect(checkOf(input, "quotes-verbatim")).toMatchObject({ passed: 0, failed: 0 });
  });
});

describe("numbers-traced", () => {
  it("allows 4.50x and flags 4.75x", () => {
    expect(checkOf(baseInput({ memoText: "Leverage capped at 4.50x." }), "numbers-traced")).toMatchObject({
      passed: 1,
      failed: 0,
    });
    const check = checkOf(baseInput({ memoText: "Leverage capped at 4.75x." }), "numbers-traced");
    expect(check.failed).toBe(1);
    expect(check.failures[0]).toMatchObject({ target: "memo", deliverable: "issues-memo" });
    expect(check.failures[0]?.detail).toContain("4.75x");
  });

  it("does not read cross-references as figures and skips when there is no memo text", () => {
    expect(checkOf(baseInput({ memoText: "See §7.2(b) and Section 7.1." }), "numbers-traced").failed).toBe(0);
    expect(checkOf(baseInput({ memoText: null }), "numbers-traced")).toMatchObject({ passed: 0, failed: 0 });
  });
});

describe("xrefs-resolve", () => {
  it("normalises every accepted form to a clause id", () => {
    expect(extractXrefs("§7.2(b), § 7.2 (b), Section 7.2(b), Clause 7.2 and §7")).toEqual(["§7.2(b)", "§7.2", "§7"]);
    expect(normaliseClauseId('§1.1 "Material Adverse Effect"')).toBe("§1.1");
    expect(normaliseClauseId("Section 7.2 (B)")).toBe("§7.2(b)");
    expect(normaliseClauseId("Article VII")).toBe("articlevii");
  });

  it("passes when references in proposedText and memo exist among the clauses", () => {
    const input = baseInput({
      findings: [finding({ proposedText: "Subject to Section 7.2(b) and Clause 7.1." })],
      memoText: "See § 7.2 (b).",
    });
    expect(checkOf(input, "xrefs-resolve")).toMatchObject({ passed: 3, failed: 0 });
  });

  it("fails an unknown reference and marks it auto-fixable", () => {
    const input = baseInput({ findings: [finding({ id: "F2", proposedText: "As set out in §9.4(c)." })] });
    const check = checkOf(input, "xrefs-resolve");
    expect(check.failures).toEqual([
      {
        code: "xrefs-resolve",
        deliverable: "findings",
        target: "F2",
        detail: "cross-reference §9.4(c) is not a clause",
        autoFixable: true,
      },
    ]);
  });
});

describe("defined-terms", () => {
  it("passes terms defined in the draft or by a missing finding, and skips party names", () => {
    const input = baseInput({
      findings: [
        finding({
          proposedText: 'Acme Holdings shall pay the "Facility Fee" within five Business Days at the Default Rate.',
        }),
        finding({ id: "F3", kind: "missing", proposedText: '"Fee Cap" means the amount set out in Schedule 2.' }),
        finding({ id: "F4", proposedText: "The Fee Cap applies to First National Bank." }),
      ],
    });
    const check = checkOf(input, "defined-terms");
    expect(check.failures).toEqual([]);
    expect(check.passed).toBe(5);
  });

  it("fails an undefined quoted term and an undefined mid-sentence multi-word term", () => {
    const input = baseInput({
      findings: [
        finding({ id: "F5", proposedText: 'Material Adverse Effect means any "Fee Cap" or Change of Control.' }),
      ],
    });
    const check = checkOf(input, "defined-terms");
    expect(check.failures.map((failure) => failure.detail)).toEqual([
      'term "Fee Cap" is not defined in the draft',
      'term "Change of Control" is not defined in the draft',
    ]);
    expect(check.failures[0]).toMatchObject({ target: "F5", autoFixable: false });
  });

  it("skips sentence starts and single capitalised words", () => {
    expect(extractDefinedTermCandidates("The Borrower shall pay. Business Days follow.", [])).toEqual([]);
    expect(extractDefinedTermCandidates('within ten "Business Days"', [])).toEqual(["Business Days"]);
    expect(extractDefinedTermCandidates("The Fee Cap applies. The Borrower pays.", [])).toEqual(["Fee Cap"]);
  });
});

describe("facts-match", () => {
  it("passes when the memo names the addressee, author and every party", () => {
    expect(checkOf(baseInput(), "facts-match")).toMatchObject({ passed: 4, failed: 0 });
  });

  it("fails a wrong addressee and a missing party; skips when there is no memo", () => {
    const input = baseInput({
      memo: { to: "John Smith", from: "acme legal", date: "", re: "", privileged: false, sections: [] },
      memoText: "Only Acme Holdings is mentioned.",
    });
    const check = checkOf(input, "facts-match");
    expect(check.failures.map((failure) => failure.target)).toEqual(["to", "memo"]);
    expect(check.failures[1]?.detail).toContain("First National Bank");
    expect(checkOf(baseInput({ memo: null }), "facts-match")).toMatchObject({ passed: 0, failed: 0 });
  });
});

describe("instructions-obeyed", () => {
  it("passes a reserved finding with no proposedText and reservedFor set", () => {
    const input = baseInput({
      instructions: [{ reservedClause: "Section 7.2", by: "client" }],
      findings: [finding({ clause: "§7.2", proposedText: null, reservedFor: "client" })],
    });
    expect(checkOf(input, "instructions-obeyed")).toMatchObject({ passed: 1, failed: 0 });
  });

  it("fails a reserved finding that proposes text and lacks reservedFor, auto-fixable", () => {
    const input = baseInput({
      instructions: [{ reservedClause: "§ 7.2", by: "client" }],
      findings: [finding({ id: "F6", clause: "§7.2", proposedText: "Pay within thirty days.", reservedFor: null })],
    });
    const check = checkOf(input, "instructions-obeyed");
    expect(check).toMatchObject({ passed: 0, failed: 2 });
    expect(check.failures.every((failure) => failure.autoFixable && failure.target === "F6")).toBe(true);
  });
});

describe("docx-valid", () => {
  it("passes a valid redline with no failed patches and skips when there is no redline", () => {
    const ok = baseInput({ redline: { validation: { ok: true, issues: [] }, failed: 0 } });
    expect(checkOf(ok, "docx-valid")).toMatchObject({ passed: 1, failed: 0 });
    expect(checkOf(baseInput({ redline: null }), "docx-valid")).toMatchObject({ passed: 0, failed: 0 });
  });

  it("fails one failure per validation issue plus one for failed patches", () => {
    const bad = baseInput({
      redline: {
        validation: { ok: false, issues: [{ code: "duplicate-revision-id", detail: "id 4 twice" }] },
        failed: 2,
      },
    });
    const check = checkOf(bad, "docx-valid");
    expect(check.failures.map((failure) => failure.detail)).toEqual([
      "duplicate-revision-id: id 4 twice",
      "2 redline patch(es) failed to apply",
    ]);
    expect(check.failures[0]).toMatchObject({ deliverable: "redline", target: "redline", autoFixable: false });
  });
});

describe("coverage", () => {
  it("passes when every read doc is cited and nothing was skipped", () => {
    expect(checkOf(baseInput(), "coverage")).toMatchObject({ passed: 1, failed: 0 });
  });

  it("lists uncited and skipped docs without blocking the round", () => {
    const input = baseInput({
      readDocIds: ["S1", "S2"],
      citedDocIds: ["S1"],
      skipped: [{ doc: "S3", reason: "password protected" }],
    });
    const checks = runCodeChecks(input);
    const coverage = checks.find((check) => check.code === "coverage");
    expect(coverage?.failures).toEqual([
      { code: "coverage", deliverable: "findings", target: "S2", detail: "read, not cited", autoFixable: false },
      {
        code: "coverage",
        deliverable: "findings",
        target: "S3",
        detail: "skipped: password protected",
        autoFixable: false,
      },
    ]);
    expect(verifyOk(checks)).toBe(true);
    expect(summarizeChecks(checks)).toEqual({ passed: 6, failed: 2 });
  });
});

describe("verifyOk and summarizeChecks", () => {
  it("blocks on any non-coverage failure", () => {
    const checks = runCodeChecks(baseInput({ memoText: "Acme Holdings and First National Bank. Leverage at 7.25x." }));
    expect(verifyOk(checks)).toBe(false);
    expect(summarizeChecks(checks).failed).toBe(1);
  });
});

const findingArb: fc.Arbitrary<Finding> = fc.record({
  id: fc.integer({ min: 1, max: 99 }).map((n) => `F${n}`),
  clause: fc.constantFrom("§7.1", "§7.2", "§7.2(b)", "Section 7.2", "Article VII"),
  kind: fc.constantFrom(...FINDING_KINDS),
  quote: fc.constantFrom("", "within ten (10) Business Days", "not in the draft at all"),
  quoteAnchor: fc.constant(null),
  title: fc.string(),
  why: fc.string(),
  severity: fc.constantFrom(...SEVERITIES),
  negotiability: fc.constantFrom(...NEGOTIABILITY),
  proposedText: fc.option(fc.string(), { nil: null }),
  basis: fc.constant([]),
  reservedFor: fc.option(fc.constantFrom("client", "partner"), { nil: null }),
  checklist: fc.constant([]),
  round: fc.integer({ min: 1, max: 3 }),
});

const inputArb: fc.Arbitrary<CodeCheckInput> = fc.record({
  findings: fc.array(findingArb, { maxLength: 5 }),
  docs: fc.constant(new Map([["S1", DRAFT]])),
  counterpartyDocId: fc.constantFrom("S1", "S2"),
  clauses: fc.constant(CLAUSES),
  memo: fc.option(
    fc.record({
      to: fc.string(),
      from: fc.string(),
      date: fc.constant(""),
      re: fc.string(),
      privileged: fc.boolean(),
      sections: fc.constant([]),
    }),
    { nil: null },
  ),
  memoText: fc.option(fc.string(), { nil: null }),
  allowedNumbers: fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), { maxLength: 4 }),
  facts: fc.record({
    parties: fc.array(fc.string(), { maxLength: 3 }),
    addressee: fc.string(),
    author: fc.string(),
    dateIso: fc.constant("2026-09-08"),
  }),
  instructions: fc.array(fc.record({ reservedClause: fc.constantFrom("§7.2", "7.2(b)", ""), by: fc.string() }), {
    maxLength: 2,
  }),
  redline: fc.option(
    fc.record({
      validation: fc.record({ ok: fc.boolean(), issues: fc.constant([]) }),
      failed: fc.integer({ min: 0, max: 3 }),
    }),
    { nil: null },
  ),
  readDocIds: fc.array(fc.constantFrom("S1", "S2", "S3"), { maxLength: 3 }),
  citedDocIds: fc.array(fc.constantFrom("S1", "S2"), { maxLength: 2 }),
  skipped: fc.array(fc.record({ doc: fc.constant("S4"), reason: fc.string() }), { maxLength: 1 }),
});

describe("runCodeChecks properties", () => {
  it("never mutates its input and always returns exactly eight checks in contract order", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const before = structuredClone(input);
        const checks = runCodeChecks(input);
        expect(input).toEqual(before);
        expect(checks.map((check) => check.code)).toEqual(VERIFY_CHECK_ORDER);
        for (const check of checks) {
          expect(check.failed).toBe(check.failures.length);
          expect(check.passed).toBeGreaterThanOrEqual(0);
          expect(check.failures.every((failure) => failure.code === check.code)).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });
});
