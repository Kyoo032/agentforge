"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { MediaPrice } from "@agentforge/core/media-pricing";
import { Confetti } from "@/components/confetti";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ExampleGallery } from "@/components/example-gallery";
import { ModeHeader } from "@/components/mode-header";
import { MascotSlot } from "@/components/mascot-slot";
import { ModeIllustration } from "@/components/mode-illustration";
import { ModelSelect } from "@/components/model-select";
import { WorkingStatus } from "@/components/working-status";
import { SettingsLinkHint } from "@/components/settings-link-hint";
import { t } from "@/lib/i18n";
import { imageEstimateView, mediaPriceHints } from "@/lib/media-estimate";
import { keepModelChoice } from "@/lib/model-choice";
import { apiFetch, mediaSrc } from "@/lib/api-client";
import { useProductBrand } from "@/lib/product-brand";
import { useDeskNeedsKey } from "@/lib/use-desk-needs-key";

type StudioModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
  /** Provider list price for the cost estimate; null when nobody has transcribed one. */
  price?: MediaPrice | null;
};

type GalleryItem = {
  id: string;
  url: string;
  mime: string;
  createdAt: string;
  prompt?: string;
  aspect?: string;
  model?: string;
};

type GalleryResponse = {
  items: GalleryItem[];
  models: StudioModel[];
  defaultModel: string;
};

const ASPECTS = ["square", "landscape", "portrait"] as const;

export function ImagesStudio() {
  const { gatewayName } = useProductBrand();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [models, setModels] = useState<StudioModel[]>([]);
  const [model, setModel] = useState("");
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>("square");
  const [prompt, setPrompt] = useState("");
  const needsKey = useDeskNeedsKey();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [landed, setLanded] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/v1/images");
      const data = (await response.json().catch(() => ({}))) as GalleryResponse & {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(data.error?.message ?? t("images.loadError"));
        return;
      }
      setItems(data.items ?? []);
      setModels(data.models ?? []);
      // `load` runs again after every generate: keep the model the person chose while it is still listed.
      setModel((current) => keepModelChoice(current, data.models ?? [], data.defaultModel));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("images.loadError"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // List-price estimate. Recomputed from the studio state, never from a live call.
  const estimate = useMemo(() => imageEstimateView({ model, models, aspect }), [model, models, aspect]);
  const modelOptions = useMemo(() => {
    const hints = mediaPriceHints("images", models);
    return models.map((item) => ({ ...item, hint: hints[item.id] }));
  }, [models]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || generating || needsKey) {
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const response = await apiFetch("/api/v1/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), aspect, model: model || undefined }),
      });
      const data = (await response.json().catch(() => ({}))) as GalleryItem & {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(data.error?.message ?? t("images.generateError"));
        return;
      }
      setLanded((count) => count + 1);
      setPrompt("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("images.generateError"));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main
      data-mode="images"
      className="mx-auto flex min-h-full max-w-[var(--content-stage)] flex-col px-6 py-10 text-[var(--text)]"
      data-testid="images-studio"
    >
      <ModeHeader icon="images" title={t("images.title")} outcome={t("images.expectedInputs")} />

      {error ? (
        <div
          className="mt-4 rounded-xl border border-[var(--line)] px-4 py-3 text-sm text-[var(--danger)]"
          role="alert"
          data-testid="images-studio-error"
        >
          {error}
        </div>
      ) : null}

      <ExampleGallery mode="images" onSelect={(entry) => setPrompt(entry.prompt)} />

      <form
        className="raise mt-8 space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3"
        onSubmit={onSubmit}
        data-testid="images-studio-prompt-bar"
      >
        <div className="flex flex-wrap gap-2">
          <select
            className="select-field"
            value={aspect}
            onChange={(event) => setAspect(event.target.value as (typeof ASPECTS)[number])}
            disabled={generating}
            data-testid="images-studio-aspect"
          >
            {ASPECTS.map((id) => (
              <option key={id} value={id}>
                {t(`images.aspect.${id}`)}
              </option>
            ))}
          </select>
          <ModelSelect
            models={modelOptions}
            value={model}
            onChange={setModel}
            disabled={generating || models.length === 0}
            testId="images-studio-model"
            className="select-field min-w-[12rem] flex-1"
          />
        </div>
        {!model || estimate.unknown ? null : (
          <div className="space-y-0.5">
            <p className="text-xs text-[var(--text-2)]" data-testid="images-studio-estimate">
              {estimate.line}
            </p>
            {estimate.compare ? (
              <p className="text-xs text-[var(--text-3)]" data-testid="images-studio-estimate-compare">
                {estimate.compare}
              </p>
            ) : null}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <EnhancePromptButton
            text={prompt}
            surface="images"
            model={model}
            disabled={generating}
            testId="images-enhance"
            onApply={setPrompt}
          />
          <input
            type="text"
            className="text-field min-w-0 flex-1 outline-none placeholder:text-[var(--text-3)]"
            placeholder={t("images.promptPlaceholder")}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={generating}
            data-testid="images-studio-prompt"
          />
          {generating ? <MascotSlot mode="images" placement="beside" busy /> : null}
          <button
            type="submit"
            className={
              needsKey
                ? "inline-flex h-8 shrink-0 items-center rounded-pill bg-[var(--line)] px-4 text-sm text-[var(--text-3)]"
                : "btn btn-primary h-8 shrink-0 rounded-pill px-4"
            }
            disabled={generating || !prompt.trim() || needsKey}
            title={needsKey ? t("images.needsKey", { gateway: gatewayName, settings: t("rail.settings") }) : undefined}
            data-testid="images-studio-submit"
          >
            {generating ? <WorkingStatus label={t("images.generating")} /> : t("images.generate")}
          </button>
          {needsKey && !loading ? (
            <p className="basis-full text-xs text-[var(--text-3)]" data-testid="images-studio-needs-key">
              <SettingsLinkHint i18nKey="images.needsKey" vars={{ gateway: gatewayName }} />
            </p>
          ) : null}
        </div>
      </form>

      <section className="relative mt-8" data-testid="images-studio-gallery">
        {landed > 0 ? <Confetti key={landed} /> : null}
        {loading ? (
          <p className="text-sm text-[var(--text-3)]">{t("images.loadingGallery")}</p>
        ) : items.length === 0 ? (
          <div
            className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center"
            data-testid="images-studio-empty"
          >
            <ModeIllustration mode="images" />
            <p className="mt-4 text-sm font-medium text-[var(--text)]">{t("images.emptyTitle")}</p>
            <p className="mt-2 text-sm text-[var(--text-2)]">{t("images.emptyBody")}</p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 min-[1600px]:grid-cols-3 min-[2400px]:grid-cols-4">
            {items.map((item) => (
              <li key={item.id} className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaSrc(item.url)}
                  alt={item.prompt || t("images.generatedAlt")}
                  className="aspect-square w-full object-cover"
                />
                {item.prompt ? <p className="truncate px-3 py-2 text-xs text-[var(--text-2)]">{item.prompt}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
