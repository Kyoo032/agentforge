import { describe, expect, it } from "vitest";
import { findPlaybook } from "./checklists";
import { DELIVERABLE_MANUALS, type PreambleInput, type StageCardInput, buildPreamble, buildStageCard } from "./prompts";
import { DELIVERABLE_KINDS, type MatterDocCard } from "./types";

const INFORMAL_WORDS = ["hurt", "attack", "your call", "guys"] as const;

function card(partial: Partial<MatterDocCard> & Pick<MatterDocCard, "id" | "name" | "role">): MatterDocCard {
  return {
    path: partial.name,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: 1024,
    sha256: "0".repeat(64),
    status: "read",
    paragraphs: 10,
    words: 500,
    insertions: 0,
    deletions: 0,
    definedTerms: 0,
    preview: "PREVIEW-TEXT-MUST-NOT-LEAK",
    ...partial,
  };
}

const DOCS: readonly MatterDocCard[] = [
  card({
    id: "S1",
    name: "credit-agreement-draft-v3-lender-turn.docx",
    role: "counterparty-draft",
    paragraphs: 214,
    definedTerms: 38,
  }),
  card({ id: "S2", name: "executed-term-sheet.docx", role: "executed", paragraphs: 41 }),
  card({ id: "S3", name: "commitment-letter.docx", role: "executed", paragraphs: 27 }),
  card({ id: "S4", name: "re-no-flex-confirmation.docx", role: "instruction", paragraphs: 5 }),
  card({
    id: "S9",
    name: "lender-presentation-march.docx",
    role: "context",
    status: "skipped",
    skipReason: "image-only content, no text",
    paragraphs: 0,
  }),
];

const INPUT: PreambleInput = {
  side: { role: "borrower", party: "Meridian Industrial Holdings", counterparty: "the Lenders" },
  workType: "review",
  deliverables: ["issues-memo", "redline", "deviation-report"],
  author: "Samuel Roth, Senior Associate",
  addressee: "Priya Chakravarti, Partner",
  firm: "Example Firm LLP",
  docs: DOCS,
  playbook: findPlaybook("credit-agreement-borrower"),
  priorityNote: "",
};

const RULE_FRAGMENTS = [
  "1. Every quotation must appear verbatim in the cited document.",
  "2. Every figure must be cited by reference",
  "3. Every finding must cite at least one document id and paragraph anchor",
  "4. Section references must exist in S1 after your proposals are applied.",
  "5. Where an instruction reserves a point, propose no language for it.",
  "6. Output must validate against the JSON schema for this stage.",
] as const;

