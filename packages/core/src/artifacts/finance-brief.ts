import { z } from "zod";
import { evidenceTableSchema, namedTableSchema } from "./data-analysis";
import { formatCellNumber, markdownTable } from "./markdown-table";

export const financeMetricSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number().nullable(),
  /** Currency code, "%", "x", "months", or "" for a plain number. */
  unit: z.string().default(""),
  period: z.string().default(""),
  formula: z.string().default(""),
});

export const financeSectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
  tables: z.array(evidenceTableSchema).default([]),
  /** Metric keys the section relies on. */
  metrics: z.array(z.string()).default([]),
});

export const financeComputedSchema = z.object({
  metrics: z.array(financeMetricSchema).default([]),
  tables: z.array(namedTableSchema).default([]),
});

export const financeBriefSchema = z.object({
  title: z.string().min(1),
  sections: z.array(financeSectionSchema).min(1),
  assumptions: z.array(z.string()).default([]),
  computed: financeComputedSchema.default({ metrics: [], tables: [] }),
});

export type FinanceMetric = z.infer<typeof financeMetricSchema>;
export type FinanceSection = z.infer<typeof financeSectionSchema>;
export type FinanceComputed = z.infer<typeof financeComputedSchema>;
export type FinanceBrief = z.infer<typeof financeBriefSchema>;

const SUFFIX_UNITS = new Set(["%", "x"]);

export type FinanceBriefLabels = {
  computedMetrics?: string;
  assumptions?: string;
  noneStated?: string;
  missing?: string;
  metric?: string;
  value?: string;
  period?: string;
  formula?: string;
};

export function formatMetricValue(metric: FinanceMetric, missing = "missing"): string {
  if (metric.value === null) {
    return missing;
  }
  const number = formatCellNumber(metric.value);
  if (!metric.unit) {
    return number;
  }
  if (SUFFIX_UNITS.has(metric.unit)) {
    return `${number}${metric.unit}`;
  }
  return `${number} ${metric.unit}`;
}

function metricsTable(metrics: FinanceMetric[], labels?: FinanceBriefLabels): string {
  const missing = labels?.missing ?? "missing";
  return markdownTable(
    [labels?.metric ?? "Metric", labels?.value ?? "Value", labels?.period ?? "Period", labels?.formula ?? "Formula"],
    metrics.map((metric) => [metric.label, formatMetricValue(metric, missing), metric.period, metric.formula]),
  );
}

function sectionBlock(section: FinanceSection): string[] {
  const lines = [`## ${section.heading}`, "", section.body, ""];
  for (const table of section.tables) {
    lines.push(markdownTable(table.columns, table.rows), "");
  }
  return lines;
}

export function financeBriefToMarkdown(brief: FinanceBrief, labels?: FinanceBriefLabels): string {
  const computedHeading = labels?.computedMetrics ?? "Computed metrics";
  const assumptionsHeading = labels?.assumptions ?? "Assumptions";
  const noneStated = labels?.noneStated ?? "None stated.";
  const lines = [`# ${brief.title}`, "", ...brief.sections.flatMap(sectionBlock)];
  if (brief.computed.metrics.length > 0) {
    lines.push(`## ${computedHeading}`, "", metricsTable(brief.computed.metrics, labels), "");
  }
  for (const table of brief.computed.tables) {
    lines.push(`### ${table.name}`, "", markdownTable(table.columns, table.rows), "");
  }
  lines.push(`## ${assumptionsHeading}`, "");
  lines.push(...(brief.assumptions.length > 0 ? brief.assumptions.map((item) => `- ${item}`) : [`- ${noneStated}`]));
  return `${lines.join("\n").trim()}\n`;
}
