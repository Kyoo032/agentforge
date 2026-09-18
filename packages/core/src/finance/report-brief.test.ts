import { describe, expect, it } from "vitest";
import type { FinanceBrief } from "../artifacts/finance-brief";
import { financeReportFromBrief, financeReportFromMarkdown } from "./report-brief";
import { CALC_TABLE_ID, INPUTS_TABLE_ID, REPORT_TABLE_FIRST_DATA_ROW, reportTable } from "./report";

const brief: FinanceBrief = {
  title: "Margins held while cash thinned",
  sections: [
    { heading: "Revenue grew", body: "Revenue reached 1200 in 2026.", tables: [], metrics: ["revenue 2026"] },
    { heading: "Cash is short", body: "Cash covers a little over a quarter.", tables: [], metrics: ["runway"] },
  ],
  assumptions: ["Figures are unaudited."],
  computed: {
    metrics: [
      { key: "revenue 2025", label: "Revenue 2025", value: 1000, unit: "IDR", period: "2025", formula: "sum(revenue)" },
      {
        key: "gross_margin 2025",
        label: "Gross margin 2025",
        value: 40,
        unit: "%",
        period: "2025",
        formula: "(revenue - cogs) / revenue",
      },
      {
        key: "net_margin 2025",
        label: "Net margin 2025",
        value: 12,
        unit: "%",
        period: "2025",
        formula: "net / revenue",
      },
      { key: "revenue 2026", label: "Revenue 2026", value: 1200, unit: "IDR", period: "2026", formula: "sum(revenue)" },
      {
        key: "gross_margin 2026",
        label: "Gross margin 2026",
        value: 35,
        unit: "%",
        period: "2026",
        formula: "(revenue - cogs) / revenue",
      },
      {
        key: "net_margin 2026",
        label: "Net margin 2026",
        value: -4,
        unit: "%",
        period: "2026",
        formula: "net / revenue",
      },
      {
        key: "revenue_growth 2026",
        label: "Revenue growth 2026",
        value: 20,
        unit: "%",
        period: "2026",
        formula: "vs previous period",
      },
      { key: "cash", label: "Cash on hand", value: 300, unit: "IDR", period: "", formula: "sum(cash)" },
      { key: "runway", label: "Runway", value: 3.5, unit: "months", period: "", formula: "cash / burn" },
      { key: "irr", label: "Internal rate of return", value: null, unit: "%", period: "", formula: "npv = 0" },
    ],
    tables: [
      {
        name: "Line items",
        columns: ["Label", "Period", "Category", "Amount", "Currency"],
        rows: [
          ["Sales", "2025", "revenue", 1000, "IDR"],
          ["Sales", "2026", "revenue", 1200, "IDR"],
          ["Hosting", "2026", "cogs", 780, "IDR"],
        ],
      },
      {
        name: "Totals by period",
        columns: ["Category", "2025", "2026"],
        rows: [["revenue", 1000, 1200]],
      },
    ],
  },
};

