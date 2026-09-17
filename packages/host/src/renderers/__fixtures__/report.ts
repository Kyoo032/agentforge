import type { FinanceReport } from "@agentforge/core/finance";

/** A label a spreadsheet would happily execute if it were written straight into a cell. */
export const INJECTION_LABEL = "=1+1";
/** Second injection shape: a leading @ is a legacy Lotus call in Excel. */
export const INJECTION_PERIOD = "@SUM(A1)";

/**
 * One report with every part a renderer has to handle: flagged KPIs, an inputs sheet, a calc sheet
 * with live formulas, an extra table, one chart of each kind, flags and notes.
 */
export function sampleReport(): FinanceReport {
  return {
    task: "brief",
    title: "Margins held while cash thinned",
    subtitle: "FY2025 to FY2026",
    locale: "en",
    currency: "IDR",
    summary: [
      { label: "Revenue 2026", value: 1200, unit: "IDR" },
      { label: "Gross margin 2026", value: 35, unit: "%", flag: "good" },
      { label: "Net margin 2026", value: -4, unit: "%", flag: "risk" },
      { label: "Runway", value: 8, unit: "months", flag: "watch" },
    ],
    tables: [
      {
        id: "inputs",
        title: "Line items",
        columns: ["Label", "Period", "Category", "Amount", "Currency"],
        rows: [
          ["Sales", "2025", "revenue", 1000, "IDR"],
          ["Sales", "2026", "revenue", 1200, "IDR"],
          [INJECTION_LABEL, INJECTION_PERIOD, "cogs", 780, "IDR"],
        ],
      },
      {
        id: "calc",
        title: "Metric",
        columns: ["Metric", "Value", "Unit", "Period", "Formula"],
        rows: [
          ["Revenue 2025", 1000, "IDR", "2025", "sum(revenue)"],
          ["Revenue 2026", 1200, "IDR", "2026", "sum(revenue)"],
          ["Internal rate of return", null, "%", "", "npv = 0"],
        ],
        formulas: [
          [null, 'SUMIFS(Inputs!$D:$D,Inputs!$C:$C,"revenue",Inputs!$B:$B,$D2)', null, null, null],
          [null, 'SUMIFS(Inputs!$D:$D,Inputs!$C:$C,"revenue",Inputs!$B:$B,$D3)', null, null, null],
          [null, null, null, null, null],
        ],
      },
      {
        id: "totals-by-period",
        title: "Totals by period",
        columns: ["Category", "2025", "2026"],
        rows: [["revenue", 1000, 1200]],
      },
    ],
    charts: [
      {
        id: "margin-growth",
        title: "Margin and growth",
        kind: "bar",
        categories: ["2025", "2026"],
        series: [
          { name: "Gross margin", values: [40, 35] },
          { name: "Net margin", values: [12, -4] },
        ],
        note: "Gross margin slipped five points while net margin turned negative.",
      },
      {
        id: "cash-balance",
        title: "Cash balance",
        kind: "line",
        categories: ["Jan", "Feb", "Mar"],
        series: [{ name: "Cash", values: [900, 600, 300] }],
      },
      {
        id: "sensitivity",
        title: "Sensitivity",
        kind: "heat",
        categories: ["-10%", "0%", "+10%"],
        series: [
          { name: "8%", values: [-40, 10, 60] },
          { name: "12%", values: [-90, -20, 30] },
        ],
      },
      {
        id: "runway-gauge",
        title: "Runway",
        kind: "gauge",
        categories: ["Runway"],
        series: [{ name: "months", values: [8] }],
        note: "Eight months of runway sits inside the watch band.",
      },
    ],
    flags: [
      { level: "risk", text: "Net margin 2026: -4%" },
      { level: "watch", text: "Runway: 8 months" },
    ],
    notes: [
      { heading: "Revenue grew", body: "Revenue reached 1200 in 2026." },
      { heading: "Assumptions", body: "Figures are unaudited." },
    ],
  };
}

/** The smallest report a renderer must still produce a file for. */
export function bareReport(): FinanceReport {
  return {
    task: "brief",
    title: "Bare/report: no tables?",
    locale: "id",
    summary: [],
    tables: [],
    charts: [],
    flags: [],
    notes: [{ heading: "Only prose", body: "Nothing was computed." }],
  };
}
