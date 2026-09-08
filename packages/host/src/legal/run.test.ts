import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { readDocx } from "@agentforge/core/docx";
import type { JobEvent } from "@agentforge/core/jobs";
import type { MatterDocCard, Playbook } from "@agentforge/core/legal";
import { DOCX_MIME } from "./store-files";
import { runLegalMatter, type LegalRunDeps, type LegalRunInput } from "./run";
import type { LegalMatterRecord } from "./records";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../core/src/docx/fixtures");
const ACA_BYTES = new Uint8Array(readFileSync(join(FIXTURES, "lender-initial-aca-draft.docx")));

const AUTHOR = "Samuel Roth";
const ADDRESSEE = "Priya Chakravarti";
const TITLE = "Project Aurora ACA";
const BAD_QUOTE = "this quote is not in the document at all";

const PLAYBOOK: Playbook = {
  id: "test-playbook",
  title: "Test playbook",
  contractType: "Test",
  items: [
    {
      id: "T-MFN",
      title: "Most favoured nation",
      keywords: ["most favoured nation", "most favored nation", "mfn clause"],
      preferred: "The Client shall have the benefit of any more favourable term granted to another customer.",
      fallback: "",
      walkAway: "",
      required: true,
    },
  ],
};

function card(partial: Partial<MatterDocCard> & Pick<MatterDocCard, "id" | "name" | "role">): MatterDocCard {
  return {
    path: partial.name,
    mime: DOCX_MIME,
    bytes: ACA_BYTES.byteLength,
    sha256: "0".repeat(64),
    status: "read",
    paragraphs: 10,
    words: 100,
    insertions: 0,
    deletions: 0,
    definedTerms: 0,
    preview: "Account Control Agreement",
    ...partial,
  };
}

