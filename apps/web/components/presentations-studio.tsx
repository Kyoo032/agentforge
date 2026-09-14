"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@/lib/nav";
import { SourceMaterialField } from "@/components/source-material-field";
import { subscribeModeHandoff } from "@/lib/mode-handoff";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ExampleGallery } from "@/components/example-gallery";
import { ModelSelect } from "@/components/model-select";
import type { JobRegenSubmit } from "@/components/job-regen-panel";
import { PresentationPreview } from "@/components/presentation-preview";
import type { PresentationOutline } from "@/lib/presentation-outline";
import { presentationStarters } from "@/lib/job-starters";
import { freezeLocale, getLocale, t } from "@/lib/i18n";
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

export function PresentationsStudio() {
  const { productName } = useProductBrand();
  const { models, model, setModel } = useJobModel("presentations");
  const [locale, setLocale] = useState(getLocale);
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

  useEffect(() => {
    void apiFetch("/api/v1/settings")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.locale === "id" || payload.locale === "en") {
          freezeLocale(payload.locale);
          setLocale(payload.locale);
        }
      })
      .catch(() => {
        // first boot before SQLite is ready
      });
  }, []);

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
          model: model || undefined,
          sourceText: sourceText.trim() || undefined,
          locale,
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
          model: payload.model || model || undefined,
          attachments: payload.attachments.length > 0 ? payload.attachments : undefined,
          sourceText: sourceText.trim() || undefined,
          locale,
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
        body: JSON.stringify({ ...outline, locale }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(errorMessage(data, t("presentation.downloadError")));
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
    <main
      className="mx-auto flex min-h-full max-w-4xl flex-col px-6 py-10 text-[var(--text)]"
      data-testid="presentations-studio"
      lang={locale}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{t("presentation.title")}</h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--text-2)]">
            {t("presentation.subtitle", { product: productName })}
          </p>
        </div>
        {outline ? (
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={busy !== null}
            className="wash inline-flex h-8 items-center rounded-pill bg-[var(--accent)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-45"
            data-testid="presentations-download"
          >
            {busy === "download" ? t("presentation.building") : t("presentation.download")}
          </button>
        ) : null}
      </div>

      {error ? (
        <div
          className="mt-6 rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--danger)]"
          role="alert"
          data-testid="presentations-error"
        >
          {error}
          {/gateway|api key|settings|runtime_stub|live gateway|pengaturan|kunci api/i.test(error) &&
          !/settings|pengaturan/i.test(error) ? (
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
          <PresentationPreview
            outline={outline}
            models={models}
            defaultModel={model}
            locale={locale}
            regeneratingIndex={regenIndex}
            onRegenerate={(index, payload) => void onRegenerate(index, payload)}
          />
        ) : (
          <div
            className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-10"
            data-testid="presentations-studio-empty"
          >
            <p className="text-center text-sm font-medium text-[var(--text)]">{t("presentation.emptyTitle")}</p>
            <p className="mt-2 text-center text-sm text-[var(--text-2)]">{t("presentation.emptyBody")}</p>
            <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
              {presentationStarters(locale).map((starter) => (
                <button
                  key={starter.id}
                  type="button"
                  className="wash rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left hover:bg-[var(--accent-soft)]"
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
          className="w-full h-8 rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm text-[var(--text)]"
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
            className="min-w-0 flex-1 rounded-lg bg-transparent px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-3)]"
            placeholder={t("presentation.promptPlaceholder")}
            disabled={busy !== null}
            data-testid="presentations-prompt"
            aria-label={t("presentation.promptAria")}
          />
          <button
            type="submit"
            className="wash inline-flex h-8 shrink-0 items-center rounded-pill bg-[var(--accent)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-45"
            disabled={busy !== null || !prompt.trim()}
            data-testid="presentations-generate"
          >
            {busy === "generate" ? t("presentation.generating") : t("presentation.generate")}
          </button>
        </div>
      </form>
    </main>
  );
}
