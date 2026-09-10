import { describe, expect, it } from "vitest";
import { artifactFilename, artifactSlug, isArtifactKind, isArtifactMode } from "./artifact-meta";
import { dataAnalysisSchema, dataAnalysisToMarkdown } from "./data-analysis";
import { DOSSIER_HEADINGS, citedSourceIds, dossierSchema, dossierToMarkdown } from "./dossier";
import { financeBriefSchema, financeBriefToMarkdown, formatMetricValue } from "./finance-brief";
import { escapeMarkdownCell, formatCellNumber, markdownTable } from "./markdown-table";
import { researchNotesSchema, researchNotesToMarkdown } from "./research-notes";

describe("markdownTable", () => {
  it("escapes pipes and newlines and pads short rows", () => {
    const out = markdownTable(["a", "b"], [["x|y", "line\nbreak"], ["only"]]);
    expect(out.split("\n")).toEqual(["| a | b |", "| --- | --- |", "| x\\|y | line break |", "| only |  |"]);
  });

  it("formats numbers without trailing noise", () => {
    expect(formatCellNumber(12)).toBe("12");
    expect(formatCellNumber(0.123456)).toBe("0.1235");
    expect(formatCellNumber(2.5)).toBe("2.5");
    expect(escapeMarkdownCell(null)).toBe("");
    expect(escapeMarkdownCell(true)).toBe("true");
  });
});

describe("artifact meta", () => {
  it("builds safe filenames", () => {
    expect(artifactSlug("  Vendor concentration: Q3 / 2026!  ")).toBe("vendor-concentration-q3-2026");
    expect(artifactFilename("", "text/markdown", "dossier")).toBe("dossier.md");
    expect(artifactFilename("Cash plan", "application/json")).toBe("cash-plan.json");
  });

  it("guards modes and kinds", () => {
    expect(isArtifactMode("research")).toBe(true);
    expect(isArtifactMode("student")).toBe(false);
    expect(isArtifactMode("legal")).toBe(true);
    expect(isArtifactKind("redline")).toBe(true);
    expect(isArtifactKind("dossier")).toBe(true);
    expect(isArtifactKind("")).toBe(false);
  });
});

describe("researchNotesToMarkdown", () => {
  it("renders headings and sources", () => {
    const notes = researchNotesSchema.parse({
      title: "T",
      summary: "S",
      notes: [
        {
          heading: "H",
          body: "B",
          sources: [
            { title: "Doc", url: "https://x.test" },
            { title: "", url: "" },
          ],
        },
      ],
    });
    const md = researchNotesToMarkdown(notes);
    expect(md).toContain("# T\n\nS\n\n## H\n\nB\n\nSources:\n- Doc (https://x.test)");
    expect(md.endsWith("\n")).toBe(true);
  });
});

describe("dossierToMarkdown", () => {
  const dossier = dossierSchema.parse({
    title: "Battery recycling economics",
    question: "Is lithium recycling profitable in 2026?",
    created: "2026-09-07T00:00:00Z",
    models: ["m1"],
    queries: ["lithium recycling margin 2026"],
    sources: [
      {
        id: "S1",
        title: "Report",
        url: "https://example.test/report",
        retrievedAt: "2026-09-07",
        foundBy: "lithium recycling margin 2026",
        status: "read",
        passages: ["Margins reached 12%.", "Multi\nline"],
        notes: "Trade body, likely optimistic.",
      },
    ],
    findings: [{ heading: "Margins are thin", body: "Recyclers report 8 to 12%.", sources: ["S1"] }],
    contradictions: [],
    openQuestions: ["What about sodium-ion?"],
  });

  it("emits the fixed skeleton in order", () => {
    const md = dossierToMarkdown(dossier);
    const order = [
      "---",
      "# Battery recycling economics",
      DOSSIER_HEADINGS.question,
      DOSSIER_HEADINGS.queries,
      DOSSIER_HEADINGS.sources,
      "### S1 — Report",
      DOSSIER_HEADINGS.findings,
      DOSSIER_HEADINGS.contradictions,
      DOSSIER_HEADINGS.openQuestions,
    ];
    const positions = order.map((needle) => md.indexOf(needle));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(md).toContain('agentforge: "dossier v1"');
    expect(md).toContain("sourceCount: 1");
    expect(md).toContain("> Margins reached 12%.");
    expect(md).toContain("> Multi line");
    expect(md).toContain("Recyclers report 8 to 12%. [S1]");
    expect(md).toContain("- None recorded.");
  });

  it("finds cited ids and rejects bad source ids", () => {
    expect(citedSourceIds("a [S1] b [S12] c [S1] [x]")).toEqual(["S1", "S12"]);
    expect(dossierSchema.safeParse({ ...dossier, sources: [{ id: "bad" }] }).success).toBe(false);
  });
});

describe("dataAnalysisToMarkdown", () => {
  it("renders evidence tables, sql, and charts as tables", () => {
    const analysis = dataAnalysisSchema.parse({
      title: "Spend",
      summary: "Acme dominates.",
      findings: [
        {
          heading: "Top vendor",
          body: "Acme is 71%.",
          evidence: {
            sql: "SELECT vendor, SUM(spend) FROM t GROUP BY 1",
            table: { columns: ["vendor", "spend"], rows: [["Acme", 12000]] },
          },
        },
      ],
      charts: [
        {
          type: "bar",
          title: "Spend by vendor",
          x: { label: "vendor", values: ["Acme", "Beta"] },
          series: [{ name: "spend", values: [12000, 4100] }],
        },
      ],
    });
    const md = dataAnalysisToMarkdown(analysis);
    expect(md).toContain("```sql\nSELECT vendor, SUM(spend) FROM t GROUP BY 1\n```");
    expect(md).toContain("| vendor | spend |\n| --- | --- |\n| Acme | 12000 |");
    expect(md).toContain("## Charts");
    expect(md).toContain("| Beta | 4100 |");
    expect(md).not.toContain("## Tables");
  });
});

describe("financeBriefToMarkdown", () => {
  it("formats metrics by unit and lists assumptions", () => {
    expect(formatMetricValue({ key: "m", label: "Margin", value: 12.5, unit: "%", period: "", formula: "" })).toBe(
      "12.5%",
    );
    expect(formatMetricValue({ key: "r", label: "Runway", value: 14, unit: "months", period: "", formula: "" })).toBe(
      "14 months",
    );
    expect(formatMetricValue({ key: "x", label: "Missing", value: null, unit: "USD", period: "", formula: "" })).toBe(
      "missing",
    );
    const brief = financeBriefSchema.parse({
      title: "Cash plan",
      sections: [{ heading: "Runway is 14 months", body: "At current burn." }],
      computed: {
        metrics: [
          { key: "runway", label: "Runway", value: 14, unit: "months", period: "FY26", formula: "cash / burn" },
        ],
      },
    });
    const md = financeBriefToMarkdown(brief);
    expect(md).toContain("## Computed metrics");
    expect(md).toContain("| Runway | 14 months | FY26 | cash / burn |");
    expect(md).toContain("## Assumptions\n\n- None stated.");
  });
});