function matter(overrides: Partial<LegalMatterRecord> = {}): LegalMatterRecord {
  return {
    id: "matter-1",
    workspaceId: "ws-1",
    title: TITLE,
    createdAt: 0,
    updatedAt: 0,
    side: { role: "borrower", party: "Aurora Holdings", counterparty: "the Lenders" },
    workType: "review",
    deliverables: ["issues-memo", "redline", "deviation-report", "red-flags"],
    instructions: "Reserve §1.01; do not propose language for that clause.",
    playbookId: PLAYBOOK.id,
    author: AUTHOR,
    addressee: ADDRESSEE,
    firm: "Test LLP",
    docs: [card({ id: "S1", name: "lender-initial-aca-draft.docx", role: "counterparty-draft" })],
    priorMatterId: null,
    lastRunId: null,
    ...overrides,
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function cannedAsk(options: { failChecklist?: boolean } = {}): LegalRunDeps["ask"] {
  return async ({ prompt }) => {
    if (prompt.includes("CLASSIFY")) {
      return json({ docs: [] });
    }
    if (prompt.includes("REVIEW, clause §1.01 of the")) {
      return json({
        kind: "adverse",
        clause: "§1.01",
        quote: BAD_QUOTE,
        title: "Defined terms are one-sided",
        why: "The draft defines terms adversely to the Borrower.",
        severity: "medium",
        negotiability: "fallback",
        proposedText: "Defined terms shall apply equally to both parties.",
        basis: [{ doc: "S1", ref: "¶0" }],
        reservedFor: null,
        checklist: [],
      });
    }
    if (prompt.includes("REVIEW, clause")) {
      return json({ kind: "ok" });
    }
    if (prompt.includes("REVIEW (missing")) {
      return json({ itemId: "T-MFN", absent: true, foundIn: null, reason: "Not present in the draft." });
    }
    if (prompt.includes("REVIEW (interactions")) {
      return json({ compounds: false, clause: "", why: "", severity: "medium", quote: "" });
    }
    if (prompt.includes("DRAFT, issues memorandum") || prompt.includes("DRAFT, executive summary")) {
      return json({
        to: ADDRESSEE,
        from: AUTHOR,
        date: "2026-09-08",
        re: TITLE,
        privileged: true,
        sections: [
          {
            heading: "Summary",
            paragraphs: ["Aurora Holdings reviewed the counterparty draft against the Lenders."],
            findingsTable: [],
          },
        ],
      });
    }
    if (prompt.includes("VERIFY (checklist")) {
      return json({
        verdicts: [
          {
            itemId: "T-MFN",
            pass: options.failChecklist !== true,
            reason: options.failChecklist ? "Not closed." : "Covered.",
          },
        ],
      });
    }
    if (prompt.includes("VERIFY (opposing")) {
      return json({ concessions: [] });
    }
    if (prompt.includes("EDIT,")) {
      return json({ proposedText: null, why: "Left open." });
    }
    return json({ kind: "ok" });
  };
}

async function setup(): Promise<{ input: LegalRunInput }> {
  const doc = await readDocx(ACA_BYTES);
  const record = matter();
  return {
    input: {
      matter: record,
      docs: new Map([["S1", doc]]),
      bytes: new Map([["S1", ACA_BYTES]]),
      playbook: PLAYBOOK,
      models: { drafting: "draft-model", verifier: "verify-model" },
      maxRounds: 1,
      runId: "run-1",
      now: () => new Date("2026-09-08T12:00:00Z"),
    },
  };
}

function phasesOf(events: JobEvent[]): string[] {
  return events
    .filter((event): event is Extract<JobEvent, { type: "job.phase" }> => event.type === "job.phase")
    .map((event) => event.phase);
}

describe("runLegalMatter", () => {
  it("emits phases in order, skipping diff when there is no prior turn", async () => {
    const { input } = await setup();
    const events: JobEvent[] = [];
    const result = await runLegalMatter(input, {
      ask: cannedAsk(),
      emit: (event) => events.push(event),
      concurrency: 3,
    });
    expect(phasesOf(events)).toEqual([
      "classify",
      "diff",
      "review",
      "missing",
      "interactions",
      "draft",
      "verify",
      "package",
    ]);
    expect(
      events.some(
        (event) => event.type === "job.step" && event.phase === "diff" && event.label.includes("No prior turn"),
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "job.round" && event.round === 1 && event.total === 1)).toBe(true);
    expect(result.deliverables.map((item) => item.kind)).toEqual(input.matter.deliverables);
    expect(result.manifest.harness).toBe("agentforge-legal/1");
    expect(result.rounds).toHaveLength(1);
  });

  it("drops a non-verbatim quote and strips proposedText from a reserved clause", async () => {
    const { input } = await setup();
    const result = await runLegalMatter(input, { ask: cannedAsk(), emit: () => {}, concurrency: 3 });
    expect(result.findings.some((finding) => finding.quote.includes(BAD_QUOTE))).toBe(false);
    const reserved = result.findings.find((finding) => finding.clause === "§1.01");
    expect(reserved).toBeDefined();
    expect(reserved?.quote).toBe("");
    expect(reserved?.proposedText).toBeNull();
    expect(reserved?.reservedFor).toBe(AUTHOR);
  });

  it("stops the verify/edit loop at maxRounds", async () => {
    const { input } = await setup();
    const events: JobEvent[] = [];
    const result = await runLegalMatter(
      { ...input, maxRounds: 2 },
      { ask: cannedAsk({ failChecklist: true }), emit: (event) => events.push(event), concurrency: 3 },
    );
    const rounds = events.filter(
      (event): event is Extract<JobEvent, { type: "job.round" }> => event.type === "job.round",
    );
    expect(rounds.map((event) => event.round)).toEqual([1, 2]);
    expect(rounds.every((event) => event.total === 2)).toBe(true);
    expect(phasesOf(events)).toEqual([
      "classify",
      "diff",
      "review",
      "missing",
      "interactions",
      "draft",
      "verify",
      "edit",
      "draft",
      "verify",
      "package",
    ]);
    expect(result.rounds).toHaveLength(2);
    expect(result.verify.round).toBe(2);
    expect(result.manifest.status).toBe("complete-with-failures");
  });

  it("throws aborted when the job signal is aborted", async () => {
    const { input } = await setup();
    const signal = AbortSignal.abort();
    await expect(
      runLegalMatter(input, { ask: cannedAsk(), emit: () => {}, abortSignal: signal }),
    ).rejects.toMatchObject({
      code: "aborted",
      status: 499,
    });
    await expect(
      runLegalMatter(input, { ask: cannedAsk(), emit: () => {}, abortSignal: signal }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