describe("buildPreamble", () => {
  it("renders the identity, matter, documents, priority, rules and language blocks in order", () => {
    const text = buildPreamble(INPUT);
    const headings = [
      "You are the drafting and review engine inside Agentforge Legal",
      "MATTER",
      "DOCUMENTS (cite by id; you receive full text only for what a stage gives you)",
      "SOURCE PRIORITY when documents conflict: S2, S3 > S4 > PB > S1 > context.",
      "RULES ENFORCED BY CODE AFTER YOU ANSWER",
      "LANGUAGE",
    ];
    const positions = headings.map((heading) => text.indexOf(heading));
    expect(
      positions.every((position) => position >= 0),
      text,
    ).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("states the six code-enforced rules in order and the language block", () => {
    const text = buildPreamble(INPUT);
    const positions = RULE_FRAGMENTS.map((fragment) => text.indexOf(fragment));
    expect(
      positions.every((position) => position >= 0),
      text,
    ).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(text).toContain("Formal legal register. Refer to parties by their defined terms.");
    expect(text).toContain("draft work product for review by a qualified lawyer");
  });

  it("lists every document id with role, name and counters, plus the playbook line", () => {
    const text = buildPreamble(INPUT);
    for (const doc of DOCS) {
      expect(text).toContain(doc.id);
      expect(text).toContain(doc.name);
    }
    expect(text).toContain("214 ¶, 38 defined terms");
    expect(text).toContain("context (skipped)");
    expect(text).toContain("image-only content, no text");
    expect(text).toMatch(/PB\s+playbook\s+Credit agreement/);
    expect(text).toMatch(/\d+ required provisions, \d+ fallbacks/);
    expect(text).toContain('Client: Meridian Industrial Holdings (the "Borrower"). Counterparty: the Lenders.');
    expect(text).toContain("issues memorandum (docx), redline (docx), deviation report (xlsx)");
    expect(text).toContain("Author of record for the deliverables: Samuel Roth, Senior Associate.");
    expect(text).toContain("Addressee: Priya Chakravarti, Partner.");
  });

  it("never includes document text beyond names and is byte-identical across calls", () => {
    const first = buildPreamble(INPUT);
    const second = buildPreamble({ ...INPUT, docs: [...INPUT.docs] });
    expect(first).toBe(second);
    expect(first).not.toContain("PREVIEW-TEXT-MUST-NOT-LEAK");
    expect(first).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  });

  it("omits the playbook line and PB priority when no playbook is set, and appends the priority note", () => {
    const text = buildPreamble({
      ...INPUT,
      playbook: null,
      priorityNote: "The commitment letter prevails over the term sheet.",
    });
    expect(text).not.toMatch(/^\s+PB\s/m);
    expect(text).toContain("SOURCE PRIORITY when documents conflict: S2, S3 > S4 > S1 > context.");
    expect(text).toContain("The commitment letter prevails over the term sheet.");
  });
});

describe("buildStageCard", () => {
  const playbook = findPlaybook("generic-contract");
  const item = playbook?.items[0];
  if (!item) {
    throw new Error("fixture playbook missing");
  }
  const variants: readonly { input: StageCardInput; stage: number; fields: readonly string[] }[] = [
    { input: { stage: "classify", fileCount: 5 }, stage: 2, fields: ["docs", "id", "role", "reason"] },
    {
      input: { stage: "review", clauseId: "§7.2(b)", unmarkedChanges: 14, checklistItems: [item] },
      stage: 4,
      fields: [
        "kind",
        "clause",
        "quote",
        "title",
        "why",
        "severity",
        "negotiability",
        "proposedText",
        "basis",
        "checklist",
      ],
    },
    { input: { stage: "missing", item }, stage: 4, fields: ["itemId", "absent", "foundIn", "reason"] },
    {
      input: { stage: "interaction", findingTitle: "Uncapped indemnity", clauseId: "§9.1" },
      stage: 4,
      fields: ["compounds", "clause", "why", "severity", "quote"],
    },
    {
      input: { stage: "draft", deliverable: "issues-memo", manual: "MANUAL-BODY" },
      stage: 5,
      fields: [
        "to",
        "from",
        "date",
        "re",
        "privileged",
        "sections",
        "heading",
        "paragraphs",
        "findingsTable",
        "MANUAL-BODY",
      ],
    },
    { input: { stage: "draft", deliverable: "redline", manual: "MANUAL-BODY" }, stage: 5, fields: ["sections"] },
    {
      input: { stage: "verify-checklist", deliverable: "issues-memo", itemCount: 10 },
      stage: 6,
      fields: ["verdicts", "itemId", "pass", "reason"],
    },
    {
      input: { stage: "verify-opposing", deliverable: "redline" },
      stage: 6,
      fields: ["concessions", "clause", "detail", "disposition"],
    },
    {
      input: { stage: "edit", target: "F3", failure: "quotes-verbatim: quote not found in S1" },
      stage: 7,
      fields: ["section", "quote", "proposedText", "why"],
    },
  ];

  it.each(variants)(
    "renders the $input.stage card with its stage number and return shape",
    ({ input, stage, fields }) => {
      const text = buildStageCard(input);
      expect(text).toContain(`STAGE ${stage} of 9`);
      expect(text).toContain("Before this:");
      expect(text).toContain("Your output feeds:");
      expect(text).toContain("Do not:");
      expect(text).toContain("Return:");
      for (const field of fields) {
        expect(text, `${input.stage} card lacks ${field}`).toContain(field);
      }
    },
  );

  it("names the clause, checklist items and unmarked-change count on the review card", () => {
    const text = buildStageCard({ stage: "review", clauseId: "§7.2(b)", unmarkedChanges: 14, checklistItems: [item] });
    expect(text).toContain("§7.2(b)");
    expect(text).toContain("14 unmarked changes");
    expect(text).toContain(item.id);
    expect(text).toContain(item.title);
  });

  it("is deterministic", () => {
    const input: StageCardInput = { stage: "missing", item };
    expect(buildStageCard(input)).toBe(buildStageCard(input));
  });
});

describe("DELIVERABLE_MANUALS", () => {
  it("has a formal manual for every deliverable kind", () => {
    for (const kind of DELIVERABLE_KINDS) {
      const manual = DELIVERABLE_MANUALS[kind];
      expect(manual.trim().length, kind).toBeGreaterThan(200);
      for (const word of INFORMAL_WORDS) {
        expect(manual.toLowerCase(), `${kind} manual uses "${word}"`).not.toContain(word);
      }
      expect(manual).not.toContain("!");
    }
  });

  it("describes the memorandum header and its six sections", () => {
    const memo = DELIVERABLE_MANUALS["issues-memo"];
    for (const token of ["To", "From", "Date", "Re"]) {
      expect(memo).toContain(`${token}:`);
    }
    const sections = [
      "Summary",
      "Adverse provisions",
      "Missing provisions",
      "Unmarked changes",
      "Recommendations",
      "Reserved points",
    ];
    const positions = sections.map((section) => memo.indexOf(section));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(memo).toContain("Draft work product prepared with automated assistance for review by a qualified lawyer.");
  });

  it("describes redline conventions, deviation report columns and red-flags structure", () => {
    expect(DELIVERABLE_MANUALS.redline).toContain("tracked change");
    const columns = [
      "Clause",
      "Kind",
      "Title",
      "Provision",
      "Why adverse",
      "Severity",
      "Negotiability",
      "Proposed language",
      "Basis",
      "Reserved for",
    ];
    for (const column of columns) {
      expect(DELIVERABLE_MANUALS["deviation-report"]).toContain(column);
    }
    expect(DELIVERABLE_MANUALS["red-flags"]).toContain("Requires partner decision");
  });
});
