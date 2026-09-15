"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArtifactActions } from "@/components/artifact-actions";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { FinanceBriefView } from "@/components/finance-brief-view";
import { JobProgressList } from "@/components/job-progress";
import type { JobRegenSubmit } from "@/components/job-regen-panel";
import { LineItemEditor } from "@/components/line-item-editor";
import { ModelSelect } from "@/components/model-select";
import { apiFetch } from "@/lib/api-client";
import { listDatasets, type DatasetSummary } from "@/lib/data-client";
import { briefLooksLikeFigures, parseFailureMessage } from "@/lib/finance-brief";
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
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";
import { SettingsLinkHint } from "@/components/settings-link-hint";

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
  const [busy, setBusy] = useState<"parse" | "autoParse" | "download" | "regen" | null>(null);
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const error = localError ?? job.error?.message ?? null;
  const locked = job.busy || busy !== null;
  const confirmedItems = usableLineItems(items);
  const ready = source.kind === "dataset" || confirmedItems.length > 0;
  const generateLabel =
    busy === "autoParse" ? t("finance.autoParsing") : job.busy ? t("finance.generating") : t("finance.generate");

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
    setNotice(null);
    job.reset();
    try {
      const parsed = await parseFigures(figures, model);
      setItems(parsed);
      setSource({ kind: "items" });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t("finance.errors.parse"));
    } finally {
      setBusy(null);
    }
  }

  /** Brief-only figures: read them into rows and stop; the owner confirms rows before anything is computed. */
  async function autoParseBrief(brief: string) {
    setBusy("autoParse");
    setLocalError(null);
    setNotice(null);
    job.reset();
    try {
      const parsed = await parseFigures(brief, model);
      if (parsed.length === 0) {
        setLocalError(t("finance.errors.addItems"));
        return;
      }
      setItems(parsed);
      setSource({ kind: "items" });
      setNotice(t("finance.autoParsed", { n: parsed.length }));
    } catch (err) {
      setLocalError(parseFailureMessage(err, t("finance.errors.parse"), t("finance.errors.addItems")));
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
      if (briefLooksLikeFigures(brief)) {
        await autoParseBrief(brief);
        return;
      }
      setNotice(null);
      setLocalError(t("finance.errors.addItems"));
      return;
    }
    setLocalError(null);
    setNotice(null);
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
        throw new Error(errorMessage(data, t("finance.errors.regen")));
      }
      // The saved artifact still holds the pre-rewrite brief; drop the id so downloads use the current markdown.
      setResult(data as FinanceResult);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t("finance.errors.regen"));
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
      setLocalError(err instanceof Error ? err.message : t("finance.errors.docx"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="px-6 pb-10 pt-8 text-[var(--text)]" data-testid="finance-studio">
      <div className="kicker">{t("finance.kicker")}</div>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h3 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{t("finance.title")}</h3>
          <p className="mt-1.5 max-w-xl text-sm text-[var(--text-2)]">{t("finance.subtitle", { productName })}</p>
        </div>
        {result ? (
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={locked}
            className="btn btn-primary ml-auto"
            data-testid="finance-download-docx"
          >
            {busy === "download" ? t("finance.downloading") : t("finance.download")}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="mb-4 text-sm text-[var(--danger)]" role="alert" data-testid="finance-error">
          {error}
          {needsSettingsHint(error) && !/settings/i.test(error) ? (
            <>
              {" "}
              <SettingsLinkHint i18nKey="finance.openSettings" />
            </>
          ) : null}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 text-sm text-[var(--text-2)]" role="status" data-testid="finance-auto-parsed">
          {notice}
        </p>
      ) : null}
      <div className="grid items-start gap-5 lg:[grid-template-columns:420px_minmax(0,1fr)]">
        <section
          className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
          data-testid="finance-inputs"
        >
          <div>
            <label htmlFor="finance-figures-input" className="panel-label">
              {t("finance.pasteFigures")}
            </label>
            <textarea
              id="finance-figures-input"
              rows={5}
              value={figures}
              onChange={(event) => setFigures(event.target.value)}
              className="input mt-2 text-[13px]"
              placeholder={t("finance.figuresPlaceholder")}
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
              {busy === "parse" ? t("finance.parsing") : t("finance.parse")}
            </button>
            <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.parseHint")}</p>
          </div>
          {datasets.length > 0 ? (
            <div>
              <label htmlFor="finance-dataset" className="panel-label">
                {t("finance.orDataset")}
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
                <option value="">{t("finance.lineItemsBelow")}</option>
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {t("finance.datasetOption", { name: dataset.name, rows: dataset.rows })}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <p className="panel-label">
              {confirmedItems.length > 0
                ? t("finance.lineItemsCount", { count: confirmedItems.length })
                : t("finance.lineItems")}
              {source.kind === "dataset" ? t("finance.fromDataset") : ""}
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
            <p className="panel-label">{t("finance.parameters")}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {FINANCE_PARAM_FIELDS.map((field) => (
                <label
                  key={field.key}
                  className="text-xs text-[var(--text-2)]"
                  title={labeled(`finance.params.${field.key}Hint`, field.hint)}
                >
                  {labeled(`finance.params.${field.key}`, field.label)}
                  <input
                    type="number"
                    step="any"
                    className="input mt-1 px-2 py-1 text-xs"
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
            <div
              className="wash rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-8 text-center text-[var(--text-2)]"
              data-testid="finance-studio-empty"
            >
              <p>{ready ? t("finance.emptyReady") : t("finance.emptyWait")}</p>
            </div>
          )}
        </div>
      </div>
      <form
        className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
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
            placeholder={t("finance.promptPlaceholder")}
            disabled={locked}
            data-testid="finance-prompt"
          />
          {job.busy ? (
            <button type="button" className="btn" onClick={job.cancel} data-testid="finance-cancel">
              {t("finance.cancel")}
            </button>
          ) : null}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={locked || !prompt.trim()}
            data-testid="finance-generate"
          >
            {generateLabel}
          </button>
        </div>
      </form>
    </main>
  );
}
