import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { chartFromResult, materializeAnalysis, parseAnalysisDraft } from "./data-analysis-build";
import type { SqlResult } from "./sql-tool";

const RAW = `Here you go:
\`\`\`json
{
  "title": "Vendor concentration",
  "summary": "Acme is 71% of spend.",
  "findings": [
    { "heading": "Acme dominates", "body": "Acme is 71%.", "sql": "SELECT vendor, SUM(spend) AS spend FROM data GROUP BY 1" },
    { "heading": "No sql", "body": "Just prose." },
    { "heading": "", "body": "dropped" }
  ],
  "charts": [
    { "type": "BAR", "title": "Spend by vendor", "sql": "SELECT vendor, SUM(spend) AS spend FROM data GROUP BY 1", "x": "vendor", "series": ["spend", "missing"] },
    { "type": "pie", "sql": "x", "x": "a", "series": ["b"] }
  ]
}
\`\`\``;

function result(columns: string[], rows: SqlResult["rows"]): SqlResult {
  return { columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 1 };
}

describe("parseAnalysisDraft", () => {
  it("reads fenced JSON, normalizes chart types, drops empties and unknown chart types", () => {
    const draft = parseAnalysisDraft(RAW);
    expect(draft.findings).toHaveLength(2);
    expect(draft.findings[0]?.sql).toContain("GROUP BY 1");
    expect(draft.findings[1]?.sql).toBeNull();
    expect(draft.charts).toEqual([
      {
        type: "bar",
        title: "Spend by vendor",
        sql: "SELECT vendor, SUM(spend) AS spend FROM data GROUP BY 1",
        x: "vendor",
        series: ["spend", "missing"],
      },
    ]);
    expect(() => parseAnalysisDraft("nope")).toThrow(ApiError);
    expect(() => parseAnalysisDraft('{"findings": []}')).toThrow(/no findings/);
  });
});

describe("materializeAnalysis", () => {
  it("fills evidence tables and charts from real query results and notes failed queries", async () => {
    const draft = parseAnalysisDraft(RAW);
    const analysis = await materializeAnalysis(draft, async (sql) => {
      if (sql.includes("GROUP BY 1")) {
        return result(
          ["vendor", "spend"],
          [
            ["Acme", 12000],
            ["Beta", 4100],
            ["Gamma", "800"],
          ],
        );
      }
      throw new Error("no such column");
    });
    expect(analysis.findings[0]?.evidence).toEqual({
      sql: "SELECT vendor, SUM(spend) AS spend FROM data GROUP BY 1",
      table: {
        columns: ["vendor", "spend"],
        rows: [
          ["Acme", 12000],
          ["Beta", 4100],
          ["Gamma", "800"],
        ],
      },
    });
    expect(analysis.findings[1]?.evidence).toBeUndefined();
    expect(analysis.charts).toEqual([
      {
        type: "bar",
        title: "Spend by vendor",
        x: { label: "vendor", values: ["Acme", "Beta", "Gamma"] },
        series: [{ name: "spend", values: [12000, 4100, 800] }],
      },
    ]);

    const failing = await materializeAnalysis(draft, async () => {
      throw new Error("boom");
    });
    expect(failing.findings[0]?.evidence).toBeUndefined();
    expect(failing.findings[0]?.body).toContain("(Evidence query failed: boom)");
    expect(failing.charts).toEqual([]);
  });

  it("drops charts whose columns are missing or non-numeric and never zero-fills gaps", () => {
    const chart = { type: "line" as const, title: "", sql: "x", x: "month", series: ["total"] };
    expect(chartFromResult(chart, result(["month"], [["Jan"]]))).toBeNull();
    expect(chartFromResult(chart, result(["month", "total"], [["Jan", "n/a"]]))).toBeNull();
    const built = chartFromResult(
      chart,
      result(
        ["month", "total"],
        [
          ["Jan", 3],
          ["Feb", null],
          ["Mar", "7"],
        ],
      ),
    );
    expect(built?.x.values).toEqual(["Jan", "Mar"]);
    expect(built?.series[0]?.values).toEqual([3, 7]);
  });
});
