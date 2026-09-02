"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ExampleGallery } from "@/components/example-gallery";
import { ModelSelect } from "@/components/model-select";
import { ResearchPreview } from "@/components/research-preview";
import { researchNotesToMarkdown, type ResearchNotes } from "@/lib/research-notes";
import { useJobModel } from "@/lib/use-job-model";

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
  return /gateway|api key|settings|runtime_stub|live gateway|tavily|brave/i.test(message);
}

export function ResearchStudio() {
  const { models, model, setModel } = useJobModel("research");
  const [prompt, setPrompt] = useState("");
  const [notes, setNotes] = useState<ResearchNotes | null>(null);
  const [busy, setBusy] = useState<"generate" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    const topic = prompt.trim();
    if (!topic || busy) {
      return;
    }
    setBusy("generate");
    setError(null);
    try {
      const res = await fetch("/api/v1/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: topic, model: model || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, "Could not generate research notes"));
      }
      setNotes(data as ResearchNotes);
    } catch (err) {
      setNotes(null);
      setError(err instanceof Error ? err.message : "Could not generate research notes");
    } finally {
      setBusy(null);
    }
  }

  function onDownload() {
    if (!notes || busy) {
      return;
    }
    const markdown = researchNotesToMarkdown(notes);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const slug = notes.title.replace(/[^\w\s-]+/g, "").replace(/\s+/g, "-").slice(0, 60) || "research";
    anchor.href = url;
    anchor.download = `${slug}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col px-6 py-10 text-ink" data-testid="research-studio">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Research</h1>
          <p className="mt-2 max-w-xl text-sm text-ink/60">
            Ask a question. Agentforge searches the web, drafts sourced notes, and downloads Markdown.
          </p>
        </div>
        {notes ? (
          <button
            type="button"
            onClick={onDownload}
            disabled={busy !== null}
            className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="research-download"
          >
            Download Markdown
          </button>
        ) : null}
      </div>

      {error ? (
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
          data-testid="research-error"
        >
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
        </div>
      ) : null}

      <ExampleGallery mode="research" onSelect={(entry) => setPrompt(entry.prompt)} />

      <div className="mt-8 flex-1">
        {notes ? (
          <ResearchPreview notes={notes} />
        ) : (
          <div
            className="rounded-2xl border border-mist bg-mist/30 px-4 py-10 text-center"
            data-testid="research-studio-empty"
          >
            <p className="text-lg font-medium">No notes yet</p>
            <p className="mt-2 text-sm text-ink/60">
              Enter a question below. Search uses your Tavily or Brave key from Settings.
            </p>
          </div>
        )}
      </div>

      <form
        className="sticky bottom-4 mt-8 space-y-2 rounded-xl border border-mist bg-paper p-2 shadow-sm"
        onSubmit={(event) => void onGenerate(event)}
        data-testid="research-studio-prompt-bar"
      >
        <ModelSelect
          models={models}
          value={model}
          onChange={setModel}
          disabled={busy !== null || models.length === 0}
          testId="research-studio-model"
          className="w-full rounded-md border border-mist bg-paper px-3 py-2 text-sm text-ink"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="min-w-0 flex-1 rounded-md bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40"
            placeholder="What should we look up?"
            disabled={busy !== null}
            data-testid="research-prompt"
            aria-label="Research question"
          />
          <button
            type="submit"
            className="shrink-0 rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy !== null || !prompt.trim()}
            data-testid="research-generate"
          >
            {busy === "generate" ? "Searching…" : "Generate"}
          </button>
        </div>
      </form>
    </main>
  );
}
