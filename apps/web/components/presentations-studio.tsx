"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { PresentationPreview } from "@/components/presentation-preview";
import type { PresentationOutline } from "@/lib/presentation-outline";

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

export function PresentationsStudio() {
  const [prompt, setPrompt] = useState("");
  const [outline, setOutline] = useState<PresentationOutline | null>(null);
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
      const res = await fetch("/api/v1/presentations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: topic }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, "Could not generate the presentation outline"));
      }
      setOutline(data as PresentationOutline);
    } catch (err) {
      setOutline(null);
      setError(err instanceof Error ? err.message : "Could not generate the presentation outline");
    } finally {
      setBusy(null);
    }
  }

  async function onDownload() {
    if (!outline || busy) {
      return;
    }
    setBusy("download");
    setError(null);
    try {
      const res = await fetch("/api/v1/presentations/pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(outline),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(errorMessage(data, "Could not build the PPTX file"));
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "presentation.pptx";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the PPTX file");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col px-6 py-10 text-ink" data-testid="presentations-studio">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Presentation</h1>
          <p className="mt-2 max-w-xl text-sm text-ink/60">
            Describe a topic. Agentforge drafts an outline, shows an HTML preview, and downloads a PPTX.
          </p>
        </div>
        {outline ? (
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={busy !== null}
            className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="presentations-download"
          >
            {busy === "download" ? "Building…" : "Download PPTX"}
          </button>
        ) : null}
      </div>

      {error ? (
        <div
          className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
          data-testid="presentations-error"
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

      <div className="mt-8 flex-1">
        {outline ? (
          <PresentationPreview outline={outline} />
        ) : (
          <div
            className="rounded-2xl border border-mist bg-mist/30 px-4 py-10 text-center"
            data-testid="presentations-studio-empty"
          >
            <p className="text-lg font-medium">No deck yet</p>
            <p className="mt-2 text-sm text-ink/60">
              Enter a topic below. Preview stays in-app; download gives you an editable PPTX.
            </p>
          </div>
        )}
      </div>

      <form
        className="sticky bottom-4 mt-8 flex gap-2 rounded-xl border border-mist bg-paper p-2 shadow-sm"
        onSubmit={(event) => void onGenerate(event)}
        data-testid="presentations-studio-prompt-bar"
      >
        <input
          type="text"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="min-w-0 flex-1 rounded-md bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40"
          placeholder="Describe a presentation…"
          disabled={busy !== null}
          data-testid="presentations-prompt"
          aria-label="Presentation topic"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={busy !== null || !prompt.trim()}
          data-testid="presentations-generate"
        >
          {busy === "generate" ? "Generating…" : "Generate"}
        </button>
      </form>
    </main>
  );
}
