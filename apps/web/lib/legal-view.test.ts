import type { Finding, MatterDocCard, VerifyReport } from "@agentforge/core/legal";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEGAL_DRAFT,
  canRun,
  canUpload,
  draftFromMatter,
  groupFindingsByTab,
  legalValidationKey,
  matterMapRows,
  nextDocRole,
  parseStreamedFinding,
  partiesReady,
  partnerDecisionCount,
  rankLabel,
  resultHeadline,
  severityLabel,
  streamedFindings,
  verifyRows,
  whatWillHappen,
} from "./legal-view";

function card(overrides: Partial<MatterDocCard>): MatterDocCard {
  return {
    id: "S1",
    name: "a.docx",
    path: "a.docx",
    mime: "",
    bytes: 1,
    sha256: "",
    role: "context",
    status: "read",
    paragraphs: 10,
    words: 200,
    insertions: 0,
    deletions: 0,
    definedTerms: 0,
    preview: "",
    ...overrides,
  };
}

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: "F1",
    clause: "§1",
    kind: "adverse",
    quote: "",
    quoteAnchor: null,
    title: "t",
    why: "w",
    severity: "low",
    negotiability: "preferred",
    proposedText: null,
    basis: [],
    reservedFor: null,
    checklist: [],
    round: 1,
    ...overrides,
  };
}

const VERIFY: VerifyReport = {
  round: 2,
  codeChecks: [
    { code: "quotes-verbatim", passed: 23, failed: 0, failures: [] },
    { code: "xrefs-resolve", passed: 87, failed: 1, failures: [] },
    { code: "docx-valid", passed: 0, failed: 0, failures: [] },
  ],
  checklist: [
    { itemId: "c1", deliverable: "issues-memo", pass: true, reason: "" },
    { itemId: "c2", deliverable: "issues-memo", pass: false, reason: "" },
  ],
  concessions: [{ clause: "§8.5", detail: "monthly accounts", disposition: "market" }],
  documentsSkipped: [{ doc: "S9", reason: "images" }],
  openForHuman: [{ clause: "§13.7", detail: "MFN" }],
  ok: false,
};

function withSide(party: string, counterparty: string) {
  return { ...DEFAULT_LEGAL_DRAFT, side: { ...DEFAULT_LEGAL_DRAFT.side, party, counterparty } };
}

describe("canRun", () => {
  it("needs a file, both names and no upload in flight", () => {
    const draft = withSide("Meridian", "the Lenders");
    expect(canRun(draft, 1, false)).toBe(true);
    expect(canRun(draft, 0, false)).toBe(false);
    expect(canRun(draft, 1, true)).toBe(false);
    expect(canRun(DEFAULT_LEGAL_DRAFT, 1, false)).toBe(false);
  });

  it("refuses a run the host would refuse: the counterparty is required too (0.15.0 finding 2)", () => {
    expect(canRun(withSide("Meridian", ""), 1, false)).toBe(false);
    expect(canRun(withSide("", "the Lenders"), 1, false)).toBe(false);
    expect(canRun(withSide("Meridian", "   "), 1, false)).toBe(false);
  });
});

describe("partiesReady / canUpload", () => {
  it("asks for both names before the first upload creates the matter", () => {
    expect(canUpload(DEFAULT_LEGAL_DRAFT)).toBe(false);
    expect(canUpload(withSide("Meridian", ""))).toBe(false);
    expect(canUpload(withSide("", "the Lenders"))).toBe(false);
    expect(canUpload(withSide(" ", " "))).toBe(false);
    expect(canUpload(withSide("Meridian", "the Lenders"))).toBe(true);
    expect(partiesReady(withSide("Meridian", "the Lenders"))).toBe(true);
  });
});

