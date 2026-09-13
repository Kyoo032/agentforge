"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "@/lib/nav";
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
];

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
      setLocalError(err instanceof Error ? err.message : "Could not upload that file");
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
      adopt(await createPastedDataset("Pasted table", pasted));
      setPasted("");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not read the pasted text as a table");
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
      setLocalError(err instanceof Error ? err.message : "Could not open that dataset");
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
      setLocalError("Upload a file or paste a table first.");
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
    <main className="px-6 pb-8 pt-6 text-[var(--text)]" data-testid="data-studio">
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h3 className="stage-title mt-2">Data</h3>
          <p className="mt-1.5 max-w-xl text-sm text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">
            Upload a CSV or XLSX, or paste a table. {productName} profiles it, queries it with SQL, and shows every
            number's query. Nothing leaves this machine except the question and the profile.
          </p>
        </div>
      </div>
      {error ? (
        <p className="mb-4 text-sm text-red-700" role="alert" data-testid="data-error">
          {error}
          {needsSettingsHint(error) && !/settings/i.test(error) ? (
            <>
              {" "}
              Open{" "}
              <Link href="/settings" className="underline">
                Settings
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : null}
      <div className="grid items-start gap-5 lg:[grid-template-columns:380px_minmax(0,1fr)]">
        <section className="blueprint space-y-3 p-4" data-testid="data-source">
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
              {loading === "upload" ? "Reading…" : "Upload CSV / XLSX"}
            </button>
            {saved.length > 0 ? (
              <select
                className="input"
                value={dataset?.id ?? ""}
                onChange={(event) => void onOpenSaved(event.target.value)}
                disabled={busy}
                aria-label="Saved datasets"
                data-testid="data-saved"
              >
                <option value="">Saved datasets…</option>
                {saved.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.rows} rows)
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div>
            <label htmlFor="data-csv" className="panel-label">
              Or paste a table
            </label>
            <textarea
              id="data-csv"
              rows={6}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              className="input mt-2 font-mono text-[12px]"
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
              {loading === "paste" ? "Reading…" : "Use pasted table"}
            </button>
          </div>
          {dataset ? (
            <div className="space-y-2" data-testid="data-dataset">
              <p className="text-sm font-medium" data-testid="data-dataset-name">
                {dataset.name}
              </p>
              <p className="text-[12px] text-[color-mix(in_srgb,var(--color-text)_45%,transparent)]">
                {dataset.rows} rows × {dataset.cols} cols · {formatBytes(dataset.sizeBytes)}
              </p>
              <DatasetProfile profile={dataset.profile} testId="data-profile" />
              <button
                type="button"
                className="text-xs underline-offset-2 hover:underline"
                onClick={() => setShowPreview((value) => !value)}
                data-testid="data-preview-toggle"
              >
                {showPreview ? "Hide rows" : "Show first rows"}
              </button>
              {showPreview ? (
                <DataGrid
                  columns={dataset.preview.columns}
                  rows={dataset.preview.rows}
                  maxRows={100}
                  testId="data-preview"
                  caption={`${dataset.preview.total} rows`}
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
            <div className="blueprint px-4 py-8 text-center" data-testid="data-studio-empty">
              <p>{dataset ? "Ask a question about the table." : "Upload or paste a table, then ask a question."}</p>
            </div>
          )}
          <div className="flex flex-col gap-2" data-testid="data-starters">
            {DATA_STARTERS.map((starter) => (
              <button
                key={starter.id}
                type="button"
                className="blueprint p-3 text-left"
                data-testid="data-starter"
                onClick={() => setPrompt(starter.prompt)}
                disabled={busy}
              >
                {starter.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <form
        className="blueprint mt-5 p-4"
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
            <span
              className="text-[12px] text-[color-mix(in_srgb,var(--color-text)_45%,transparent)]"
              data-testid="data-history"
            >
              Follow-up {history.length + 1} on this dataset
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="input min-w-0 flex-1"
            placeholder={dataset ? "Ask a question about the table…" : "Add a table first…"}
            disabled={busy}
            data-testid="data-prompt"
          />
          {job.busy ? (
            <button type="button" className="btn" onClick={job.cancel} data-testid="data-cancel">
              Cancel
            </button>
          ) : null}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !prompt.trim()}
            data-testid="data-generate"
          >
            {job.busy ? "Working…" : "Analyze"}
          </button>
        </div>
      </form>
    </main>
  );
}
