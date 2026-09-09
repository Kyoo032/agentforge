import { describe, expect, it } from "vitest";
import { basisComment, buildRedlinePatches, matchClause } from "./render-redline";
import { CLAUSES, DRAFT, FINDINGS, makeFinding } from "./render-test-support";

describe("basisComment", () => {
  it("joins the title and citations in formal register without doubled full stops", () => {
    expect(basisComment(FINDINGS[0])).toBe("Uncapped cost reimbursement. Basis: S2 ¶41, PB CA-07.");
    expect(basisComment(makeFinding({ title: "Ends with a stop.", basis: [] }))).toBe(
      "Ends with a stop. Basis: no citation recorded.",
    );
  });
});

describe("matchClause", () => {
  it("prefers the exact id, then the most specific related id, else null", () => {
    expect(matchClause("§9.1", CLAUSES)?.id).toBe("§9.1");
    expect(matchClause("§ 9.1", CLAUSES)?.id).toBe("§9.1");
    expect(matchClause("§9", CLAUSES)?.id).toBe("§9.1(a)");
    expect(matchClause("§3.4(c)", CLAUSES)?.id).toBe("§3.4");
    expect(matchClause("§12", CLAUSES)).toBeNull();
    expect(matchClause("", CLAUSES)).toBeNull();
  });
});

describe("buildRedlinePatches", () => {
  it("yields one patch per actionable provision finding and one insert per missing finding", () => {
    const { patches, inserts } = buildRedlinePatches(FINDINGS, DRAFT, CLAUSES);
    expect(patches).toEqual([
      {
        anchor: "¶2",
        find: "the Borrower shall pay all costs of the Lenders",
        replace: "the Borrower shall pay the reasonable and documented costs of the Lenders, subject to the Fee Cap",
        comment: "Uncapped cost reimbursement. Basis: S2 ¶41, PB CA-07.",
      },
      {
        anchor: "¶3",
        find: "within five (5) Business Days",
        replace: "within ten (10) Business Days",
        comment: "Notice period shortened without marking. Basis: S3 ¶12.",
      },
    ]);
    expect(inserts).toEqual([
      {
        after: "¶3",
        text: "The Borrower shall have thirty (30) days to cure any breach of Section 9.1.",
        comment: "No cure period for covenant breach. Basis: PB CA-12.",
      },
    ]);
  });

  it("produces nothing for reserved findings or findings without proposed text", () => {
    const reserved = makeFinding({
      id: "R1",
      quote: "Change of Control",
      quoteAnchor: "¶4",
      proposedText: "x",
      reservedFor: "J. Partner",
    });
    const noProposal = makeFinding({ id: "R2", quote: "Change of Control", quoteAnchor: "¶4", proposedText: null });
    const missingReserved = makeFinding({ id: "R3", kind: "missing", proposedText: "x", reservedFor: "J. Partner" });
    const result = buildRedlinePatches([reserved, noProposal, missingReserved], DRAFT, CLAUSES);
    expect(result).toEqual({ patches: [], inserts: [] });
  });

  it("skips provision findings with no quote or an unlocatable quote", () => {
    const empty = makeFinding({ id: "E1", quote: "   ", proposedText: "x" });
    const absent = makeFinding({ id: "E2", quote: "not in the draft at all", proposedText: "x" });
    expect(buildRedlinePatches([empty, absent], DRAFT, CLAUSES)).toEqual({ patches: [], inserts: [] });
  });

  it("inserts a missing provision after the last body paragraph when no clause matches", () => {
    const orphan = makeFinding({ id: "M1", kind: "missing", clause: "§14.3", proposedText: "New Section 14.3." });
    const { inserts } = buildRedlinePatches([orphan], DRAFT, CLAUSES);
    expect(inserts).toEqual([
      { after: "¶5", text: "New Section 14.3.", comment: "Untitled. Basis: no citation recorded." },
    ]);
    expect(buildRedlinePatches([orphan], { ...DRAFT, paragraphs: [] }, [])).toEqual({ patches: [], inserts: [] });
  });

  it("does not mutate its inputs", () => {
    const snapshot = JSON.stringify([FINDINGS, DRAFT, CLAUSES]);
    buildRedlinePatches(FINDINGS, DRAFT, CLAUSES);
    expect(JSON.stringify([FINDINGS, DRAFT, CLAUSES])).toBe(snapshot);
  });
});
