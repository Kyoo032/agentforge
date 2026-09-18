import {
  ApiError,
  gatewayRequiredMessage,
  hasLiveProvider,
  modeMessage,
  resolveChatModel,
  resolveRuntimeMode,
  scanInjection,
  withOutputLanguage,
  type TenantContext,
} from "@agentforge/core";
import { dataAnalysisToMarkdown, type DataAnalysis } from "@agentforge/core/artifacts";
import type { JobEmitter } from "@agentforge/core/jobs";
import { profileToMarkdown, tableSample } from "@agentforge/core/tabular";
import { artifactStore } from "./artifacts";
import { upsertWorkSource } from "./knowledge-ingest";
import { artifactWorkCard } from "./work-cards";
import { materializeAnalysis, parseAnalysisDraft } from "./data-analysis-build";
import { datasetStore, requireDataset, type DatasetSummary, type LoadedDataset } from "./datasets";
import { collectJobAssistantText } from "./job-regen";
import { throwIfJobAborted } from "./job-stream";
import { readSourceText } from "./job-source";
import { listSelectableModels, modeCatalogPayload } from "./selectable-models";
import { loadSettings } from "./settings-store";
import { localeForRun } from "./run-context";
import { DATASET_TABLE } from "./sql-guard";
import { SQL_STEP_CAP, withActiveDataset, type SqlToolOutput } from "./sql-tool";
import { log } from "./log";

export const DATA_HISTORY_MAX = 5;
const SAMPLE_ROWS = 20;

const DATA_SYSTEM = `You are a data analyst. One table is attached as SQLite table \`${DATASET_TABLE}\`; use the run_sql tool for every number you report. Never estimate from the sample.
Work: look at the profile, run a few targeted queries (max ${SQL_STEP_CAP}), then answer.
Return ONLY valid JSON (no markdown fences) with this shape:
{
  "title": string,
  "summary": string,
  "findings": [
    { "heading": string, "body": string, "sql": string | null }
  ],
  "charts": [
    { "type": "bar" | "line" | "scatter", "title": string, "sql": string, "x": string, "series": [string] }
  ]
}
Rules:
- findings.sql is the exact query whose result supports the finding. It is re-run in code and shown as evidence, so it must be a single SELECT you already ran. Use null for a purely qualitative point.
- charts: 0 to 3. sql returns the plotted rows; x names the category / x column of that result; series names one or more numeric columns of that result.
- Use column identifiers exactly as listed. Quote nothing you did not query. If a column is inferred, say so.
- Headings are claims, not labels. 3 to 6 findings.
- No campus / student / course nouns unless the table itself requires them.`;

export type DataAnalysisResult = {
  analysis: DataAnalysis;
  artifactId: string | null;
  dataset: DatasetSummary;
  markdown: string;
};

type HistoryItem = { question: string; summary: string };

const NO_EMIT: JobEmitter = () => {};

function readPrompt(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  const prompt = (body as { prompt?: unknown }).prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new ApiError("invalid_request", "prompt is required", 400);
  }
  return prompt.trim();
}

function readOptionalModel(body: unknown): string | undefined {
  const model = (body as { model?: unknown }).model;
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

function readHistory(body: unknown): HistoryItem[] {
  const raw = (body as { history?: unknown }).history;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      const record = (item ?? {}) as { question?: unknown; summary?: unknown };
      return {
        question: typeof record.question === "string" ? record.question.trim() : "",
        summary: typeof record.summary === "string" ? record.summary.trim() : "",
      };
    })
    .filter((item) => item.question && item.summary)
    .slice(-DATA_HISTORY_MAX);
}

/** `datasetId` of an uploaded dataset, or a pasted `csv` text that becomes one on the fly. */
function resolveDataset(tenant: TenantContext, body: unknown): LoadedDataset {
  const record = body as { datasetId?: unknown; csv?: unknown; name?: unknown };
  if (typeof record.datasetId === "string" && record.datasetId.trim()) {
    return requireDataset(tenant, record.datasetId.trim());
  }
  if (typeof record.csv === "string" && record.csv.trim()) {
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : "Pasted table";
    return datasetStore().create(tenant, { name, filename: "pasted.csv", bytes: Buffer.from(record.csv, "utf8") });
  }
  throw new ApiError("invalid_request", "datasetId (or a pasted csv) is required", 400);
}

function requireLive(workspaceId: string): ReturnType<typeof loadSettings> {
  const settings = loadSettings(workspaceId);
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    throw new ApiError("runtime_stub", gatewayRequiredMessage("data", localeForRun()), 503);
  }
  return settings;
}

export type DatasetBrief = { text: string; withheld: string | null };

function columnLines(dataset: LoadedDataset): string {
  return dataset.columns
    .map(
      (column) =>
        `- ${column.identifier} (${column.type})${column.identifier !== column.name ? ` = "${column.name}"` : ""}`,
    )
    .join("\n");
}

/**
 * What the model sees about the dataset. Cell text (top values, sample rows, headers) is
 * untrusted third-party content, so it passes the same injection guard as pasted source
 * material; on a hit the numeric profile stays and the text parts are withheld.
 */
