"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@/lib/nav";
import { Confetti } from "@/components/confetti";
import { DocumentPreview } from "@/components/document-preview";
import { MascotSlot } from "@/components/mascot-slot";
import { ModeIllustration } from "@/components/mode-illustration";
import { SourceMaterialField } from "@/components/source-material-field";
import { WorkingStatus } from "@/components/working-status";
import { subscribeModeHandoff } from "@/lib/mode-handoff";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ExampleGallery } from "@/components/example-gallery";
import { ModelSelect } from "@/components/model-select";
import { ModeHeader } from "@/components/mode-header";
import type { JobRegenSubmit } from "@/components/job-regen-panel";
import type { DocumentDraft } from "@/lib/document-outline";
import { documentStarters } from "@/lib/job-starters";
import { t } from "@/lib/i18n";
import { useJobModel } from "@/lib/use-job-model";
import { modelPickBody, regenModelPick, studioModelPick } from "@/lib/model-choice";
import { apiFetch, isElectron } from "@/lib/api-client";
import { useDeskNeedsKey } from "@/lib/use-desk-needs-key";

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
  const needsKey = useDeskNeedsKey();
  const { models, model, pinned: modelPinned, setModel } = useJobModel("documents");
  const [prompt, setPrompt] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceTitle, setSourceTitle] = useState<string | null>(null);
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [busy, setBusy] = useState<"generate" | "download" | "regen" | null>(null);
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [landed, setLanded] = useState(0);

  function showStarter(next: DocumentDraft) {
    setDraft(next);
  }

  function landDraft(next: DocumentDraft) {
    setDraft(next);
    setLanded((count) => count + 1);
  }

  useEffect(
    () =>
      subscribeModeHandoff("documents", (handoff) => {
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
    if (!topic || busy || needsKey) {
      return;
    }
    setBusy("generate");
    setError(null);
    try {
      const res = await apiFetch("/api/v1/documents", {
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
        throw new Error(errorMessage(data, t("documents.errors.generate")));
      }
      landDraft(data as DocumentDraft);
    } catch (err) {
      setDraft(null);
      setError(err instanceof Error ? err.message : t("documents.errors.generate"));
    } finally {
      setBusy(null);
    }
  }

  async function onRegenerate(index: number, payload: JobRegenSubmit) {
    if (!draft || busy) {
      return;
    }
    setBusy("regen");
    setRegenIndex(index);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/documents/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          sectionIndex: index,
          prompt,
          instruction: payload.instruction || undefined,
          ...modelPickBody(regenModelPick(payload.model, model, modelPinned)),
          attachments: payload.attachments.length > 0 ? payload.attachments : undefined,
          sourceText: sourceText.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(data, t("documents.errors.regen")));
      }
      setDraft(data as DocumentDraft);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("documents.errors.regen"));
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
      const res = await apiFetch("/api/v1/documents/docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(errorMessage(data, t("documents.errors.docx")));
      }
      if (isElectron()) {
        // apiFetch already wrote the bytes through the native save dialog; a second, browser-style
        // download here would open the save dialog twice.
        return;
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
      setError(err instanceof Error ? err.message : t("documents.errors.docx"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main
      data-mode="documents"
      className="mx-auto flex min-h-full w-full max-w-[var(--content-wide)] flex-col px-6 py-10 text-[var(--text)]"
      data-testid="documents-studio"
    >
      <ModeHeader
        icon="documents"
        title={t("documents.title")}
        outcome={t("documents.expectedInputs")}
        actions={
          draft ? (
            <button
              type="button"
              onClick={() => void onDownload()}
              disabled={busy !== null}
              className="btn btn-primary rounded-pill px-4"
              data-testid="documents-download"
            >
              {busy === "download" ? <WorkingStatus label={t("documents.building")} /> : t("documents.download")}
            </button>
          ) : null
        }
      />

      {error ? (
        <div
          className="mt-6 rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--danger)]"
          role="alert"
          data-testid="documents-error"
        >
          {needsSettingsHint(error)}
          {/gateway|api key|settings|runtime_stub|live gateway/i.test(error) && !/settings/i.test(error) ? (
            <>
              {" "}
              {t("documents.openSettingsLead")}{" "}
              <Link href="/settings" className="underline">
                {t("documents.settings")}
              </Link>
              .
            </>
          ) : null}
        </div>
      ) : null}

      <ExampleGallery mode="documents" onSelect={(entry) => setPrompt(entry.prompt)} />

      <div className="mt-8 flex-1">
        {draft ? (
          <div className="relative">
            {landed > 0 ? <Confetti key={landed} /> : null}
            <DocumentPreview
              draft={draft}
              models={models}
              defaultModel={model}
              regeneratingIndex={regenIndex}
              onRegenerate={(index, payload) => void onRegenerate(index, payload)}
            />
          </div>
        ) : (
          <div
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-10"
            data-testid="documents-studio-empty"
          >
            <ModeIllustration mode="documents" />
            <p className="mt-4 text-center text-sm font-medium text-[var(--text)]">{t("documents.emptyTitle")}</p>
            <p className="mt-2 text-center text-sm text-[var(--text-2)]">{t("documents.emptyHint")}</p>
            <div className="mx-auto mt-6 grid max-w-[var(--content-narrow)] gap-3 sm:grid-cols-2">
              {documentStarters().map((starter) => (
                <button
                  key={starter.id}
                  type="button"
                  className="wash rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left hover:bg-[var(--accent-soft)]"
                  onClick={() => {
                    showStarter(starter.draft);
                    setError(null);
                  }}
                  data-testid="documents-starter"
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
        data-testid="documents-studio-prompt-bar"
      >
        <SourceMaterialField
          value={sourceText}
          onChange={setSourceText}
          title={sourceTitle}
          onTitle={setSourceTitle}
          disabled={busy !== null}
          testIdPrefix="documents"
        />
        <ModelSelect
          models={models}
          value={model}
          onChange={setModel}
          disabled={busy !== null || models.length === 0}
          testId="documents-studio-model"
          className="h-8 w-full rounded-lg border border-[var(--line)] bg-transparent px-2 text-xs text-[var(--text-2)] wash"
        />
        <div className="flex flex-wrap gap-2">
          <EnhancePromptButton
            text={prompt}
            surface="documents"
            model={model}
            disabled={busy !== null}
            testId="documents-enhance"
            onApply={setPrompt}
          />
          <input
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="text-field min-w-0 flex-1 outline-none placeholder:text-[var(--text-3)]"
            placeholder={t("documents.placeholder")}
            disabled={busy !== null}
            data-testid="documents-prompt"
            aria-label={t("documents.topicAria")}
          />
          {busy === "generate" ? <MascotSlot mode="documents" placement="beside" busy phase="drafting" /> : null}
          <button
            type="submit"
            className={
              needsKey
                ? "inline-flex h-8 shrink-0 items-center rounded-pill bg-[var(--line)] px-4 text-sm text-[var(--text-3)]"
                : "wash inline-flex h-8 shrink-0 items-center rounded-pill bg-[var(--accent)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-45"
            }
            disabled={busy !== null || !prompt.trim() || needsKey}
            title={needsKey ? t("documents.needsKeyQuiet") : undefined}
            data-testid="documents-generate"
          >
            {busy === "generate" ? <WorkingStatus label={t("documents.generating")} /> : t("documents.generate")}
          </button>
          {needsKey ? (
            <p className="basis-full text-xs text-[var(--text-3)]" data-testid="documents-needs-key">
              {t("documents.needsKeyQuiet")}
            </p>
          ) : null}
        </div>
      </form>
    </main>
  );
}
