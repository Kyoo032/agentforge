"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { MediaPrice } from "@agentforge/core/media-pricing";
import { allowedVideoSeconds, snapVideoSeconds, videoCapabilities } from "@agentforge/core/video-capabilities";
import type { PromptTemplate } from "@agentforge/core/edit";
import { EditPromptTemplates } from "@/components/edit-prompt-templates";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ExampleGallery } from "@/components/example-gallery";
import { VideoExamples } from "@/components/video-examples";
import { ModelSelect } from "@/components/model-select";
import { SettingsLinkHint } from "@/components/settings-link-hint";
import { t } from "@/lib/i18n";
import { mediaPriceHints, videoEstimateView } from "@/lib/media-estimate";
import { apiFetch, mediaSrc } from "@/lib/api-client";
import { useProductBrand } from "@/lib/product-brand";

type StudioModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
  /** Provider list price per second for the cost estimate; null when nobody has transcribed one. */
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
  ready: boolean;
};

const ASPECTS = [
  { id: "16:9", label: "16:9" },
  { id: "9:16", label: "9:16" },
  { id: "1:1", label: "1:1" },
] as const;

const RESOLUTIONS = ["480p", "720p", "1080p"] as const;

export function VideosStudio() {
  const { gatewayName } = useProductBrand();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [models, setModels] = useState<StudioModel[]>([]);
  const [model, setModel] = useState("");
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]["id"]>("16:9");
  const [seconds, setSeconds] = useState<number>(5);
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]>("720p");
  const [prompt, setPrompt] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [stillUrl, setStillUrl] = useState("");
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/v1/videos");
      const data = (await response.json().catch(() => ({}))) as GalleryResponse & {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(data.error?.message ?? t("videos.loadError"));
        setReady(false);
        return;
      }
      setItems(data.items ?? []);
      setModels(data.models ?? []);
      setModel(data.defaultModel || data.models?.[0]?.id || "");
      setReady(Boolean(data.ready));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("videos.loadError"));
      setReady(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const caps = videoCapabilities(model);
  const imageToVideo = caps.imageToVideo;

  useEffect(() => {
    setSeconds((current) => snapVideoSeconds(model, current));
  }, [model]);

  useEffect(() => {
    if (!imageToVideo) {
      setStillUrl("");
    }
  }, [imageToVideo]);

  // List-price estimate. Recomputed whenever model, clip length or resolution changes.
  const estimate = useMemo(
    () =>
      videoEstimateView({
        model,
        models,
        seconds,
        resolution: caps.resolution ? resolution : undefined,
      }),
    [model, models, seconds, resolution, caps.resolution],
  );
  const modelOptions = useMemo(() => {
    const hints = mediaPriceHints("videos", models);
    return models.map((item) => ({ ...item, hint: hints[item.id] }));
  }, [models]);

  function pickTemplate(template: PromptTemplate) {
    setPrompt(template.prompt);
    setAspect(template.aspect);
    setSeconds(snapVideoSeconds(model, template.seconds));
    setTemplateId(template.id);
  }

  function changePrompt(next: string) {
    setPrompt(next);
    setTemplateId(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || generating) {
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const response = await apiFetch("/api/v1/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          aspect,
          model: model || undefined,
          imageUrl: imageToVideo ? stillUrl.trim() || undefined : undefined,
          seconds,
          ...(videoCapabilities(model).resolution ? { resolution } : {}),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as GalleryItem & {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(data.error?.message ?? t("videos.generateError"));
        return;
      }
      setPrompt("");
      setStillUrl("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("videos.generateError"));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col px-6 py-10 text-[var(--text)]" data-testid="videos-studio">
      <h1 className="text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{t("videos.title")}</h1>
      <p className="mt-2 max-w-xl text-sm text-[var(--text-2)]">{t("videos.subtitle")}</p>

      {!ready && !loading ? (
        <div
          className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-2)]"
          data-testid="videos-studio-needs-key"
        >
          <SettingsLinkHint i18nKey="videos.needsKey" vars={{ gateway: gatewayName }} />
        </div>
      ) : null}

      {error ? (
        <div
          className="mt-4 rounded-xl border border-[var(--line)] px-4 py-3 text-sm text-[var(--danger)]"
          role="alert"
          data-testid="videos-studio-error"
        >
          {error}
        </div>
      ) : null}

      <ExampleGallery mode="videos" onSelect={(entry) => setPrompt(entry.prompt)} />

      <VideoExamples onPick={pickTemplate} selectedId={templateId} />

      <form
        className="raise mt-8 space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3"
        onSubmit={onSubmit}
        data-testid="videos-studio-prompt-bar"
      >
        <div className="flex flex-wrap gap-2">
          <select
            className="select-field"
            value={aspect}
            onChange={(event) => setAspect(event.target.value as (typeof ASPECTS)[number]["id"])}
            disabled={generating}
            data-testid="videos-studio-aspect"
          >
            {ASPECTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            className="select-field"
            value={seconds}
            onChange={(event) => setSeconds(Number(event.target.value))}
            disabled={generating || !caps.seconds}
            data-testid="videos-studio-seconds"
          >
            {allowedVideoSeconds(model).map((value) => (
              <option key={value} value={value}>
                {t("videos.seconds", { n: value })}
              </option>
            ))}
          </select>
          <select
            className="select-field disabled:opacity-50"
            value={resolution}
            onChange={(event) => setResolution(event.target.value as (typeof RESOLUTIONS)[number])}
            disabled={generating || !caps.resolution}
            data-testid="videos-studio-resolution"
          >
            {RESOLUTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <ModelSelect
            models={modelOptions}
            value={model}
            onChange={setModel}
            disabled={generating || models.length === 0}
            testId="videos-studio-model"
            className="select-field min-w-[12rem] flex-1"
          />
        </div>
        {!model ? null : estimate.unknown ? (
          <p className="text-xs text-[var(--text-3)]" data-testid="videos-studio-estimate-unknown">
            {estimate.line}
          </p>
        ) : (
          <div className="space-y-0.5">
            <p className="text-xs text-[var(--text-2)]" data-testid="videos-studio-estimate">
              {estimate.line}
            </p>
            {estimate.compare ? (
              <p className="text-xs text-[var(--text-3)]" data-testid="videos-studio-estimate-compare">
                {estimate.compare}
              </p>
            ) : null}
          </div>
        )}
        {imageToVideo ? (
          <input
            type="url"
            className="text-field w-full outline-none placeholder:text-[var(--text-3)]"
            placeholder={t("videos.stillPlaceholder")}
            value={stillUrl}
            onChange={(event) => setStillUrl(event.target.value)}
            disabled={generating}
            data-testid="videos-studio-still"
          />
        ) : model ? (
          <p className="text-xs text-[var(--text-3)]">{t("videos.textToVideoOnly")}</p>
        ) : null}
        <div className="flex gap-2">
          <EnhancePromptButton text={prompt} surface="videos" model={model} disabled={generating} testId="videos-enhance" onApply={setPrompt} />
          <input
            type="text"
            className="text-field min-w-0 flex-1 outline-none placeholder:text-[var(--text-3)]"
            placeholder={t("videos.promptPlaceholder")}
            value={prompt}
            onChange={(event) => changePrompt(event.target.value)}
            disabled={generating}
            data-testid="videos-studio-prompt"
          />
          <button
            type="submit"
            className="shrink-0 wash inline-flex h-8 items-center rounded-pill bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--surface)] disabled:opacity-45"
            disabled={generating || !ready || !prompt.trim()}
            data-testid="videos-studio-submit"
          >
            {generating ? t("videos.generating") : t("videos.generate")}
          </button>
        </div>
        <EditPromptTemplates onPick={pickTemplate} selectedId={templateId} />
      </form>

      <section className="mt-8" data-testid="videos-studio-gallery">
        {loading ? (
          <p className="text-sm text-[var(--text-3)]">{t("videos.loadingGallery")}</p>
        ) : items.length === 0 ? (
          <div
            className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center"
            data-testid="videos-studio-empty"
          >
            <p className="text-sm font-medium text-[var(--text)]">{t("videos.emptyTitle")}</p>
            <p className="mt-2 text-sm text-[var(--text-2)]">{t("videos.emptyBody")}</p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id} className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
                <video src={mediaSrc(item.url)} controls className="aspect-video w-full bg-black object-contain" />
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  {item.prompt ? <p className="min-w-0 truncate text-xs text-[var(--text-2)]">{item.prompt}</p> : <span />}
                  <a
                    href={mediaSrc(item.url)}
                    download={`agentforge-video-${item.id}.mp4`}
                    className="shrink-0 text-xs underline text-[var(--text-2)]"
                    data-testid="videos-studio-download"
                  >
                    {t("videos.download")}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
