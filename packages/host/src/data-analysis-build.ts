import { ApiError } from "@agentforge/core";
import {
  CHART_TYPES,
  dataAnalysisSchema,
  type DataAnalysis,
  type DataChart,
  type DataFinding,
  type EvidenceTable,
} from "@agentforge/core/artifacts";
import { extractJsonObject } from "./presentation-outline";
import type { SqlResult } from "./sql-tool";

export const EVIDENCE_ROW_CAP = 50;
export const CHART_POINT_CAP = 50;

/** What the model returns: prose plus the SQL behind each claim. Code turns SQL into tables and charts. */
export type AnalysisDraft = {
  title: string;
  summary: string;
  findings: Array<{ heading: string; body: string; sql: string | null }>;
  charts: Array<{ type: DataChart["type"]; title: string; sql: string; x: string; series: string[] }>;
};

export type RunSql = (sql: string) => Promise<SqlResult>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

export function parseAnalysisDraft(raw: string): AnalysisDraft {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  } catch {
    throw new ApiError("invalid_analysis", "Model returned invalid JSON for the analysis", 502);
  }
  const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return { heading: text(record.heading), body: text(record.body), sql: text(record.sql) || null };
    })
    .filter((finding) => finding.heading && finding.body);
  if (findings.length === 0) {
    throw new ApiError("invalid_analysis", "Model returned no findings", 502);
  }
  const charts = (Array.isArray(parsed.charts) ? parsed.charts : [])
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      const type = text(record.type).toLowerCase() as DataChart["type"];
      return {
        type,
        title: text(record.title),
        sql: text(record.sql),
        x: text(record.x),
        series: stringList(record.series),
      };
    })
    .filter(
      (chart) =>
        (CHART_TYPES as readonly string[]).includes(chart.type) && chart.sql && chart.x && chart.series.length > 0,
    );
  return {
    title: text(parsed.title) || "Data analysis",
    summary: text(parsed.summary) || "See findings.",
    findings,
    charts,
  };
}

function evidenceTable(result: SqlResult): EvidenceTable {
  return { columns: result.columns, rows: result.rows.slice(0, EVIDENCE_ROW_CAP) };
}

export type EvidenceFailure = { heading: string; reason: string };

export type MaterializeOutcome = {
  /** Null when every finding was dropped because its evidence query failed. */
  analysis: DataAnalysis | null;
  failures: EvidenceFailure[];
};

async function materializeFinding(
  finding: AnalysisDraft["findings"][number],
  runSql: RunSql,
): Promise<{ finding: DataFinding } | { failure: EvidenceFailure }> {
  if (!finding.sql) {
    return { finding: { heading: finding.heading, body: finding.body } };
  }
  try {
    const result = await runSql(finding.sql);
    return {
      finding: {
        heading: finding.heading,
        body: finding.body,
        evidence: { sql: finding.sql, table: evidenceTable(result) },
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "query failed";
    return { failure: { heading: finding.heading, reason } };
  }
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * Build chart data from a real query result. Rows where any plotted series is missing or
 * non-numeric are left out (never zero-filled); null when the named columns are not there
 * or no row is fully numeric.
 */
export function chartFromResult(draft: AnalysisDraft["charts"][number], result: SqlResult): DataChart | null {
  const xIndex = result.columns.indexOf(draft.x);
  const seriesIndexes = draft.series.map((name) => result.columns.indexOf(name)).filter((index) => index >= 0);
  if (xIndex < 0 || seriesIndexes.length === 0) {
    return null;
  }
  const points = result.rows
    .map((row) => ({
      x: typeof row[xIndex] === "number" ? (row[xIndex] as number) : String(row[xIndex] ?? ""),
      values: seriesIndexes.map((index) => numberOrNull(row[index])),
    }))
    .filter((point): point is { x: string | number; values: number[] } => point.values.every((value) => value !== null))
    .slice(0, CHART_POINT_CAP);
  if (points.length === 0) {
    return null;
  }
  return {
    type: draft.type,
    title: draft.title,
    x: { label: draft.x, values: points.map((point) => point.x) },
    series: seriesIndexes.map((index, at) => ({
      name: result.columns[index] ?? "",
      values: points.map((point) => point.values[at] as number),
    })),
  };
}

async function materializeChart(draft: AnalysisDraft["charts"][number], runSql: RunSql): Promise<DataChart | null> {
  try {
    return chartFromResult(draft, await runSql(draft.sql));
  } catch {
    return null;
  }
}

/**
 * Re-run each finding's SQL. A query that fails drops that finding — the sentence is not kept.
 * Charts still come only from query results.
 */
export async function materializeWithFailures(draft: AnalysisDraft, runSql: RunSql): Promise<MaterializeOutcome> {
  const findings: DataFinding[] = [];
  const failures: EvidenceFailure[] = [];
  for (const finding of draft.findings) {
    const built = await materializeFinding(finding, runSql);
    if ("failure" in built) {
      failures.push(built.failure);
    } else {
      findings.push(built.finding);
    }
  }
  const charts: DataChart[] = [];
  for (const chart of draft.charts) {
    const built = await materializeChart(chart, runSql);
    if (built) {
      charts.push(built);
    }
  }
  if (findings.length === 0) {
    return { analysis: null, failures };
  }
  return {
    analysis: dataAnalysisSchema.parse({ title: draft.title, summary: draft.summary, findings, tables: [], charts }),
    failures,
  };
}

/** Every table and chart comes from re-running the model's SQL in code; prose is the model's, numbers are not. */
export async function materializeAnalysis(draft: AnalysisDraft, runSql: RunSql): Promise<DataAnalysis> {
  const outcome = await materializeWithFailures(draft, runSql);
  if (!outcome.analysis) {
    throw new ApiError("invalid_analysis", "Model returned no findings", 502);
  }
  return outcome.analysis;
}
