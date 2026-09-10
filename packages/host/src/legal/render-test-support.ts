/**
 * Fixtures shared by the renderer test suites. Not a test file itself (vitest only runs *.test.ts).
 */
import type { DocxClause, DocxDocument, DocxParagraph, ParagraphAnchor } from "@agentforge/core/docx";
import type { Finding, LegalSide, VerifyReport } from "@agentforge/core/legal";

export const SIDE: LegalSide = { role: "borrower", party: "Meridian Holdings LLC", counterparty: "the Lenders" };

export const BASE_FINDING: Finding = {
  id: "F0",
  clause: "§1.1",
  kind: "adverse",
  quote: "",
  quoteAnchor: null,
  title: "Untitled",
  why: "",
  severity: "low",
  negotiability: "preferred",
  proposedText: null,
  basis: [],
  reservedFor: null,
  checklist: [],
  round: 1,
};

export function makeFinding(overrides: Partial<Finding>): Finding {
  return { ...BASE_FINDING, ...overrides };
}

/** Four findings covering the kinds, severities, and the reserved case used across the suites. */
export const FINDINGS: readonly Finding[] = [
  makeFinding({
    id: "F1",
    clause: "§7.2(b)",
    kind: "adverse",
    quote: "the Borrower shall pay all costs of the Lenders",
    quoteAnchor: "¶2",
    title: "Uncapped cost reimbursement",
    why: "No cap on Lender costs.",
    severity: "high",
    negotiability: "fallback",
    proposedText: "the Borrower shall pay the reasonable and documented costs of the Lenders, subject to the Fee Cap",
    basis: [
      { doc: "S2", ref: "¶41" },
      { doc: "PB", ref: "CA-07" },
    ],
  }),
  makeFinding({
    id: "F2",
    clause: "§9.1",
    kind: "missing",
    title: "No cure period for covenant breach",
    why: "The draft omits a cure period.",
    severity: "medium",
    negotiability: "preferred",
    proposedText: "The Borrower shall have thirty (30) days to cure any breach of Section 9.1.",
    basis: [{ doc: "PB", ref: "CA-12" }],
    checklist: ["CA-12"],
  }),
  makeFinding({
    id: "F3",
    clause: "§3.4",
    kind: "unmarked-change",
    quote: "within five (5) Business Days",
    quoteAnchor: null,
    title: "Notice period shortened without marking",
    why: "Prior turn read ten (10) Business Days.",
    severity: "medium",
    negotiability: "walk-away",
    proposedText: "within ten (10) Business Days",
    basis: [{ doc: "S3", ref: "¶12" }],
  }),
  makeFinding({
    id: "F4",
    clause: "§11.2",
    kind: "interaction",
    quote: "Change of Control",
    quoteAnchor: "¶4",
    title: "Change of Control interacts with mandatory prepayment",
    why: "Triggers §5.1 prepayment.",
    severity: "low",
    negotiability: "reserved",
    proposedText: null,
    basis: [{ doc: "S1", ref: "¶77" }],
    reservedFor: "J. Partner",
  }),
];

const DRAFT_TEXT = [
  "ACCOUNT CONTROL AGREEMENT",
  "ARTICLE VII — Costs",
  "Section 7.2(b). Subject to this Agreement, the Borrower shall pay all costs of the Lenders.",
  "Section 3.4. Notice shall be given within five (5) Business Days.",
  "Section 11.2. Upon a Change of Control the Facility terminates.",
  "Section 12. Governing law.",
];

function paragraph(index: number, text: string): DocxParagraph {
  return {
    anchor: `¶${index}`,
    index,
    style: "",
    number: "",
    text,
    originalText: text,
    runs: [{ text }],
    isHeading: index === 0,
  };
}

/** Hand-built counterparty draft; anchors ¶0..¶5. */
export const DRAFT: DocxDocument = {
  paragraphs: DRAFT_TEXT.map((text, index) => paragraph(index, text)),
  tables: [],
  revisions: [],
  comments: [],
  definedTerms: [],
  meta: { title: "", author: "test", created: "", modified: "" },
  stats: { paragraphs: DRAFT_TEXT.length, words: 0, tables: 0, insertions: 0, deletions: 0, comments: 0 },
};

function clause(id: string, path: readonly number[], paragraphs: readonly ParagraphAnchor[]): DocxClause {
  return { id, path, heading: id, paragraphs, text: "", parent: null };
}

export const CLAUSES: readonly DocxClause[] = [
  clause("§7.2(b)", [7, 2, 2], ["¶1", "¶2"]),
  clause("§3.4", [3, 4], ["¶3"]),
  clause("§9.1", [9, 1], ["¶3"]),
  clause("§9.1(a)", [9, 1, 1], ["¶4"]),
  clause("§11.2", [11, 2], ["¶4"]),
];

export const VERIFY: VerifyReport = {
  round: 1,
  codeChecks: [
    { code: "quotes-verbatim", passed: 3, failed: 0, failures: [] },
    {
      code: "xrefs-resolve",
      passed: 1,
      failed: 1,
      failures: [
        {
          code: "xrefs-resolve",
          deliverable: "issues-memo",
          target: "§5.9",
          detail: "No such clause",
          autoFixable: true,
        },
      ],
    },
  ],
  checklist: [],
  concessions: [],
  documentsSkipped: [],
  openForHuman: [],
  ok: false,
};
