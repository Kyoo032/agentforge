"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArtifactActions } from "@/components/artifact-actions";
import { DataAnalysisView } from "@/components/data-analysis-view";
import { DataGrid } from "@/components/data-grid";
import { DatasetProfile } from "@/components/dataset-profile";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { JobProgressList } from "@/components/job-progress";
import { ModelSelect } from "@/components/model-select";
import {
  DATASET_ACCEPT,
  createPastedDataset,
  formatBytes,
  getDataset,
  listDatasets,
  uploadDatasetFile,
  type DataAnalysisResult,
  type DatasetPayload,
  type DatasetSummary,
} from "@/lib/data-client";
import { useJobModel } from "@/lib/use-job-model";
import { useJobStream } from "@/lib/use-job-stream";
import { useProductBrand } from "@/lib/product-brand";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";
import { SettingsLinkHint } from "@/components/settings-link-hint";

const DATA_STARTERS = [
  {
    id: "vendor-concentration",
    label: "Vendor concentration",
    prompt:
      "Analyze this table for concentration: top rows by share of the total, whether any single one exceeds 30%, and where switching leverage exists.",
  },
  {
    id: "anomaly-scan",
    label: "Anomaly scan",
    prompt:
      "Scan this dataset for anomalies: duplicate key rows, values far outside the column distribution, negatives where impossible, and missing cells.",
  },
  {
    id: "trend",
    label: "Trend over time",
    prompt: "If there is a date column, show how the main numeric column moves over time and name the biggest change.",
  },
] as const;

const HISTORY_MAX = 5;

type Shown = { result: DataAnalysisResult };
type HistoryItem = { question: string; summary: string };

function needsSettingsHint(message: string): boolean {
  return /gateway|api key|settings|runtime_stub|live gateway/i.test(message);
}

