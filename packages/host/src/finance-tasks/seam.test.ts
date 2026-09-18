import { describe, expect, it } from "vitest";
import { FINANCE_TASKS, type FinanceReport } from "@agentforge/core/finance";
import { FINANCE_TASK_PARSERS, financeTaskParser } from "./parsers";
import { parseBriefInput } from "./parse-brief";
import { financeTaskArtifactMeta, readStoredFinanceReport } from "./persist";
import { FINANCE_REPORT_MAX_BYTES, readPostedFinanceReport } from "./report-schema";
import { runnerPhases } from "./runner";
import { guardNarration, parseNarration, sectionRequest } from "./narrate";

const REPORT: FinanceReport = {
  task: "cashflow",
  title: "Runway to March",
  locale: "en",
  currency: "IDR",
  summary: [{ label: "Runway", value: 7.5, unit: "months", flag: "watch" }],
  tables: [{ id: "inputs", title: "Periods", columns: ["Period", "In"], rows: [["Jan", 200]] }],
  charts: [{ id: "cash", title: "Cash", kind: "line", categories: ["Jan"], series: [{ name: "Cash", values: [900] }] }],
  flags: [{ level: "watch", text: "Runway under 12 months" }],
  notes: [{ heading: "Position", body: "Cash was 900." }],
};

describe("runner phases", () => {
  it("reports under the task's own phase ids, not one shared pipeline's", () => {
    expect(runnerPhases("brief")).toEqual({ compute: "core-metrics", finish: "number-guard-export" });
    expect(runnerPhases("cashflow")).toEqual({ compute: "runway-math", finish: "narrate-guard-export" });
    expect(runnerPhases("appraisal")).toEqual({ compute: "sensitivity-grid", finish: "memo-guard-export" });
    expect(runnerPhases("ratios")).toEqual({ compute: "bands-vs-thresholds", finish: "scorecard-guard-export" });
    expect(runnerPhases("budget")).toEqual({ compute: "flag-over-limit", finish: "guard-export" });
  });
});

describe("finance task parsers", () => {
  it("has a row per task and falls back to the brief's line-item read", () => {
    expect(Object.keys(FINANCE_TASK_PARSERS).sort()).toEqual([...FINANCE_TASKS].sort());
    expect(financeTaskParser("brief")).toBe(parseBriefInput);
    // A task with its own parse hook answers with it; the rest still get the brief's line-item read.
    expect(financeTaskParser("cashflow")).not.toBe(parseBriefInput);
    expect(financeTaskParser("not-a-task")).toBe(parseBriefInput);
  });
});

describe("posted finance report", () => {
  it("accepts a report the studio is showing", () => {
    expect(readPostedFinanceReport(REPORT)).toEqual(REPORT);
  });

  it("refuses a malformed report before a renderer sees it", () => {
    expect(() => readPostedFinanceReport({ ...REPORT, locale: "fr" })).toThrowError(/malformed/);
    expect(() => readPostedFinanceReport({ ...REPORT, charts: [{ ...REPORT.charts[0], kind: "pie" }] })).toThrowError(
      /malformed/,
    );
    expect(() => readPostedFinanceReport(null)).toThrowError(/malformed/);
  });

  it("refuses a report past the size cap with its own status", () => {
    const huge = { ...REPORT, notes: [{ heading: "Big", body: "x".repeat(FINANCE_REPORT_MAX_BYTES + 1) }] };
    try {
      readPostedFinanceReport(huge);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as { status?: number }).status).toBe(413);
    }
  });
});

describe("task artifact meta", () => {
  it("carries the report beside the provenance so an export keeps its tables", () => {
    const meta = financeTaskArtifactMeta({ model: "m", task: "cashflow" }, REPORT, { flagged: [], total: 0 });
    expect(meta.task).toBe("cashflow");
    expect(readStoredFinanceReport(meta)).toEqual(REPORT);
  });

  it("keeps the provenance alone when the report is too big to ride along", () => {
    const huge = { ...REPORT, notes: [{ heading: "Big", body: "x".repeat(300 * 1024) }] };
    const meta = financeTaskArtifactMeta({ model: "m" }, huge, { flagged: [], total: 0 });
    expect(readStoredFinanceReport(meta)).toBeNull();
    expect(meta.model).toBe("m");
  });
});

describe("narration", () => {
  const position = { id: "position", title: { id: "Posisi", en: "Position" } };
  const sections = [position, { id: "flags", title: { id: "Tanda", en: "Flags" } }];

  it("asks for the task's sections in the reader's language", () => {
    expect(sectionRequest(sections, "en")).toContain("- position: Position");
    expect(sectionRequest(sections, "id")).toContain("- flags: Tanda");
    expect(sectionRequest([], "en")).toContain("3 to 6");
  });

  it("keeps only the sections the task asked for, in that order", () => {
    const raw = JSON.stringify({
      title: "Runway",
      sections: [
        { id: "flags", heading: "What to watch", body: "Cash was 900." },
        { id: "invented", heading: "Extra", body: "Made up." },
        { id: "position", heading: "Where cash sits", body: "Cash was 900." },
      ],
      assumptions: ["Monthly figures."],
    });
    const draft = parseNarration(raw, sections, "fallback");
    expect(draft.sections.map((section) => section.id)).toEqual(["position", "flags"]);
  });

  it("strips every figure the task never declared", () => {
    const draft = parseNarration(
      JSON.stringify({ title: "T", sections: [{ id: "position", heading: "H", body: "Cash was 900, burn 1234." }] }),
      [position],
      "fallback",
    );
    const { prose, guard } = guardNarration(draft, [900]);
    expect(prose.sections[0]?.body).toContain("[unverified figure]");
    expect(prose.sections[0]?.body).toContain("900");
    expect(guard.total).toBe(1);
    expect(guard.flagged[0]?.section).toBe(0);
  });

  it("refuses prose that answered with no usable section", () => {
    expect(() => parseNarration("not json", sections, "fallback")).toThrowError(/invalid JSON/);
    expect(() => parseNarration(JSON.stringify({ sections: [] }), sections, "fallback")).toThrowError(/no sections/);
  });
});
