import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { appendRound, applyFindingEdits, createLedger } from "./ledger";
import { FINDING_KINDS, NEGOTIABILITY, SEVERITIES } from "./types";
import type { EditPatch, Finding, MatterDocCard, RoundRecord, VerifyReport } from "./types";

function finding(id: string, partial: Partial<Finding> = {}): Finding {
  return {
    id,
    clause: "§7.2(b)",
    kind: "adverse",
    quote: "shall indemnify each Lender Party",
    quoteAnchor: "¶41",
    title: "Uncapped indemnity",
    why: "The indemnity is not subject to the liability cap.",
    severity: "high",
    negotiability: "preferred",
    proposedText: null,
    basis: [{ doc: "S2", ref: "¶12" }],
    reservedFor: null,
    checklist: ["CR-19"],
    round: 1,
    ...partial,
  };
}

const DOC: MatterDocCard = {
  id: "S1",
  name: "draft.docx",
  path: "draft.docx",
  mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  bytes: 10,
  sha256: "0".repeat(64),
  role: "counterparty-draft",
  status: "read",
  paragraphs: 1,
  words: 2,
  insertions: 0,
  deletions: 0,
  definedTerms: 0,
  preview: "",
};

const VERIFY: VerifyReport = {
  round: 1,
  codeChecks: [],
  checklist: [],
  concessions: [],
  documentsSkipped: [],
  openForHuman: [],
  ok: true,
};

function patch(
  ref: string,
  replacement: unknown,
  round = 2,
  deliverable: EditPatch["target"]["deliverable"] = "findings",
): EditPatch {
  return { round, target: { deliverable, ref }, reason: "quotes-verbatim", replacement, appliedBy: "model" };
}

describe("createLedger and appendRound", () => {
  it("copies its inputs and starts with no rounds", () => {
    const docs = [DOC];
    const findings = [finding("F1")];
    const ledger = createLedger(docs, findings);
    expect(ledger.docs).toEqual(docs);
    expect(ledger.findings).toEqual(findings);
    expect(ledger.rounds).toEqual([]);
    expect(ledger.docs).not.toBe(docs);
    expect(ledger.findings).not.toBe(findings);
  });

  it("appendRound returns a new ledger and leaves the original untouched", () => {
    const ledger = createLedger([DOC], [finding("F1")]);
    const round: RoundRecord = { round: 1, verify: VERIFY, edits: [] };
    const next = appendRound(ledger, round);
    expect(next).not.toBe(ledger);
    expect(next.rounds).toEqual([round]);
    expect(ledger.rounds).toEqual([]);
    expect(next.rounds).not.toBe(ledger.rounds);
    expect(next.docs).toBe(ledger.docs);
    expect(next.findings).toBe(ledger.findings);
  });
});

describe("applyFindingEdits", () => {
  it("replaces the matching finding, keeps its id and anchor, and sets the patch round", () => {
    const original = [finding("F1"), finding("F2", { clause: "§9.1", title: "Broad assignment" })];
    const replacement = {
      kind: "deviation",
      clause: "§7.2(b)",
      quote: "shall indemnify each Finance Party",
      title: "Uncapped indemnity (revised)",
      why: "Revised after verification.",
      severity: "medium",
      negotiability: "fallback",
      proposedText: "The Borrower shall indemnify each Finance Party up to the Fee Cap.",
      basis: [{ doc: "S2", ref: "¶12" }],
      checklist: ["CR-19"],
    };
    const { findings, ignored } = applyFindingEdits(original, [patch("F1", replacement, 3)]);
    expect(ignored).toEqual([]);
    expect(findings).toHaveLength(2);
    const updated = findings[0] as Finding;
    expect(updated.id).toBe("F1");
    expect(updated.round).toBe(3);
    expect(updated.quoteAnchor).toBe("¶41");
    expect(updated.title).toBe("Uncapped indemnity (revised)");
    expect(updated.severity).toBe("medium");
    expect(updated.proposedText).toBe("The Borrower shall indemnify each Finance Party up to the Fee Cap.");
    expect(findings[1]).toEqual(original[1]);
    expect(original[0]?.title).toBe("Uncapped indemnity");
  });

  it("merges a partial replacement over the original without applying schema defaults", () => {
    const original = [finding("F1")];
    const { findings } = applyFindingEdits(original, [patch("F1", { why: "Amended reasoning." })]);
    const updated = findings[0] as Finding;
    expect(updated.why).toBe("Amended reasoning.");
    expect(updated.quote).toBe("shall indemnify each Lender Party");
    expect(updated.severity).toBe("high");
    expect(updated.basis).toEqual([{ doc: "S2", ref: "¶12" }]);
  });

  it("ignores unknown ids and invalid replacements and reports them", () => {
    const original = [finding("F1")];
    const { findings, ignored } = applyFindingEdits(original, [
      patch("F9", { title: "Ghost" }),
      patch("F1", { severity: "catastrophic" }),
    ]);
    expect(ignored).toEqual(["F9", "F1"]);
    expect(findings).toEqual(original);
  });

  it("skips patches aimed at other deliverables", () => {
    const original = [finding("F1")];
    const { findings, ignored } = applyFindingEdits(original, [patch("F1", { title: "Memo" }, 2, "issues-memo")]);
    expect(findings).toEqual(original);
    expect(ignored).toEqual([]);
  });

  it("applies patches in order so later edits win", () => {
    const original = [finding("F1")];
    const { findings } = applyFindingEdits(original, [
      patch("F1", { title: "First" }, 2),
      patch("F1", { title: "Second" }, 3),
    ]);
    expect(findings[0]?.title).toBe("Second");
    expect(findings[0]?.round).toBe(3);
  });

  it("property: an empty patch list returns structurally equal findings in a new array", () => {
    const findingArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 6 }),
      clause: fc.string({ minLength: 1, maxLength: 12 }),
      kind: fc.constantFrom(...FINDING_KINDS),
      quote: fc.string({ maxLength: 40 }),
      quoteAnchor: fc.constant(null),
      title: fc.string({ minLength: 1, maxLength: 20 }),
      why: fc.string({ maxLength: 40 }),
      severity: fc.constantFrom(...SEVERITIES),
      negotiability: fc.constantFrom(...NEGOTIABILITY),
      proposedText: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
      basis: fc.array(fc.record({ doc: fc.constant("S1"), ref: fc.constant("¶1") }), { maxLength: 3 }),
      reservedFor: fc.constant(null),
      checklist: fc.array(fc.string({ maxLength: 6 }), { maxLength: 3 }),
      round: fc.integer({ min: 1, max: 3 }),
    });
    fc.assert(
      fc.property(fc.array(findingArb, { maxLength: 8 }), (findings) => {
        const result = applyFindingEdits(findings, []);
        expect(result.findings).toEqual(findings);
        expect(result.findings).not.toBe(findings);
        expect(result.ignored).toEqual([]);
      }),
    );
  });
});
