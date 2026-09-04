"use client";

import { useMemo, useState, type FormEvent } from "react";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ModelSelect } from "@/components/model-select";
import { ResearchPreview } from "@/components/research-preview";
import { researchNotesToMarkdown, type ResearchNotes } from "@/lib/research-notes";
import { csvSample, parseCsv } from "@/lib/parse-csv";
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

const DATA_STARTERS = [
  {
    id: "vendor-concentration",
    label: "Vendor concentration",
    prompt:
      "Analyze the attached spend/vendor table for concentration: top vendors by share of total, whether any single vendor exceeds 30% of spend, and where switching leverage exists.",
  },
  {
    id: "anomaly-scan",
    label: "Anomaly scan",
    prompt:
      "Scan the attached dataset for anomalies: duplicate key rows, values far outside the column distribution, negatives where impossible, and missing cells.",
  },
];

export function DataStudio() {
  const { productName } = useProductBrand();
  const { models, model, setModel } = useJobModel("data");
  const [prompt, setPrompt] = useState("");
  const [csvText, setCsvText] = useState("vendor,spend\nAcme,12000\nBeta,4100\nGamma,800\n");
  const [notes, setNotes] = useState<ResearchNotes | null>(null);
  const [busy, setBusy] = useState<"generate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const table = useMemo(() => (csvText.trim() ? parseCsv(csvText) : null), [csvText]);

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || busy) {
      return;
    }
    if (!table) {
      setError("Paste a parseable CSV table before generating.");
      return;
    }
    setBusy("generate");
    setError(null);
    try {
      const res = await apiFetch("/api/v1/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question, csv: csvSample(table), model: model || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, "Could not analyze the data"));
      }
      setNotes(data as ResearchNotes);
    } catch (err) {
      setNotes(null);
      setError(err instanceof Error ? err.message : "Could not analyze the data");
    } finally {
      setBusy(null);
    }
  }

  function onDownload() {
    if (!notes) {
      return;
    }
    const blob = new Blob([researchNotesToMarkdown(notes)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "data-analysis.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="px-[30px] pb-10 pt-[26px] text-inkbase" data-testid="data-studio">
      <div className="kicker">Workspace</div>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h3 className="mt-2 text-[25px]">Data</h3>
          <p className="mt-1.5 max-w-xl text-sm text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]">
            Paste a CSV, then ask a question. {productName} reads the sample — it does not search the web.
          </p>
        </div>
        {notes ? (
          <button type="button" onClick={onDownload} className="btn btn-primary ml-auto" data-testid="data-download">
            Download Markdown
          </button>
        ) : null}
      </div>
      {error ? <p className="mb-4 text-sm text-red-700" data-testid="data-error">{error}</p> : null}
      <div className="grid items-start gap-5 lg:[grid-template-columns:360px_minmax(0,1fr)]">
        <section className="blueprint p-4">
          <label htmlFor="data-csv" className="panel-label">CSV</label>
          <textarea
            id="data-csv"
            rows={10}
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
            className="input mt-2 font-mono text-[12px]"
            data-testid="data-csv"
          />
          <p className="mt-2 text-[11px] text-[color-mix(in_srgb,var(--color-text)_45%,transparent)]">
            {table ? `${table.rows.length} rows × ${table.headers.length} cols` : "Not a parseable table yet"}
          </p>
        </section>
        <div>
          {notes ? (
            <ResearchPreview notes={notes} />
          ) : (
            <div className="blueprint px-4 py-8 text-center" data-testid="data-studio-empty">
              <p>Paste a table, then generate.</p>
            </div>
          )}
          <div className="mt-4 flex flex-col gap-2" data-testid="data-starters">
            {DATA_STARTERS.map((starter) => (
              <button
                key={starter.id}
                type="button"
                className="blueprint p-3 text-left"
                data-testid="data-starter"
                onClick={() => setPrompt(starter.prompt)}
              >
                {starter.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <form className="blueprint mt-5 p-4" onSubmit={(event) => void onGenerate(event)} data-testid="data-studio-prompt-bar">
        <div className="mb-2 flex items-center gap-2">
          <EnhancePromptButton text={prompt} surface="data" model={model} disabled={busy !== null} testId="data-enhance" onApply={setPrompt} />
          <ModelSelect models={models} value={model} onChange={setModel} disabled={busy !== null} testId="data-studio-model" />
        </div>
        <div className="flex gap-2">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="input min-w-0 flex-1"
            placeholder="Ask a question about the table…"
            data-testid="data-prompt"
          />
          <button type="submit" className="btn btn-primary" disabled={busy !== null || !prompt.trim()} data-testid="data-generate">
            {busy === "generate" ? "Analyzing…" : "Generate"}
          </button>
        </div>
      </form>
    </main>
  );
}
