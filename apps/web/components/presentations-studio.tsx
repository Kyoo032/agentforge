"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "@/lib/nav";
import { SourceMaterialField } from "@/components/source-material-field";
import { subscribeModeHandoff } from "@/lib/mode-handoff";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ExampleGallery } from "@/components/example-gallery";
import { ModeHeader } from "@/components/mode-header";
import { ModeIcon } from "@/components/mode-icons";
import { ModelSelect } from "@/components/model-select";
import type { JobRegenSubmit } from "@/components/job-regen-panel";
import { PresentationPreview } from "@/components/presentation-preview";
import { getLocale, t } from "@/lib/i18n";
import type { PresentationOutline } from "@/lib/presentation-outline";
import { presentationStarters } from "@/lib/job-starters";
import { useJobModel } from "@/lib/use-job-model";
import { modelPickBody, regenModelPick, studioModelPick } from "@/lib/model-choice";
import { apiFetch, isElectron } from "@/lib/api-client";

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

export function PresentationsStudio() {
  const { models, model, pinned: modelPinned, setModel } = useJobModel("presentations");
  const [prompt, setPrompt] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceTitle, setSourceTitle] = useState<string | null>(null);
  const [outline, setOutline] = useState<PresentationOutline | null>(null);
  const [busy, setBusy] = useState<"generate" | "download" | "regen" | null>(null);
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeModeHandoff("presentations", (handoff) => {
        setSourceText(handoff.sourceText);
        setSourceTitle(handoff.title ?? null);
        setPrompt(handoff.prompt);
        setError(null);
      }),
    [],
  );

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    const topic = prompt.trim();
    if (!topic || busy) {
      return;
    }
    setBusy("generate");
    setError(null);
    try {
      const res = await apiFetch("/api/v1/presentations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: topic,
          // Only a deliberate pick travels as pinned: a seeded default stays rescuable by the host's fallback.
          ...modelPickBody(studioModelPick(model, modelPinned)),
          sourceText: sourceText.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, t("presentation.generateError")));
      }
      setOutline(data as PresentationOutline);
    } catch (err) {
      setOutline(null);
      setError(err instanceof Error ? err.message : t("presentation.generateError"));
    } finally {
      setBusy(null);
    }
  }

  async function onRegenerate(index: number, payload: JobRegenSubmit) {
    if (!outline || busy) {
      return;
    }
    setBusy("regen");
    setRegenIndex(index);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/presentations/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outline,
          slideIndex: index,
          prompt,
          instruction: payload.instruction || undefined,
          ...modelPickBody(regenModelPick(payload.model, model, modelPinned)),
          attachments: payload.attachments.length > 0 ? payload.attachments : undefined,
          sourceText: sourceText.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, t("presentation.regenError")));
      }
      setOutline(data as PresentationOutline);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("presentation.regenError"));
    } finally {
      setBusy(null);
      setRegenIndex(null);
    }
  }

  async function onDownload() {
    if (!outline || busy) {
      return;
    }
    setBusy("download");
    setError(null);
    try {
      const res = await apiFetch("/api/v1/presentations/pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(outline),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(errorMessage(data, t("presentation.downloadError")));
      }
      if (isElectron()) {
        // apiFetch already wrote the bytes through the native save dialog; a second, browser-style
        // download here would open the save dialog twice.
        return;
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
      setError(err instanceof Error ? err.message : t("presentation.downloadError"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main data-mode="presentations"
      className="mx-auto flex min-h-full max-w-[var(--content-wide)] flex-col px-6 py-10 text-[var(--text)]"
      data-testid="presentations-studio"
    >
      <ModeHeader
        icon="presentations"
        title={t("presentation.title")}
        outcome={t("presentation.expectedInputs")}
        actions={
          outline ? (
            <button
              type="button"
              onClick={() => void onDownload()}
              disabled={busy !== null}
              className="btn btn-primary rounded-pill px-4"
              data-testid="presentations-download"
            >
              {busy === "download" ? (
                <>
                  {t("presentation.building")}
                  <span className="pulse-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </>
              ) : (
                t("presentation.download")
              )}
            </button>
          ) : null
        }
      />

      {error ? (
        <div
          className="mt-6 rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--danger)]"
          role="alert"
          data-testid="presentations-error"
        >
          {error}
          {/gateway|api key|settings|runtime_stub|live gateway/i.test(error) && !/settings/i.test(error) ? (
            <>
              {" "}
              <Link href="/settings" className="underline">
                {t("presentation.openSettings")}
              </Link>
              .
            </>
          ) : null}
        </div>
      ) : null}

      <ExampleGallery mode="presentations" onSelect={(entry) => setPrompt(entry.prompt)} />

      <div className="mt-8 flex-1">
        {outline ? (
          <div className="enter-rise">
            <PresentationPreview
              outline={outline}
              models={models}
              defaultModel={model}
              regeneratingIndex={regenIndex}
              onRegenerate={(index, payload) => void onRegenerate(index, payload)}
            />
          </div>
        ) : (
          <div
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-10"
            data-testid="presentations-studio-empty"
          >
            <span className="icon-orb icon-orb-lg mx-auto">
              <ModeIcon name="presentations" size={24} strokeWidth={1.75} />
            </span>
            <p className="mt-4 text-center text-sm font-medium text-[var(--text)]">{t("presentation.emptyTitle")}</p>
            <p className="mt-2 text-center text-sm text-[var(--text-2)]">{t("presentation.emptyBody")}</p>
            <div className="mx-auto mt-6 grid max-w-[var(--content-narrow)] gap-3 sm:grid-cols-2">
              {presentationStarters(getLocale()).map((starter, index) => (
                <button
                  key={starter.id}
                  type="button"
                  className="card-live enter-rise px-4 py-3 text-left"
                  style={{ "--i": index } as CSSProperties}
                  onClick={() => {
                    setOutline(starter.outline);
                    setError(null);
                  }}
                  data-testid="presentations-starter"
                >
                  <p className="text-sm font-medium text-[var(--text)]">{starter.label}</p>
                  <p className="mt-1 text-xs text-[var(--text-2)]">{starter.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <form
        className="raise sticky bottom-4 mt-8 space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3"
        onSubmit={(event) => void onGenerate(event)}
        data-testid="presentations-studio-prompt-bar"
      >
        <SourceMaterialField
          value={sourceText}
          onChange={setSourceText}
          title={sourceTitle}
          onTitle={setSourceTitle}
          disabled={busy !== null}
          testIdPrefix="presentations"
        />
        <ModelSelect
          models={models}
          value={model}
          onChange={setModel}
          disabled={busy !== null || models.length === 0}
          testId="presentations-studio-model"
          className="select-field w-full"
        />
        <div className="flex gap-2">
          <EnhancePromptButton
            text={prompt}
            surface="presentations"
            model={model}
            disabled={busy !== null}
            testId="presentations-enhance"
            onApply={setPrompt}
          />
          <input
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="text-field min-w-0 flex-1 outline-none placeholder:text-[var(--text-3)]"
            placeholder={t("presentation.promptPlaceholder")}
            disabled={busy !== null}
            data-testid="presentations-prompt"
            aria-label={t("presentation.promptAria")}
          />
          <button
            type="submit"
            className="btn btn-primary h-8 shrink-0 rounded-pill px-4"
            disabled={busy !== null || !prompt.trim()}
            data-testid="presentations-generate"
          >
            {busy === "generate" ? (
              <>
                {t("presentation.generating")}
                <span className="pulse-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </>
            ) : (
              t("presentation.generate")
            )}
          </button>
        </div>
      </form>
    </main>
  );
}
