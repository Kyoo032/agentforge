"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@/lib/nav";
import { ArtifactActions } from "@/components/artifact-actions";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { FinanceBriefView } from "@/components/finance-brief-view";
import { JobProgressList } from "@/components/job-progress";
import type { JobRegenSubmit } from "@/components/job-regen-panel";
import { LineItemEditor } from "@/components/line-item-editor";
import { ModelSelect } from "@/components/model-select";
import { apiFetch } from "@/lib/api-client";
import { listDatasets, type DatasetSummary } from "@/lib/data-client";
import {
  FINANCE_PARAM_FIELDS,
  downloadFinanceDocx,
  parseFigures,
  usableLineItems,
  type FinanceParams,
  type FinanceResult,
  type LineItem,
} from "@/lib/finance-client";
import { useJobModel } from "@/lib/use-job-model";
import { useJobStream } from "@/lib/use-job-stream";
import { useProductBrand } from "@/lib/product-brand";

type Source = { kind: "items" } | { kind: "dataset"; id: string };

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

function needsSettingsHint(message: string): boolean {
  return /gateway|api key|settings|runtime_stub|live gateway/i.test(message);
}

export function FinanceStudio() {
  const { productName } = useProductBrand();
  const { models, model, setModel } = useJobModel("finance");
  const job = useJobStream<FinanceResult>();
  const [prompt, setPrompt] = useState("");
  const [figures, setFigures] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [params, setParams] = useState<FinanceParams>({});
  const [source, setSource] = useState<Source>({ kind: "items" });
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [result, setResult] = useState<FinanceResult | null>(null);
  const [busy, setBusy] = useState<"parse" | "download" | "regen" | null>(null);
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const error = localError ?? job.error?.message ?? null;
  const locked = job.busy || busy !== null;
  const confirmedItems = usableLineItems(items);
  const ready = source.kind === "dataset" || confirmedItems.length > 0;

  useEffect(() => {
    let cancelled = false;
    listDatasets().then(
      (list) => {
        if (!cancelled) {
          setDatasets(list);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function inputsBody(): Record<string, unknown> {
    return source.kind === "dataset" ? { datasetId: source.id, params } : { items: confirmedItems, params };
  }

  async function onParse() {
    if (!figures.trim() || locked) {
      return;
    }
    setBusy("parse");
    setLocalError(null);
    try {
      const parsed = await parseFigures(figures, model);
      setItems(parsed);
      setSource({ kind: "items" });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not read those figures");
    } finally {
      setBusy(null);
    }
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    const brief = prompt.trim();
    if (!brief || locked) {
      return;
    }
    if (!ready) {
      setLocalError("Add line items first: paste figures and parse them, add rows by hand, or pick a saved dataset.");
      return;
    }
    setLocalError(null);
    const next = await job.run("/api/v1/finance/stream", { prompt: brief, model: model || undefined, ...inputsBody() });
    if (next) {
      setResult(next);
      if (source.kind === "dataset") {
        setItems(next.items);
      }
    }
  }

  async function onRegenerate(index: number, payload: JobRegenSubmit) {
    if (!result || locked) {
      return;
    }
    setBusy("regen");
    setRegenIndex(index);
    setLocalError(null);
    try {
      const res = await apiFetch("/api/v1/finance/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: result.brief,
          sectionIndex: index,
          prompt,
          instruction: payload.instruction || undefined,
          model: payload.model || model || undefined,
          ...inputsBody(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, "Could not rewrite that section"));
      }
      // The saved artifact still holds the pre-rewrite brief; drop the id so downloads use the current markdown.
      setResult(data as FinanceResult);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not rewrite that section");
    } finally {
      setBusy(null);
      setRegenIndex(null);
    }
  }

  async function onDownload() {
    if (!result || locked) {
      return;
    }
    setBusy("download");
    setLocalError(null);
    try {
      await downloadFinanceDocx(result.brief);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not build the DOCX file");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="px-6 pb-8 pt-6 text-[var(--text)]" data-testid="finance-studio">
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h3 className="stage-title mt-2">Finance</h3>
          <p className="mt-1.5 max-w-xl text-sm text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">
            Give {productName} your figures as line items. Margins, growth, runway, breakeven, and NPV are computed in
            code; the model only writes the narrative, and any figure it cannot trace is removed.
          </p>
        </div>
        {result ? (
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={locked}
            className="btn btn-secondary ml-auto"
            data-testid="finance-download"
          >
            {busy === "download" ? "Building…" : "Download DOCX"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="mb-4 text-sm text-red-700" role="alert" data-testid="finance-error">
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
      <div className="grid items-start gap-5 lg:[grid-template-columns:420px_minmax(0,1fr)]">
        <section className="blueprint space-y-4 p-4" data-testid="finance-inputs">
          <div>
            <label htmlFor="finance-figures-input" className="panel-label">
              Paste figures
            </label>
            <textarea
              id="finance-figures-input"
              rows={5}
              value={figures}
              onChange={(event) => setFigures(event.target.value)}
              className="input mt-2 text-[13px]"
              placeholder="Revenue 2025: $120,000. Hosting $30,000. Payroll $100,000. Cash $90,000…"
              disabled={locked}
              data-testid="finance-figures-input"
            />
            <button
              type="button"
              className="btn mt-2"
              onClick={() => void onParse()}
              disabled={locked || !figures.trim()}
              data-testid="finance-parse"
            >
              {busy === "parse" ? "Reading…" : "Parse into line items"}
            </button>
            <p className="mt-1 text-[12px] text-[color-mix(in_srgb,var(--color-text)_45%,transparent)]">
              Nothing is computed until you confirm the rows below.
            </p>
          </div>
          {datasets.length > 0 ? (
            <div>
              <label htmlFor="finance-dataset" className="panel-label">
                Or use a saved dataset
              </label>
              <select
                id="finance-dataset"
                className="input mt-2"
                value={source.kind === "dataset" ? source.id : ""}
                onChange={(event) =>
                  setSource(event.target.value ? { kind: "dataset", id: event.target.value } : { kind: "items" })
                }
                disabled={locked}
                data-testid="finance-dataset"
              >
                <option value="">Line items below</option>
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name} ({dataset.rows} rows)
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <p className="panel-label">
              Line items{confirmedItems.length > 0 ? ` (${confirmedItems.length})` : ""}
              {source.kind === "dataset" ? " — from the dataset" : ""}
            </p>
            <div className="mt-2">
              <LineItemEditor
                items={items}
                onChange={(next) => {
                  setItems(next);
                  setSource({ kind: "items" });
                }}
                disabled={locked}
              />
            </div>
          </div>
          <div>
            <p className="panel-label">Parameters (optional)</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {FINANCE_PARAM_FIELDS.map((field) => (
                <label
                  key={field.key}
                  className="text-[12px] text-[color-mix(in_srgb,var(--color-text)_60%,transparent)]"
                  title={field.hint}
                >
                  {field.label}
                  <input
                    type="number"
                    step="any"
                    className="input mt-1 px-2 py-1 text-[12px]"
                    value={params[field.key] ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setParams((current) => {
                        const { [field.key]: _dropped, ...rest } = current;
                        return value === "" ? rest : { ...rest, [field.key]: Number(value) };
                      });
                    }}
                    disabled={locked}
                    data-testid={`finance-param-${field.key}`}
                  />
                </label>
              ))}
            </div>
          </div>
        </section>
        <div className="space-y-4">
          {job.busy || (job.progress.phases.length > 0 && !result) ? (
            <JobProgressList progress={job.progress} busy={job.busy} testId="finance-progress" />
          ) : null}
          {result ? (
            <>
              <ArtifactActions
                title={result.brief.title}
                markdown={result.markdown}
                artifactId={result.artifactId}
                kbType="Brief"
                disabled={locked}
                testIdPrefix="finance"
              />
              <FinanceBriefView
                brief={result.brief}
                guard={result.guard}
                models={models}
                defaultModel={model}
                regeneratingIndex={regenIndex}
                onRegenerate={(index, payload) => void onRegenerate(index, payload)}
              />
            </>
          ) : job.busy ? null : (
            <div className="blueprint px-4 py-8 text-center" data-testid="finance-studio-empty">
              <p>
                {ready
                  ? "Describe the brief you need."
                  : "Add figures, confirm the line items, then describe the brief."}
              </p>
            </div>
          )}
        </div>
      </div>
      <form
        className="blueprint mt-5 p-4"
        onSubmit={(event) => void onGenerate(event)}
        data-testid="finance-studio-prompt-bar"
      >
        <div className="mb-2 flex items-center gap-2">
          <EnhancePromptButton
            text={prompt}
            surface="finance"
            model={model}
            disabled={locked}
            testId="finance-enhance"
            onApply={setPrompt}
          />
          <ModelSelect
            models={models}
            value={model}
            onChange={setModel}
            disabled={locked}
            testId="finance-studio-model"
          />
        </div>
        <div className="flex gap-2">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="input min-w-0 flex-1"
            placeholder="Describe a finance brief… (cash plan, breakeven, exposure)"
            disabled={locked}
            data-testid="finance-prompt"
          />
          {job.busy ? (
            <button type="button" className="btn" onClick={job.cancel} data-testid="finance-cancel">
              Cancel
            </button>
          ) : null}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={locked || !prompt.trim()}
            data-testid="finance-generate"
          >
            {job.busy ? "Working…" : "Generate"}
          </button>
        </div>
      </form>
    </main>
  );
}