describe("legalValidationKey", () => {
  it("maps the host's side refusals to catalog copy instead of the raw field path", () => {
    expect(legalValidationKey("invalid_request", "side.party is required")).toBe("legal.errors.partyRequired");
    expect(legalValidationKey("invalid_request", "side.counterparty is required")).toBe(
      "legal.errors.counterpartyRequired",
    );
    expect(legalValidationKey("invalid_request", "side.role is required")).toBe("legal.errors.positionRequired");
    expect(legalValidationKey("invalid_request", "side.party must be 200 characters or fewer")).toBe(
      "legal.errors.nameTooLong",
    );
  });

  it("maps the other matter fields the host validates", () => {
    expect(legalValidationKey("invalid_request", "title must be 200 characters or fewer")).toBe(
      "legal.errors.titleInvalid",
    );
    expect(legalValidationKey("invalid_request", "deliverables must list at least one deliverable")).toBe(
      "legal.errors.deliverablesRequired",
    );
    expect(legalValidationKey("invalid_request", "instructions must be 20,000 characters or fewer")).toBe(
      "legal.errors.instructionsTooLong",
    );
  });

  it("falls back to generic copy for any other field in the validator's shape", () => {
    expect(legalValidationKey("invalid_request", "workType is invalid")).toBe("legal.errors.invalidField");
    expect(legalValidationKey("invalid_request", "roles.0.id is not a document id")).toBe("legal.errors.invalidField");
    expect(legalValidationKey("invalid_request", "body nothing to update")).toBe("legal.errors.invalidField");
  });

  it("leaves sentences and other codes alone", () => {
    expect(legalValidationKey("invalid_request", 'Unknown playbook "x"')).toBeNull();
    expect(legalValidationKey("invalid_request", "Upload at least one .docx before running")).toBeNull();
    expect(legalValidationKey("unsupported_content_type", "side.party is required")).toBeNull();
    expect(legalValidationKey(undefined, "side.party is required")).toBeNull();
  });
});

describe("draftFromMatter", () => {
  it("copies the form fields without sharing references", () => {
    const source = { ...DEFAULT_LEGAL_DRAFT, title: "M", docs: [] };
    const draft = draftFromMatter(source);
    expect(draft).toEqual({ ...DEFAULT_LEGAL_DRAFT, title: "M" });
    expect(draft.side).not.toBe(source.side);
    expect(draft.deliverables).not.toBe(source.deliverables);
  });
});

describe("roles", () => {
  it("cycles through every role and wraps", () => {
    expect(nextDocRole("counterparty-draft")).toBe("our-draft");
    expect(nextDocRole("context")).toBe("counterparty-draft");
  });

  it("ranks by DOC_ROLE_PRIORITY", () => {
    expect(rankLabel("executed")).toBe("1st");
    expect(rankLabel("instruction")).toBe("2nd");
    expect(rankLabel("playbook")).toBe("3rd");
    expect(rankLabel("prior-turn")).toBe("5th");
    expect(rankLabel("context")).toBe("last");
    expect(rankLabel("counterparty-draft")).toBe("—");
  });
});

describe("matterMapRows", () => {
  it("groups by role in priority order with counters as notes", () => {
    const rows = matterMapRows([
      card({ id: "S1", name: "draft.docx", role: "counterparty-draft", insertions: 14, deletions: 2 }),
      card({ id: "S2", name: "ts.docx", role: "executed" }),
      card({ id: "S3", name: "cl.docx", role: "executed" }),
      card({ id: "S4", name: "old.docx", role: "prior-turn", status: "skipped", skipReason: "no text" }),
    ]);
    expect(rows.map((row) => row.role)).toEqual(["executed", "counterparty-draft", "prior-turn"]);
    expect(rows[0]).toMatchObject({ documents: "ts.docx · cl.docx", rank: "1st", notes: "2 documents" });
    expect(rows[1]?.notes).toBe("10 paragraphs · 200 words · 14 insertions · 2 deletions");
    expect(rows[2]?.notes).toBe("Skipped · no text");
  });

  it("caps the names shown per role", () => {
    const rows = matterMapRows([
      card({ id: "S1", name: "a" }),
      card({ id: "S2", name: "b" }),
      card({ id: "S3", name: "c" }),
    ]);
    expect(rows[0]?.documents).toBe("a · b + 1 more");
  });
});

