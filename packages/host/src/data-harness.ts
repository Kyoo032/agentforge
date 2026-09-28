import { ApiError, parseAppLocale, type AppLocale } from "@agentforge/core";
import { dataAnalysisSchema, type DataAnalysis, type DataChart, type DataFinding } from "@agentforge/core/artifacts";
import {
  planDataCuts,
  sheetLimit,
  stripUngroundedSentences,
  ungroundedNumbers,
  type GroundTable,
  type PlannedCut,
  type SheetLimit,
} from "@agentforge/core/data";
import type { JobEmitter } from "@agentforge/core/jobs";
import {
  chartFromResult,
  materializeWithFailures,
  parseAnalysisDraft,
  type AnalysisDraft,
} from "./data-analysis-build";
import { dataCopy } from "./data-copy";
import { sqlForCut } from "./data-cut-sql";
import type { LoadedDataset } from "./datasets";
import { throwIfJobAborted } from "./job-stream";
import type { SqlResult } from "./sql-tool";

export const DATA_SKILL_IDS = ["read-sheet", "pick-cuts", "run-cuts", "next-question", "hold-sentence"] as const;
export type DataSkillId = (typeof DATA_SKILL_IDS)[number];

export type RanCut = {
  plan: PlannedCut;
  sql: string;
  result: SqlResult;
};

export type DataHarnessResult = {
  analysis: DataAnalysis;
  model: string;
  skills: DataSkillId[];
  cuts: PlannedCut[];
  retried: boolean;
};

type HistoryItem = { question: string; summary: string };

const NO_EMIT: JobEmitter = () => {};

function identifierFor(dataset: LoadedDataset, name: string): string {
  const column = dataset.columns.find((item) => item.name === name);
  if (!column) {
    throw new ApiError("invalid_request", `Unknown column ${name}`, 400);
  }
  return column.identifier;
}

function limitNote(limit: SheetLimit | null, locale: AppLocale): string | null {
  if (limit === "forecast") {
    return dataCopy(locale).cannotForecast;
  }
  if (limit === "other_table") {
    return dataCopy(locale).cannotOtherTable;
  }
  return null;
}

function stampSummary(summary: string, question: string, locale: AppLocale): string {
  const note = limitNote(sheetLimit(question), locale);
  if (!note || summary.includes(note)) {
    return summary;
  }
  return `${note} ${summary}`;
}

