import { z } from "zod";
import { markdownTable } from "./markdown-table";

export const CHART_TYPES = ["bar", "line", "scatter"] as const;

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const evidenceTableSchema = z.object({
  columns: z.array(z.string()).min(1),
  rows: z.array(z.array(cellSchema)).default([]),
});

export const namedTableSchema = evidenceTableSchema.extend({
  name: z.string().min(1),
});

export const dataFindingSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
  evidence: z
    .object({
      sql: z.string().default(""),
      table: evidenceTableSchema,
    })
    .optional(),
});

export const dataChartSchema = z.object({
  type: z.enum(CHART_TYPES),
  title: z.string().default(""),
  x: z.object({
    label: z.string().default(""),
    values: z.array(z.union([z.string(), z.number()])),
  }),
  series: z
    .array(
      z.object({
        name: z.string().min(1),
        values: z.array(z.number()),
      }),
    )
    .min(1),
});

export const dataAnalysisSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  findings: z.array(dataFindingSchema).min(1),
  tables: z.array(namedTableSchema).default([]),
  charts: z.array(dataChartSchema).default([]),
});

export type EvidenceTable = z.infer<typeof evidenceTableSchema>;
export type NamedTable = z.infer<typeof namedTableSchema>;
export type DataFinding = z.infer<typeof dataFindingSchema>;
export type DataChart = z.infer<typeof dataChartSchema>;
export type DataAnalysis = z.infer<typeof dataAnalysisSchema>;

const SQL_FENCE = "```sql";
const FENCE = "```";

function findingBlock(finding: DataFinding): string[] {
  const lines = [`## ${finding.heading}`, "", finding.body, ""];
  if (finding.evidence) {
    if (finding.evidence.sql) {
      lines.push(SQL_FENCE, finding.evidence.sql.trim(), FENCE, "");
    }
    lines.push(markdownTable(finding.evidence.table.columns, finding.evidence.table.rows), "");
  }
  return lines;
}

function chartBlock(chart: DataChart): string[] {
  const columns = [chart.x.label || "x", ...chart.series.map((series) => series.name)];
  const rows = chart.x.values.map((x, index) => [x, ...chart.series.map((series) => series.values[index] ?? null)]);
  return [`### ${chart.title || `${chart.type} chart`}`, "", markdownTable(columns, rows), ""];
}

export function dataAnalysisToMarkdown(analysis: DataAnalysis): string {
  const lines = [`# ${analysis.title}`, "", analysis.summary, "", ...analysis.findings.flatMap(findingBlock)];
  if (analysis.tables.length > 0) {
    lines.push("## Tables", "");
    for (const table of analysis.tables) {
      lines.push(`### ${table.name}`, "", markdownTable(table.columns, table.rows), "");
    }
  }
  if (analysis.charts.length > 0) {
    lines.push("## Charts", "", ...analysis.charts.flatMap(chartBlock));
  }
  return `${lines.join("\n").trim()}\n`;
}