describe("whatWillHappen", () => {
  it("names the side, the playbook and the round cap", () => {
    const lines = whatWillHappen(
      { ...DEFAULT_LEGAL_DRAFT, side: { ...DEFAULT_LEGAL_DRAFT.side, role: "lender" } },
      3,
      "Generic",
    );
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain("3 files");
    expect(lines[1]).toContain("the playbook Generic");
    expect(lines[1]).toContain("the lender");
    expect(lines[4]).toContain("Up to 3 rounds");
  });
});

describe("findings", () => {
  const findings = [
    finding({ id: "F1", kind: "adverse", severity: "medium" }),
    finding({ id: "F2", kind: "deviation", severity: "high" }),
    finding({ id: "F3", kind: "missing" }),
    finding({ id: "F4", kind: "unmarked-change" }),
    finding({ id: "F5", kind: "ok" }),
    finding({ id: "F6", kind: "interaction", clause: "§13.7", reservedFor: "partner" }),
  ];

  it("groups by tab, sorted by severity, dropping ok findings", () => {
    const groups = groupFindingsByTab(findings);
    expect(groups.adverse.map((f) => f.id)).toEqual(["F2", "F1", "F6"]);
    expect(groups.missing.map((f) => f.id)).toEqual(["F3"]);
    expect(groups.unmarked.map((f) => f.id)).toEqual(["F4"]);
  });

  it("counts partner decisions without double counting a reserved clause", () => {
    expect(partnerDecisionCount(findings, VERIFY)).toBe(1);
    expect(partnerDecisionCount(findings, { ...VERIFY, openForHuman: [{ clause: "§2", detail: "" }] })).toBe(2);
    expect(partnerDecisionCount(findings, null)).toBe(1);
  });

  it("writes the headline in formal register", () => {
    expect(resultHeadline(findings, VERIFY)).toBe(
      "Review complete · 3 adverse provisions, 1 missing provision, 1 item for partner decision",
    );
  });

  it("labels reserved findings as Open", () => {
    expect(severityLabel(findings[5])).toBe("Open");
    expect(severityLabel(findings[1])).toBe("High");
  });
});

describe("streamed findings", () => {
  it("parses a JSON detail and ignores plain text", () => {
    expect(parseStreamedFinding("22/22 clauses")).toBeNull();
    expect(parseStreamedFinding("{not json")).toBeNull();
    expect(parseStreamedFinding('{"clause":"§1"}')).toBeNull();
    expect(
      parseStreamedFinding(
        JSON.stringify({ clause: "§7.2", title: "Uncapped", severity: "high", basis: [{ doc: "S2", ref: "§11" }] }),
      ),
    ).toEqual({ clause: "§7.2", title: "Uncapped", severity: "high", basis: "S2 §11", reservedFor: null });
  });

  it("collects findings only from the review, missing and interactions phases", () => {
    const detail = JSON.stringify({ clause: "§1", title: "T", severity: "low" });
    const rows = streamedFindings([
      { phase: "classify", label: "", status: "done", steps: [{ label: "x", detail }] },
      {
        phase: "review",
        label: "",
        status: "active",
        steps: [
          { label: "x", detail },
          { label: "y", detail: "3/5" },
        ],
      },
      { phase: "missing", label: "", status: "active", steps: [{ label: "x", detail }] },
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe("verifyRows", () => {
  it("renders code checks as pass/total with tones, then the summary rows", () => {
    const rows = verifyRows(VERIFY);
    expect(rows[0]).toMatchObject({
      label: "Quotations verbatim in the cited document",
      value: "23/23",
      tone: "green",
    });
    expect(rows[1]).toMatchObject({ value: "87/88", tone: "amber" });
    expect(rows[2]).toMatchObject({ label: "Redline .docx opens and validates", value: "pass", tone: "green" });
    expect(rows.find((row) => row.key === "checklist")).toMatchObject({ value: "1/2", tone: "amber" });
    expect(rows.find((row) => row.key === "opposing")).toMatchObject({ value: "1 concession left", tone: "amber" });
    expect(rows.find((row) => row.key === "skipped")).toMatchObject({ value: "1" });
    expect(rows.find((row) => row.key === "partner")).toMatchObject({ label: "Requires partner decision", value: "1" });
  });
});
