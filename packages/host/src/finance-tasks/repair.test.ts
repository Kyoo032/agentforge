import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { REMOVED_SENTENCE_FLAG, UNVERIFIED_MARKER, type FinanceReport } from "@agentforge/core/finance";

/**
 * The narrator is a queue, never the gateway: one entry per rewrite the repair is allowed to ask
 * for. `asked` is how the tests below prove it asked once and only once.
 */
const answers: string[] = [];
const asked: Array<Record<string, unknown>> = [];

vi.mock("../job-regen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../job-regen")>();
  return {
    ...actual,
    collectJobAssistantRun: async (options: Record<string, unknown>) => {
      asked.push(options);
      return { text: answers.shift() ?? "", model: "stub-model" };
    },
  };
});

const { hasUnverifiedFigure, repairTaskProse, scrubReportMarkers, withRemovedFlag } = await import("./repair");

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws-finance-task-repair",
  userId: "local",
  role: "owner",
};

const prompt = {
  tenant,
  model: "stub-model",
  systemPrompt: "system",
  factsBlock: "Cash: 900",
  locale: "en" as const,
};

/** Two sections so the tests can prove the ids survive a rewrite that renames the heading. */
function prose(body: string) {
  return {
    title: "Runway to March",
    sections: [
      { id: "position", heading: "Where cash sits", body: "Cash was 900." },
      { id: "flags", heading: "What to watch", body },
    ],
    assumptions: ["Monthly figures."],
  };
}

const ALLOWED = [900, 7.5];

function section(raw: string) {
  return JSON.stringify({ heading: "What to watch", body: raw, metrics: [] });
}

function reset() {
  asked.length = 0;
  answers.length = 0;
}

describe("hasUnverifiedFigure", () => {
  it("is true only when a section body still carries the marker", () => {
    expect(hasUnverifiedFigure(prose("Runway is 7.5 months."))).toBe(false);
    expect(hasUnverifiedFigure(prose(`Runway is ${UNVERIFIED_MARKER} months.`))).toBe(true);
  });
});

describe("repairTaskProse", () => {
  it("leaves clean prose alone and asks the model nothing", async () => {
    reset();
    const result = await repairTaskProse(prose("Runway is 7.5 months."), ALLOWED, prompt);
    expect(asked).toEqual([]);
    expect(result.repaired).toBe(false);
    expect(result.guard).toEqual({ flagged: [], total: 0, removed: 0 });
  });

  it("asks once, quotes the offending sentence, and keeps a rewrite that traces", async () => {
    reset();
    answers.push(section("Runway is 7.5 months."));
    const result = await repairTaskProse(prose(`Runway is ${UNVERIFIED_MARKER} months.`), ALLOWED, prompt);
    expect(asked).toHaveLength(1);
    expect(String(asked[0]?.prompt)).toContain(UNVERIFIED_MARKER);
    expect(String(asked[0]?.prompt)).toContain("Cash: 900");
    expect(result.prose.sections[1]?.body).toBe("Runway is 7.5 months.");
    expect(result.guard.removed).toBe(0);
    expect(result.repaired).toBe(true);
  });

  it("keeps the task's own section ids when the rewrite renames the heading", async () => {
    reset();
    answers.push(JSON.stringify({ heading: "Renamed", body: "Runway is 7.5 months.", metrics: [] }));
    const result = await repairTaskProse(prose(`Runway is ${UNVERIFIED_MARKER} months.`), ALLOWED, prompt);
    expect(result.prose.sections.map((one) => one.id)).toEqual(["position", "flags"]);
    expect(result.prose.sections[1]?.heading).toBe("Renamed");
    expect(result.prose.sections[0]?.body).toBe("Cash was 900.");
  });

  it("removes the sentence cleanly when the rewrite invents again, and counts it", async () => {
    reset();
    answers.push(section("Runway is 7.5 months. Churn was 4.5%."));
    const result = await repairTaskProse(prose(`Runway is ${UNVERIFIED_MARKER} months.`), ALLOWED, prompt);
    const body = result.prose.sections[1]?.body ?? "";
    expect(body).toBe("Runway is 7.5 months.");
    expect(body).not.toContain(UNVERIFIED_MARKER);
    expect(result.guard.removed).toBe(1);
    expect(result.guard.flagged).toEqual([{ section: 1, text: "4.5%" }]);
  });

  it("still strips the marker when the rewrite itself fails", async () => {
    reset();
    answers.push("not json at all");
    const result = await repairTaskProse(
      prose(`Runway is ${UNVERIFIED_MARKER} months. Cash was 900.`),
      ALLOWED,
      prompt,
    );
    expect(result.prose.sections[1]?.body).toBe("Cash was 900.");
    expect(result.guard.removed).toBe(1);
  });
});

function report(overrides: Partial<FinanceReport> = {}): FinanceReport {
  return {
    task: "cashflow",
    title: "Runway to March",
    locale: "en",
    summary: [],
    tables: [],
    charts: [],
    flags: [],
    notes: [{ heading: "Position", body: "Cash was 900." }],
    ...overrides,
  };
}

describe("scrubReportMarkers", () => {
  it("leaves a clean report untouched, object and all", () => {
    const clean = report();
    expect(scrubReportMarkers(clean)).toEqual({ report: clean, removed: 0 });
  });

  it("takes a marked sentence out of a note the builder wrote itself", () => {
    const swept = scrubReportMarkers(
      report({ notes: [{ heading: "Position", body: `Cash held steady. Churn was ${UNVERIFIED_MARKER}.` }] }),
    );
    expect(swept.report.notes[0]?.body).toBe("Cash held steady.");
    expect(swept.removed).toBe(1);
    expect(JSON.stringify(swept.report)).not.toContain(UNVERIFIED_MARKER);
  });

  it("takes the sentence before it too when that one ends in a digit", () => {
    // The shared splitter refuses to break "Rp 1.250.000.000" in half, so a full stop between a
    // digit and a capital is not a sentence boundary. The marker still never ships; the note is
    // just shorter than it had to be. Documented here because it is the splitter's, not ours.
    const swept = scrubReportMarkers(
      report({ notes: [{ heading: "Position", body: `Cash was 900. Churn was ${UNVERIFIED_MARKER}.` }] }),
    );
    expect(swept.report.notes[0]?.body).toBe("");
    expect(JSON.stringify(swept.report)).not.toContain(UNVERIFIED_MARKER);
  });

  it("sweeps a chart caption on the same terms and drops one left empty", () => {
    const swept = scrubReportMarkers(
      report({
        charts: [
          {
            id: "cash",
            title: "Cash",
            kind: "line",
            categories: ["Jan"],
            series: [{ name: "Cash", values: [900] }],
            note: `Burn was ${UNVERIFIED_MARKER}.`,
          },
        ],
      }),
    );
    expect(swept.report.charts[0]?.note).toBeUndefined();
    expect(swept.removed).toBe(1);
  });
});

describe("withRemovedFlag", () => {
  it("says a sentence went, in the reader's language, once", () => {
    const flagged = withRemovedFlag(report(), 1, "id");
    expect(flagged.flags).toEqual([{ level: "watch", text: REMOVED_SENTENCE_FLAG.id }]);
    expect(withRemovedFlag(flagged, 1, "id").flags).toHaveLength(1);
  });

  it("adds nothing when nothing was removed", () => {
    expect(withRemovedFlag(report(), 0, "en").flags).toEqual([]);
  });
});
