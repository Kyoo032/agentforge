import { markdownTable } from "@agentforge/core/artifacts";
import type { FinanceReport, ReportChart, ReportKpi } from "@agentforge/core/finance";
import { safeReportFilename } from "./cells";
import { REPORT_MIME, type RenderedFile, type ReportRenderer } from "./types";

const KPI_COLUMNS = ["Metric", "Value", "Unit", "Status"];
const FLAG_COLUMNS = ["Level", "Flag"];

function kpiBlock(summary: readonly ReportKpi[]): string[] {
  if (summary.length === 0) {
    return [];
  }
  const rows = summary.map((kpi) => [kpi.label, kpi.value, kpi.unit ?? "", kpi.flag ?? ""]);
  return [markdownTable(KPI_COLUMNS, rows), ""];
}

function chartBlock(chart: ReportChart): string[] {
  const columns = ["Series", ...chart.categories];
  const rows = chart.series.map((series) => [
    series.name,
    ...chart.categories.map((_category, index) => series.values[index] ?? null),
  ]);
  return [`### ${chart.title}`, "", markdownTable(columns, rows), "", ...(chart.note ? [chart.note, ""] : [])];
}

function flagBlock(report: FinanceReport): string[] {
  if (report.flags.length === 0) {
    return [];
  }
  const rows = report.flags.map((flag) => [flag.level, flag.text]);
  return [markdownTable(FLAG_COLUMNS, rows), ""];
}

function body(report: FinanceReport): string {
  const lines = [
    `# ${report.title}`,
    "",
    ...(report.subtitle ? [report.subtitle, ""] : []),
    ...kpiBlock(report.summary),
  ];
  for (const note of report.notes) {
    lines.push(`## ${note.heading}`, "", note.body, "");
  }
  for (const table of report.tables) {
    lines.push(
      `### ${table.title}`,
      "",
      markdownTable(
        [...table.columns],
        table.rows.map((row) => [...row]),
      ),
      "",
    );
  }
  lines.push(...report.charts.flatMap(chartBlock), ...flagBlock(report));
  return `${lines.join("\n").trim()}\n`;
}

/** The plain-text fallback every other format is checked against. */
export const renderMd: ReportRenderer = async (report: FinanceReport): Promise<RenderedFile> => ({
  bytes: new Uint8Array(Buffer.from(body(report), "utf8")),
  mime: REPORT_MIME.md,
  filename: safeReportFilename(report.title, "md"),
});