function cutBrief(cuts: RanCut[]): string {
  return cuts
    .map((cut) => {
      const header = `| ${cut.result.columns.join(" | ")} |`;
      const rule = `| ${cut.result.columns.map(() => "---").join(" | ")} |`;
      const rows = cut.result.rows
        .slice(0, 20)
        .map((row) => `| ${row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))).join(" | ")} |`)
        .join("\n");
      const columns = cut.plan.columns.length > 0 ? cut.plan.columns.join(", ") : "whole sheet";
      return [`Cut ${cut.plan.kind} on ${columns} (${cut.plan.aggregate}):`, cut.sql, header, rule, rows]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export function buildDataPrompt(input: {
  brief: string;
  cuts: RanCut[];
  history: HistoryItem[];
  extra: string | null;
  question: string;
  locale: AppLocale;
  repair: string | null;
}): string {
  const note = limitNote(sheetLimit(input.question), input.locale);
  const previous = input.history.map((item) => `Q: ${item.question}\nA (summary): ${item.summary}`).join("\n\n");
  return [
    input.brief,
    `Cuts already run (every number you write must appear in these results or in a query you run):\n${cutBrief(input.cuts)}`,
    note,
    previous ? `Earlier questions on this dataset:\n${previous}` : null,
    input.extra ? `Extra context from the user:\n${input.extra}` : null,
    `Question:\n${input.question}`,
    input.repair,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

function corpusOf(cuts: RanCut[], analysis: DataAnalysis | null): GroundTable[] {
  const fromCuts: GroundTable[] = cuts.map((cut) => ({ columns: cut.result.columns, rows: cut.result.rows }));
  const fromFindings: GroundTable[] = [];
  for (const finding of analysis?.findings ?? []) {
    if (finding.evidence) {
      fromFindings.push(finding.evidence.table);
    }
  }
  return [...fromCuts, ...fromFindings];
}

function proseProblems(draft: AnalysisDraft, analysis: DataAnalysis | null, corpus: GroundTable[]): string[] {
  const problems: string[] = [];
  const titleNumbers = ungroundedNumbers(`${draft.title}\n${draft.summary}`, corpus);
  if (titleNumbers.length > 0) {
    problems.push(`title or summary: ${titleNumbers.join(", ")}`);
  }
  const kept = new Set(
    (analysis?.findings ?? []).filter((finding) => finding.evidence).map((finding) => finding.heading),
  );
  for (const finding of draft.findings) {
    if (finding.sql && !kept.has(finding.heading)) {
      problems.push(`${finding.heading}: the evidence query failed`);
    }
    const numbers = ungroundedNumbers(`${finding.heading}\n${finding.body}`, corpus);
    if (numbers.length > 0) {
      problems.push(`${finding.heading}: ${numbers.join(", ")}`);
    }
  }
  for (const chart of draft.charts) {
    const numbers = ungroundedNumbers(chart.title, corpus);
    if (numbers.length > 0) {
      problems.push(`chart: ${numbers.join(", ")}`);
    }
  }
  return problems;
}

function headingFor(cut: RanCut, locale: AppLocale): string {
  const copy = dataCopy(locale);
  const [first, second] = cut.plan.columns;
  if (cut.plan.kind === "compare" && first && second) {
    return copy.by(second, first);
  }
  if (cut.plan.kind === "over_time" && first && second) {
    return copy.over(second, first);
  }
  if (cut.plan.kind === "split" && first) {
    return copy.split(first);
  }
  if (cut.plan.kind === "blanks") {
    return copy.blanks;
  }
  return copy.rowsTitle;
}

function bodyFor(cut: RanCut, locale: AppLocale): string {
  if (cut.result.rows.length === 0) {
    return dataCopy(locale).noRows;
  }
  return cut.result.rows
    .slice(0, 5)
    .map((row) => cut.result.columns.map((column, index) => `${column} = ${row[index] ?? ""}`).join(", "))
    .join("; ");
}

function findingFromCut(cut: RanCut, locale: AppLocale): DataFinding {
  return {
    heading: headingFor(cut, locale),
    body: bodyFor(cut, locale),
    evidence: {
      sql: cut.sql,
      table: { columns: cut.result.columns, rows: cut.result.rows.slice(0, 50) },
    },
  };
}

function chartFor(cut: RanCut, locale: AppLocale): DataChart | null {
  const series = cut.result.columns[1];
  if (!series || cut.result.columns[0] !== "group_key") {
    return null;
  }
  const type =
    cut.plan.kind === "over_time" ? "line" : cut.plan.kind === "compare" || cut.plan.kind === "split" ? "bar" : null;
  if (!type) {
    return null;
  }
  return chartFromResult(
    { type, title: headingFor(cut, locale), sql: cut.sql, x: "group_key", series: [series] },
    cut.result,
  );
}

function attachCutCharts(analysis: DataAnalysis, cuts: RanCut[], locale: AppLocale): DataAnalysis {
  const charts = [...analysis.charts];
  for (const cut of cuts) {
    if (charts.length >= 3) {
      break;
    }
    const built = chartFor(cut, locale);
    if (!built) {
      continue;
    }
    if (charts.some((chart) => chart.type === built.type && chart.x.label === built.x.label)) {
      continue;
    }
    charts.push(built);
  }
  return { ...analysis, charts };
}

function analysisFromCuts(cuts: RanCut[], locale: AppLocale, question: string): DataAnalysis {
  const charts = cuts
    .map((cut) => chartFor(cut, locale))
    .filter((chart): chart is DataChart => chart !== null)
    .slice(0, 3);
  return dataAnalysisSchema.parse({
    title: dataCopy(locale).fallbackTitle,
    summary: stampSummary(dataCopy(locale).fallbackSummary, question, locale),
    findings: cuts.map((cut) => findingFromCut(cut, locale)),
    tables: [],
    charts,
  });
}

/** Keep findings whose sentences only use numbers the queries returned. */
function holdSentences(analysis: DataAnalysis, corpus: GroundTable[], locale: AppLocale): DataAnalysis | null {
  const findings: DataFinding[] = [];
  for (const finding of analysis.findings) {
    if (ungroundedNumbers(finding.heading, corpus).length > 0) {
      continue;
    }
    const body = stripUngroundedSentences(finding.body, corpus);
    if (!body) {
      continue;
    }
    findings.push({ ...finding, body });
  }
  if (findings.length === 0) {
    return null;
  }
  const copy = dataCopy(locale);
  const title = ungroundedNumbers(analysis.title, corpus).length > 0 ? copy.fallbackTitle : analysis.title;
  const strippedSummary = stripUngroundedSentences(analysis.summary, corpus);
  const summary =
    ungroundedNumbers(analysis.summary, corpus).length > 0 ? strippedSummary || copy.fallbackSummary : analysis.summary;
  const charts = analysis.charts.map((chart) =>
    ungroundedNumbers(chart.title, corpus).length > 0 ? { ...chart, title: "" } : chart,
  );
  return { ...analysis, title, summary, findings, charts };
}

export async function runDataHarness(input: {
  dataset: LoadedDataset;
  question: string;
  history: HistoryItem[];
  extra: string | null;
  brief: string;
  locale: AppLocale;
  emit?: JobEmitter;
  abortSignal?: AbortSignal;
  query: (sql: string) => Promise<SqlResult>;
  answer: (prompt: string) => Promise<{ text: string; model: string }>;
}): Promise<DataHarnessResult> {
  const locale = parseAppLocale(input.locale);
  const emit = input.emit ?? NO_EMIT;
  const copy = dataCopy(locale);
  const skills: DataSkillId[] = ["read-sheet"];
  const planned = planDataCuts(input.dataset.profile, input.question);
  skills.push("pick-cuts");

  throwIfJobAborted(input.abortSignal);
  emit({ type: "job.phase", phase: "cutting", label: copy.cutting });
  const cuts: RanCut[] = [];
  for (const plan of planned) {
    const built = sqlForCut(plan, (name) => identifierFor(input.dataset, name));
    try {
      const result = await input.query(built.sql);
      cuts.push({ plan, sql: built.sql, result });
      emit({
        type: "job.step",
        phase: "cutting",
        label: built.sql,
        detail: copy.queryRows(result.rowCount),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "query failed";
      emit({ type: "job.step", phase: "cutting", label: built.sql, detail: copy.queryFailed(reason) });
    }
  }
  skills.push("run-cuts");
  if (cuts.length === 0) {
    throw new ApiError("generation_failed", copy.cutsFailed, 502);
  }
  if (input.history.length > 0) {
    skills.push("next-question");
  }

  const ask = async (repair: string | null) => {
    throwIfJobAborted(input.abortSignal);
    emit({ type: "job.phase", phase: "analyzing", label: repair ? copy.repairing : copy.analyzing });
    const answered = await input.answer(
      buildDataPrompt({
        brief: input.brief,
        cuts,
        history: input.history,
        extra: input.extra,
        question: input.question,
        locale,
        repair,
      }),
    );
    let draft: AnalysisDraft | null = null;
    if (answered.text.trim()) {
      try {
        draft = parseAnalysisDraft(answered.text);
      } catch {
        draft = null;
      }
    }
    return { draft, model: answered.model };
  };

  const check = async (draft: AnalysisDraft): Promise<{ analysis: DataAnalysis | null; problems: string[] }> => {
    throwIfJobAborted(input.abortSignal);
    emit({ type: "job.phase", phase: "verifying", label: copy.verifying });
    const outcome = await materializeWithFailures(draft, input.query);
    const corpus = corpusOf(cuts, outcome.analysis);
    const problems = proseProblems(draft, outcome.analysis, corpus);
    for (const failure of outcome.failures) {
      const line = `${failure.heading}: ${failure.reason}`;
      if (!problems.some((item) => item.startsWith(`${failure.heading}:`))) {
        problems.push(line);
      }
    }
    if (problems.length > 0 || !outcome.analysis) {
      return { analysis: null, problems: problems.length > 0 ? problems : [copy.noFindings] };
    }
    const held = holdSentences(outcome.analysis, corpus, locale);
    return { analysis: held ? attachCutCharts(held, cuts, locale) : null, problems };
  };

  const first = await ask(null);
  let model = first.model;
  let retried = false;
  let chosen: DataAnalysis | null = null;
  let problems: string[] = first.draft ? [] : [copy.invalidJson];
  if (first.draft) {
    const checked = await check(first.draft);
    problems = checked.problems;
    if (problems.length === 0) {
      chosen = checked.analysis;
    }
  }
  if (!chosen) {
    retried = true;
    const second = await ask(`${problems.map((item) => `- ${item}`).join("\n")}\n\n${copy.repair}`);
    model = second.model;
    if (second.draft) {
      const outcome = await materializeWithFailures(second.draft, input.query);
      const corpus = corpusOf(cuts, outcome.analysis);
      const held = outcome.analysis ? holdSentences(outcome.analysis, corpus, locale) : null;
      chosen = held ? attachCutCharts(held, cuts, locale) : null;
    }
  }
  skills.push("hold-sentence");

  const analysis = chosen ?? analysisFromCuts(cuts, locale, input.question);
  return {
    analysis: { ...analysis, summary: stampSummary(analysis.summary, input.question, locale) },
    model,
    skills,
    cuts: cuts.map((cut) => cut.plan),
    retried,
  };
}