describe("financeReportFromBrief", () => {
  const report = financeReportFromBrief(brief, {
    task: "brief",
    locale: "en",
    guard: { flagged: [{ section: 0, text: "99" }], total: 1 },
  });

  it("carries the task, title, locale and the currency the metrics use", () => {
    expect(report.task).toBe("brief");
    expect(report.title).toBe(brief.title);
    expect(report.locale).toBe("en");
    expect(report.currency).toBe("IDR");
  });

  it("lifts KPIs out of the computed metrics, newest period first, skipping missing values", () => {
    const labels = report.summary.map((kpi) => kpi.label);
    expect(labels).toContain("Revenue 2026");
    expect(labels).toContain("Runway");
    expect(labels).not.toContain("Internal rate of return");
    expect(labels).not.toContain("Revenue 2025");
    const runway = report.summary.find((kpi) => kpi.label === "Runway");
    expect(runway).toMatchObject({ value: 3.5, unit: "months", flag: "risk" });
    expect(report.summary.find((kpi) => kpi.label === "Net margin 2026")?.flag).toBe("risk");
    expect(report.summary.find((kpi) => kpi.label === "Gross margin 2026")?.flag).toBe("good");
  });

  it("keeps the line items as the inputs table and the metrics as the calc table", () => {
    const inputs = reportTable(report, INPUTS_TABLE_ID);
    expect(inputs?.columns).toEqual(["Label", "Period", "Category", "Amount", "Currency"]);
    expect(inputs?.rows).toHaveLength(3);
    const calc = reportTable(report, CALC_TABLE_ID);
    expect(calc?.columns).toEqual(["Metric", "Value", "Unit", "Period", "Formula"]);
    expect(calc?.rows).toHaveLength(brief.computed.metrics.length);
  });

  it("gives the calc table live Excel formulas that reference Inputs and its own period cell", () => {
    const calc = reportTable(report, CALC_TABLE_ID);
    const formulas = (calc?.formulas ?? []).map((row) => row[1]);
    const revenue2026 = formulas[3];
    expect(revenue2026).toBe(
      `SUMIFS(Inputs!$D:$D,Inputs!$C:$C,"revenue",Inputs!$B:$B,$D${REPORT_TABLE_FIRST_DATA_ROW + 3})`,
    );
    // A period the user typed is never inlined into a formula; it is referenced as a cell.
    expect(formulas.join("|")).not.toContain('2026"');
    // Nothing is invented for a metric we cannot derive from the inputs sheet.
    expect(formulas[9]).toBeNull();
  });

  it("keeps every other computed table as a table of its own", () => {
    const totals = report.tables.find((table) => table.title === "Totals by period");
    expect(totals?.id).toBe("totals-by-period");
    expect(totals?.rows).toEqual([["revenue", 1000, 1200]]);
  });

  it("builds one margin and growth bar chart over the periods that have revenue", () => {
    expect(report.charts).toHaveLength(1);
    const chart = report.charts[0];
    expect(chart?.kind).toBe("bar");
    expect(chart?.categories).toEqual(["2025", "2026"]);
    expect(chart?.series.map((series) => series.name)).toEqual(["Gross margin", "Net margin", "Revenue growth"]);
    expect(chart?.series[0]?.values).toEqual([40, 35]);
    expect(chart?.series[2]?.values).toEqual([null, 20]);
  });

  it("turns the guarded prose into notes and keeps the assumptions as the last note", () => {
    expect(report.notes.map((note) => note.heading)).toEqual(["Revenue grew", "Cash is short", "Assumptions"]);
    expect(report.notes[2]?.body).toContain("Figures are unaudited.");
  });

  it("raises a flag for every stripped figure and for every KPI outside its band", () => {
    expect(report.flags).toContainEqual({ level: "watch", text: "99" });
    expect(report.flags.some((flag) => flag.level === "risk" && flag.text.includes("Runway"))).toBe(true);
  });

  it("defaults the task to brief and the locale to en", () => {
    const plain = financeReportFromBrief(brief);
    expect(plain.task).toBe("brief");
    expect(plain.locale).toBe("en");
    expect(plain.flags.some((flag) => flag.text === "99")).toBe(false);
  });
});

describe("financeReportFromMarkdown", () => {
  const markdown = [
    "# Saved brief",
    "",
    "## Revenue grew",
    "",
    "Revenue reached 1200.",
    "",
    "## Cash",
    "",
    "Thin.",
  ].join("\n");

  it("recovers the headings and bodies of a saved brief with no tables or charts", () => {
    const report = financeReportFromMarkdown(markdown, { title: "Saved brief", task: "brief", locale: "id" });
    expect(report.title).toBe("Saved brief");
    expect(report.locale).toBe("id");
    expect(report.notes).toEqual([
      { heading: "Revenue grew", body: "Revenue reached 1200." },
      { heading: "Cash", body: "Thin." },
    ]);
    expect(report.tables).toEqual([]);
    expect(report.charts).toEqual([]);
  });

  it("falls back to the whole text when the markdown has no headings", () => {
    const report = financeReportFromMarkdown("Just a paragraph.", { title: "Saved" });
    expect(report.notes).toEqual([{ heading: "Saved", body: "Just a paragraph." }]);
  });
});
