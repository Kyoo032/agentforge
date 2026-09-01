"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { DocumentPreview } from "@/components/document-preview";
import type { DocumentDraft } from "@/lib/document-outline";
import { DOCUMENT_STARTERS } from "@/lib/job-starters";

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

function needsSettingsHint(message: string): string {
  return /gateway|api key|settings|runtime_stub|live gateway/i.test(message) ? message : message;
}

export function DocumentsStudio() {
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [busy, setBusy] = useState<"generate" | "download" | "regen" | null>(null);
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
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
      const res = await fetch("/api/v1/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: topic }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, "Could not generate the document"));
      }
      setDraft(data as DocumentDraft);
    } catch (err) {
      setDraft(null);
      setError(err instanceof Error ? err.message : "Could not generate the document");
    } finally {
      setBusy(null);
    }
  }

  async function onRegenerate(index: number) {
    if (!draft || busy) {
      return;
    }
    setBusy("regen");
    setRegenIndex(index);
    setError(null);
    try {
      const res = await fetch("/api/v1/documents/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, sectionIndex: index, prompt }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, "Could not regenerate that section"));
      }
      setDraft(data as DocumentDraft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not regenerate that section");
    } finally {
      setBusy(null);
      setRegenIndex(null);
    }
  }

  async function onDownload() {
    if (!draft || busy) {
      return;
    }
    setBusy("download");
    setError(null);
    try {
      const res = await fetch("/api/v1/documents/docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(errorMessage(data, "Could not build the DOCX file"));
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "document.docx";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the DOCX file");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col px-6 py-10 text-ink" data-testid="documents-studio">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-2 max-w-xl text-sm text-ink/60">
            Describe a memo, brief, or report. Agentforge drafts sections, shows a preview, and downloads a DOCX.
          </p>
        </div>
        {draft ? (
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={busy !== null}
            className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="documents-download"
          >
            {busy === "download" ? "Building…" : "Download DOCX"}
          </button>
        ) : null}
      </div>

      {error ? (
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
          data-testid="documents-error"
        >
          {needsSettingsHint(error)}
          {/gateway|api key|settings|runtime_stub|live gateway/i.test(error) && !/settings/i.test(error) ? (
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

      <div className="mt-8 flex-1">
        {draft ? (
          <DocumentPreview
            draft={draft}
            regeneratingIndex={regenIndex}
            onRegenerate={(index) => void onRegenerate(index)}
          />
        ) : (
          <div className="rounded-2xl border border-mist bg-mist/30 px-4 py-10" data-testid="documents-studio-empty">
            <p className="text-center text-lg font-medium">No document yet</p>
            <p className="mt-2 text-center text-sm text-ink/60">
              Enter a topic below, or load a starter and download a DOCX without a live generate.
            </p>
            <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
              {DOCUMENT_STARTERS.map((starter) => (
                <button
                  key={starter.id}
                  type="button"
                  className="rounded-xl border border-mist bg-paper px-4 py-3 text-left hover:border-navy"
                  onClick={() => {
                    setDraft(starter.draft);
                    setError(null);
                  }}
                  data-testid="documents-starter"
                >
                  <p className="text-sm font-medium text-ink">{starter.label}</p>
                  <p className="mt-1 text-xs text-ink/60">{starter.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <form
        className="sticky bottom-4 mt-8 flex gap-2 rounded-xl border border-mist bg-paper p-2 shadow-sm"
        onSubmit={(event) => void onGenerate(event)}
        data-testid="documents-studio-prompt-bar"
      >
        <input
          type="text"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="min-w-0 flex-1 rounded-md bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40"
          placeholder="Describe a document…"
          disabled={busy !== null}
          data-testid="documents-prompt"
          aria-label="Document topic"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={busy !== null || !prompt.trim()}
          data-testid="documents-generate"
        >
          {busy === "generate" ? "Generating…" : "Generate"}
        </button>
      </form>
    </main>
  );
}