export function datasetBrief(dataset: LoadedDataset, options: { injectionGuardBypass?: boolean } = {}): DatasetBrief {
  const head = `Dataset: ${dataset.name} (${dataset.rows} rows x ${dataset.cols} columns), table \`${DATASET_TABLE}\`.`;
  const full = [
    head,
    "Columns (SQL identifier, type, original header):",
    columnLines(dataset),
    "",
    "Profile:",
    profileToMarkdown(dataset.profile),
    "",
    `First ${SAMPLE_ROWS} rows (original headers):`,
    tableSample(dataset.table, SAMPLE_ROWS),
  ].join("\n");
  const hit = options.injectionGuardBypass ? null : scanInjection(full);
  if (!hit) {
    return { text: full, withheld: null };
  }
  const numericOnly = {
    ...dataset.profile,
    columns: dataset.profile.columns.map((column) => ({ ...column, topK: [] })),
  };
  const reduced = [
    head,
    "Columns (SQL identifier, type):",
    dataset.columns.map((column) => `- ${column.identifier} (${column.type})`).join("\n"),
    "",
    "Profile (numeric only):",
    profileToMarkdown(numericOnly),
    "",
    `Sample rows and top values were withheld by the injection guard (rule: ${hit.rule}). Query the table instead of guessing.`,
  ].join("\n");
  return { text: reduced, withheld: hit.rule };
}

function summaryOf(dataset: LoadedDataset): DatasetSummary {
  const { table: _table, typed: _typed, profile: _profile, db: _db, runner: _runner, ...summary } = dataset;
  return summary;
}

function persistAnalysis(
  tenant: TenantContext,
  analysis: DataAnalysis,
  markdown: string,
  meta: Record<string, unknown>,
): string | null {
  try {
    return artifactStore().create(tenant, {
      mode: "data",
      kind: "analysis",
      title: analysis.title,
      mime: "text/markdown",
      body: markdown,
      meta,
    }).id;
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal_error";
    log.warn("data_analysis_not_saved", { code });
    return null;
  }
}

export async function analyzeDataset(
  tenant: TenantContext,
  body: unknown,
  emit: JobEmitter = NO_EMIT,
  abortSignal?: AbortSignal,
): Promise<DataAnalysisResult> {
  const question = readPrompt(body);
  const settings = requireLive(tenant.workspaceId);
  const history = readHistory(body);
  const extra = readSourceText(body, { injectionGuardBypass: settings.injectionGuardBypass === true });
  const catalog = listSelectableModels();
  const { defaults } = modeCatalogPayload();
  const model = resolveChatModel(readOptionalModel(body), settings.researchGenModel || defaults.data, catalog);

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "profiling", label: "Profiling the dataset" });
  const dataset = resolveDataset(tenant, body);
  const brief = datasetBrief(dataset, { injectionGuardBypass: settings.injectionGuardBypass === true });
  if (brief.withheld) {
    emit({
      type: "job.step",
      phase: "profiling",
      label: `Sample rows withheld by the injection guard (${brief.withheld})`,
    });
  }
  const previous = history.map((item) => `Q: ${item.question}\nA (summary): ${item.summary}`).join("\n\n");
  const prompt = [
    brief.text,
    previous ? `Earlier questions on this dataset:\n${previous}` : null,
    extra ? `Extra context from the user:\n${extra}` : null,
    `Question:\n${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "analyzing", label: "Querying with SQL" });
  const steps = { used: 0 };
  const onQuery = (sqlText: string, output: SqlToolOutput) => {
    const detail = output.success
      ? `${output.rowCount} row${output.rowCount === 1 ? "" : "s"}`
      : `failed: ${output.error}`;
    emit({ type: "job.step", phase: "analyzing", label: sqlText, detail, current: steps.used, total: SQL_STEP_CAP });
  };
  const release = dataset.runner.acquire();
  let analysis: DataAnalysis;
  try {
    const query = (sqlText: string) => dataset.runner.query(sqlText);
    const raw = await withActiveDataset({ id: dataset.id, query, steps, stepCap: SQL_STEP_CAP, onQuery }, () =>
      collectJobAssistantText({
        tenant,
        model,
        systemPrompt: withOutputLanguage(DATA_SYSTEM, "data", localeForRun()),
        runPrefix: "data",
        agentId: "data",
        jobMode: "data",
        versionId: "data-analysis",
        prompt,
        toolKeys: ["run_sql", "calculator"],
      }),
    );
    if (!raw.trim()) {
      throw new ApiError("generation_failed", modeMessage("emptyAnalysis", localeForRun()), 502);
    }

    throwIfJobAborted(abortSignal);
    emit({ type: "job.phase", phase: "verifying", label: "Re-running evidence queries" });
    analysis = await materializeAnalysis(parseAnalysisDraft(raw), query);
  } finally {
    release();
  }

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "saving", label: "Saving analysis" });
  const markdown = dataAnalysisToMarkdown(analysis);
  const artifactId = persistAnalysis(tenant, analysis, markdown, {
    question,
    model,
    datasetId: dataset.id,
    datasetName: dataset.name,
    queries: steps.used,
  });
  if (artifactId) {
    await upsertWorkSource(
      tenant,
      artifactWorkCard({ type: "Data", artifactId, title: analysis.title, prompt: question, markdown, model }),
    );
  }
  return { analysis, artifactId, dataset: summaryOf(dataset), markdown };
}