export function DataStudio() {
  const { productName } = useProductBrand();
  const { models, model, setModel } = useJobModel("data");
  const job = useJobStream<DataAnalysisResult>();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [prompt, setPrompt] = useState("");
  const [pasted, setPasted] = useState("");
  const [dataset, setDataset] = useState<DatasetPayload | null>(null);
  const [saved, setSaved] = useState<DatasetSummary[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [shown, setShown] = useState<Shown | null>(null);
  const [loading, setLoading] = useState<"upload" | "paste" | "open" | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const error = localError ?? job.error?.message ?? null;
  const busy = job.busy || loading !== null;

  useEffect(() => {
    let cancelled = false;
    listDatasets().then(
      (items) => {
        if (!cancelled) {
          setSaved(items);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function adopt(next: DatasetPayload) {
    setDataset(next);
    setHistory([]);
    setShown(null);
    setLocalError(null);
    setSaved((items) => (items.some((item) => item.id === next.id) ? items : [next, ...items]));
  }

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setLoading("upload");
    setLocalError(null);
    try {
      adopt(await uploadDatasetFile(file));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t("data.errors.upload"));
    } finally {
      setLoading(null);
    }
  }

  async function onUsePasted() {
    if (!pasted.trim()) {
      return;
    }
    setLoading("paste");
    setLocalError(null);
    try {
      adopt(await createPastedDataset(t("data.pastedTable"), pasted));
      setPasted("");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t("data.errors.paste"));
    } finally {
      setLoading(null);
    }
  }

  async function onOpenSaved(id: string) {
    if (!id) {
      return;
    }
    setLoading("open");
    setLocalError(null);
    try {
      adopt(await getDataset(id));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t("data.errors.open"));
    } finally {
      setLoading(null);
    }
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || busy) {
      return;
    }
    if (!dataset) {
      setLocalError(t("data.errors.needTable"));
      return;
    }
    setLocalError(null);
    const result = await job.run("/api/v1/data/stream", {
      datasetId: dataset.id,
      prompt: question,
      model: model || undefined,
      history,
    });
    if (result) {
      setShown({ result });
      setHistory((items) => [...items, { question, summary: result.analysis.summary }].slice(-HISTORY_MAX));
      setPrompt("");
    }
  }

  return (
    <main className="mx-auto w-full max-w-[var(--content-wide)] px-6 pb-10 pt-8 text-[var(--text)]" data-testid="data-studio">
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h3 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{t("data.title")}</h3>
          {/* Title plus one outcome line (owner report 2026-09-23). The `lede` paragraph
              moved into the disclosure below and the "workspace" kicker was deleted. */}
          <p className="mt-2 max-w-[var(--content-narrow)] text-sm text-[var(--text-2)]" data-testid="expected-inputs">{t("data.expectedInputs")}</p>
        </div>
      </div>
      {/* Where the profile and the SQL trace come from. Not needed to get started. */}
      <details className="mb-5 rounded-lg border border-[var(--line)] px-3 py-2" data-testid="data-how">
        <summary className="cursor-pointer select-none text-xs font-medium text-[var(--text-2)]">
          {t("data.howItWorks")}
        </summary>
        <p className="mt-2 max-w-[var(--content-narrow)] text-xs text-[var(--text-3)]">{t("data.howItWorksBody", { productName })}</p>
      </details>
      {error ? (
        <p className="mb-4 text-sm text-[var(--danger)]" role="alert" data-testid="data-error">
          {error}
          {needsSettingsHint(error) && !/settings/i.test(error) ? (
            <>
              {" "}
              <SettingsLinkHint i18nKey="data.openSettings" />
            </>
          ) : null}
        </p>
      ) : null}
      <div className="grid items-start gap-5 lg:[grid-template-columns:380px_minmax(0,1fr)]">
        <section
          className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
          data-testid="data-source"
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={DATASET_ACCEPT}
              className="hidden"
              onChange={(event) => void onUpload(event)}
              data-testid="data-file-input"
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              data-testid="data-upload"
            >
              {loading === "upload" ? t("data.reading") : t("data.upload")}
            </button>
            {saved.length > 0 ? (
              <select
                className="input"
                value={dataset?.id ?? ""}
                onChange={(event) => void onOpenSaved(event.target.value)}
                disabled={busy}
                aria-label={t("data.savedAria")}
                data-testid="data-saved"
              >
                <option value="">{t("data.savedPlaceholder")}</option>
                {saved.map((item) => (
                  <option key={item.id} value={item.id}>
                    {t("data.savedOption", { name: item.name, rows: item.rows })}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {/* The optional second way in. The primary input — the upload above — stays open. */}
          <details className="rounded-lg border border-[var(--line)] px-3 py-2" data-testid="data-paste">
            <summary className="cursor-pointer select-none text-xs font-medium text-[var(--text-2)]">
              {t("data.pasteOptional")}
            </summary>
            <div className="mt-2">
              <label htmlFor="data-csv" className="panel-label">
                {t("data.pasteLabel")}
              </label>
              <textarea
                id="data-csv"
                rows={6}
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                className="input mt-2 font-mono text-xs"
                placeholder={"vendor,spend\nAcme,12000\nBeta,4100"}
                disabled={busy}
                data-testid="data-csv"
              />
              <button
                type="button"
                className="btn mt-2"
                onClick={() => void onUsePasted()}
                disabled={busy || !pasted.trim()}
                data-testid="data-use-pasted"
              >
                {loading === "paste" ? t("data.reading") : t("data.usePasted")}
              </button>
            </div>
          </details>
          {dataset ? (
            <div className="space-y-2" data-testid="data-dataset">
              <p className="text-sm font-medium text-[var(--text)]" data-testid="data-dataset-name">
                {dataset.name}
              </p>
              <p className="text-xs text-[var(--text-3)]">
                {t("data.datasetMeta", {
                  rows: dataset.rows,
                  cols: dataset.cols,
                  size: formatBytes(dataset.sizeBytes),
                })}
              </p>
              <DatasetProfile profile={dataset.profile} testId="data-profile" />
              <button
                type="button"
                className="text-xs text-[var(--text-2)] underline-offset-2 hover:underline"
                onClick={() => setShowPreview((value) => !value)}
                data-testid="data-preview-toggle"
              >
                {showPreview ? t("data.hideRows") : t("data.showRows")}
              </button>
              {showPreview ? (
                <DataGrid
                  columns={dataset.preview.columns}
                  rows={dataset.preview.rows}
                  maxRows={100}
                  testId="data-preview"
                  caption={t("data.previewCaption", { total: dataset.preview.total })}
                />
              ) : null}
            </div>
          ) : null}
        </section>
        <div className="space-y-4">
          {job.busy || (job.progress.phases.length > 0 && !shown) ? (
            <JobProgressList progress={job.progress} busy={job.busy} testId="data-progress" />
          ) : null}
          {shown ? (
            <>
              <ArtifactActions
                title={shown.result.analysis.title}
                markdown={shown.result.markdown}
                artifactId={shown.result.artifactId}
                kbType="Analysis"
                disabled={busy}
                testIdPrefix="data"
              />
              <DataAnalysisView analysis={shown.result.analysis} testIdPrefix="data" />
            </>
          ) : job.busy ? null : (
            <div
              className="wash rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-8 text-center text-[var(--text-2)]"
              data-testid="data-studio-empty"
            >
              <p>{dataset ? t("data.emptyAsk") : t("data.emptyUpload")}</p>
            </div>
          )}
          <div className="flex flex-col gap-2" data-testid="data-starters">
            {DATA_STARTERS.map((starter) => (
              <button
                key={starter.id}
                type="button"
                className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-left text-[var(--text)]"
                data-testid="data-starter"
                onClick={() => setPrompt(labeled(`data.starters.${starter.id}.prompt`, starter.prompt))}
                disabled={busy}
              >
                {labeled(`data.starters.${starter.id}.label`, starter.label)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <form
        className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
        onSubmit={(event) => void onGenerate(event)}
        data-testid="data-studio-prompt-bar"
      >
        <div className="mb-2 flex items-center gap-2">
          <EnhancePromptButton
            text={prompt}
            surface="data"
            model={model}
            disabled={busy}
            testId="data-enhance"
            onApply={setPrompt}
          />
          <ModelSelect models={models} value={model} onChange={setModel} disabled={busy} testId="data-studio-model" />
          {history.length > 0 ? (
            <span className="text-xs text-[var(--text-3)]" data-testid="data-history">
              {t("data.followUp", { n: history.length + 1 })}
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="input min-w-0 flex-1"
            placeholder={dataset ? t("data.promptWithTable") : t("data.promptNoTable")}
            disabled={busy}
            data-testid="data-prompt"
          />
          {job.busy ? (
            <button type="button" className="btn" onClick={job.cancel} data-testid="data-cancel">
              {t("data.cancel")}
            </button>
          ) : null}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !prompt.trim()}
            data-testid="data-generate"
          >
            {job.busy ? t("data.working") : t("data.analyze")}
          </button>
        </div>
      </form>
    </main>
  );
}
