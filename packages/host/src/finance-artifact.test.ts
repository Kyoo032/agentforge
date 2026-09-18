import { describe, expect, it, vi } from "vitest";
import type { FinanceBrief } from "@agentforge/core/artifacts";
import {
  FINANCE_META_MAX_BYTES,
  financeArtifactMeta,
  financeTaskFromMeta,
  readStoredFinanceBrief,
} from "./finance-artifact";

const brief: FinanceBrief = {
  title: "Margins held while cash thinned",
  sections: [{ heading: "Revenue grew", body: "Revenue reached 1200 in 2026.", tables: [], metrics: ["revenue 2026"] }],
  assumptions: ["Figures are unaudited."],
  computed: {
    metrics: [
      { key: "revenue 2026", label: "Revenue 2026", value: 1200, unit: "IDR", period: "2026", formula: "sum(revenue)" },
    ],
    tables: [{ name: "Line items", columns: ["Label", "Amount"], rows: [["Sales", 1200]] }],
  },
};

const guard = { flagged: [{ section: 0, text: "1500" }], total: 1 };

/** What sqlite hands back: the meta column is JSON text, parsed on read. */
function roundTrip(meta: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(meta));
}

describe("financeArtifactMeta", () => {
  it("keeps the provenance and adds the structured brief beside it", () => {
    const meta = financeArtifactMeta({ question: "How did Q3 go?", model: "gpt", task: "brief" }, brief, guard);
    expect(meta).toMatchObject({ question: "How did Q3 go?", model: "gpt", task: "brief" });
    expect(meta.brief).toEqual(brief);
    expect(meta.guard).toEqual(guard);
  });

  it("does not mutate the provenance it was given", () => {
    const provenance = { question: "How did Q3 go?" };
    financeArtifactMeta(provenance, brief, guard);
    expect(provenance).toEqual({ question: "How did Q3 go?" });
  });

  it("drops the payload, and says so, when the brief is over the cap", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const huge: FinanceBrief = {
      ...brief,
      sections: [{ ...brief.sections[0], body: "x".repeat(FINANCE_META_MAX_BYTES + 1) } as FinanceBrief["sections"][0]],
    };
    const meta = financeArtifactMeta({ question: "How did Q3 go?" }, huge, guard);
    expect(meta).toEqual({ question: "How did Q3 go?" });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("readStoredFinanceBrief", () => {
  it("reads back what was stored, through the JSON the column holds", () => {
    const stored = readStoredFinanceBrief(roundTrip(financeArtifactMeta({ task: "brief" }, brief, guard)));
    expect(stored?.brief).toEqual(brief);
    expect(stored?.guard).toEqual(guard);
    expect(stored?.task).toBe("brief");
  });

  it("answers null for an artifact saved with markdown only", () => {
    expect(readStoredFinanceBrief({ question: "How did Q3 go?" })).toBeNull();
    expect(readStoredFinanceBrief(undefined)).toBeNull();
  });

  it("answers null for a brief that no longer parses, instead of exporting half of one", () => {
    expect(readStoredFinanceBrief({ brief: { title: "No sections", sections: [] } })).toBeNull();
    expect(readStoredFinanceBrief({ brief: "not an object" })).toBeNull();
  });

  it("keeps the brief when the guard summary is missing or malformed", () => {
    expect(readStoredFinanceBrief({ brief })?.guard).toBeUndefined();
    expect(readStoredFinanceBrief({ brief, guard: { total: "many" } })?.brief).toEqual(brief);
  });
});

describe("financeTaskFromMeta", () => {
  it("reads the stamped task and ignores anything that is not one", () => {
    expect(financeTaskFromMeta({ task: "cashflow" })).toBe("cashflow");
    expect(financeTaskFromMeta({ task: "  brief  " })).toBe("brief");
    expect(financeTaskFromMeta({ task: "   " })).toBeUndefined();
    expect(financeTaskFromMeta({ task: 7 })).toBeUndefined();
    expect(financeTaskFromMeta(undefined)).toBeUndefined();
  });
});
