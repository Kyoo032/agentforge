"use client";

import { useMemo, useState, type FormEvent } from "react";
import { DocumentPreview } from "@/components/document-preview";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ModelSelect } from "@/components/model-select";
import type { DocumentDraft } from "@/lib/document-outline";
import { FINANCE_STARTERS } from "@/lib/job-starters";
import { useJobModel } from "@/lib/use-job-model";
import { apiFetch } from "@/lib/api-client";
import { useProductBrand } from "@/lib/product-brand";

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

export function FinanceStudio() {
  const { productName } = useProductBrand();
  const { models, model, setModel } = useJobModel("finance");
  const [prompt, setPrompt] = useState("");
  const [figures, setFigures] = useState("");
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [busy, setBusy] = useState<"generate" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasFigures = useMemo(() => figures.trim().length > 0, [figures]);

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    const brief = prompt.trim();
    if (!brief || busy) {
      return;
    }
    setBusy("generate");
    setError(null);
    const fullPrompt = hasFigures
      ? `${brief}\n\nAttached figures (use only these numbers, never invent figures):\n${figures.trim().slice(0, 4000)}`
      : brief;
    try {
      const res = await apiFetch("/api/v1/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullPrompt, model: model || undefined, job: "finance" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, "Could not compose the finance document"));
      }
      setDraft(data as DocumentDraft);
    } catch (err) {
      setDraft(null);
      setError(err instanceof Error ? err.message : "Could not compose the finance document");
    } finally {
      setBusy(null);
    }
  }

  async function onDownload() {
    if (!draft || busy) {
      return;
    }
    setBusy("download");
    setError(null);
    try {
      const res = await apiFetch("/api/v1/documents/docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(errorMessage(data, "Could not build the DOCX file"));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "finance-document.docx";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the DOCX file");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="px-[30px] pb-10 pt-[26px] text-inkbase" data-testid="finance-studio">
      <div className="kicker">Workspace</div>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h3 className="mt-2 text-[25px]">Finance</h3>
          <p className="mt-1.5 max-w-xl text-sm text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">
            Describe a cash-flow, breakeven, or exposure question and paste your own figures. {productName} will not invent numbers.
          </p>
        </div>
        {draft ? (
          <button type="button" onClick={() => void onDownload()} disabled={busy !== null} className="btn btn-primary ml-auto" data-testid="finance-download">
            Download DOCX
          </button>
        ) : null}
      </div>
      {error ? <p className="mb-4 text-sm text-red-700" data-testid="finance-error">{error}</p> : null}
      <div className="grid items-start gap-5 lg:[grid-template-columns:360px_minmax(0,1fr)]">
        <section className="blueprint p-4" data-testid="finance-figures">
          <label htmlFor="finance-figures-input" className="panel-label">Figures</label>
          <textarea
            id="finance-figures-input"
            rows={8}
            value={figures}
            onChange={(event) => setFigures(event.target.value)}
            className="input mt-2 text-[13px]"
            placeholder="Paste your own numbers…"
            data-testid="finance-figures-input"
          />
        </section>
        <div>
          {draft ? (
            <DocumentPreview draft={draft} testIdPrefix="finance" />
          ) : (
            <div className="blueprint px-4 py-8 text-center" data-testid="finance-studio-empty">
              <p>Pick a starter or write a brief.</p>
            </div>
          )}
          <div className="mt-4 flex flex-col gap-2" data-testid="finance-starters">
            {FINANCE_STARTERS.map((starter) => (
              <button
                key={starter.id}
                type="button"
                className="blueprint p-3 text-left"
                data-testid="finance-starter"
                onClick={() => {
                  setDraft(starter.draft);
                  setError(null);
                }}
              >
                <p className="font-heading font-semibold">{starter.label}</p>
                <p className="mt-1 text-[12px] text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">{starter.description}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
      <form className="blueprint mt-5 p-4" onSubmit={(event) => void onGenerate(event)} data-testid="finance-studio-prompt-bar">
        <div className="mb-2 flex items-center gap-2">
          <EnhancePromptButton text={prompt} surface="finance" model={model} disabled={busy !== null} testId="finance-enhance" onApply={setPrompt} />
          <ModelSelect models={models} value={model} onChange={setModel} disabled={busy !== null} testId="finance-studio-model" />
        </div>
        <div className="flex gap-2">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="input min-w-0 flex-1"
            placeholder="Describe a finance brief…"
            data-testid="finance-prompt"
          />
          <button type="submit" className="btn btn-primary" disabled={busy !== null || !prompt.trim()} data-testid="finance-generate">
            {busy === "generate" ? "Generating…" : "Generate"}
          </button>
        </div>
      </form>
    </main>
  );
}
