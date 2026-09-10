"use client";

import { Link } from "@/lib/nav";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { allowedVideoSeconds, snapVideoSeconds, videoCapabilities } from "@agentforge/core/video-capabilities";
import type { PromptTemplate } from "@agentforge/core/edit";
import { EditPromptTemplates } from "@/components/edit-prompt-templates";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ExampleGallery } from "@/components/example-gallery";
import { VideoExamples } from "@/components/video-examples";
import { ModelSelect } from "@/components/model-select";
import { apiFetch, mediaSrc } from "@/lib/api-client";
import { useProductBrand } from "@/lib/product-brand";

type StudioModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
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
        setError(data.error?.message ?? "Could not load video studio");
        setReady(false);
        return;
      }
      setItems(data.items ?? []);
      setModels(data.models ?? []);
      setModel(data.defaultModel || data.models?.[0]?.id || "");
      setReady(Boolean(data.ready));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load video studio");
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
        setError(data.error?.message ?? "Video generation failed");
        return;
      }
      setPrompt("");
      setStillUrl("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Video generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col px-6 py-10 text-ink" data-testid="videos-studio">
      <h1 className="text-2xl font-semibold tracking-tight">Videos</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/60">Prompt-to-video studio. Clips show in the gallery below.</p>

      {!ready && !loading ? (
        <div
          className="mt-6 rounded-xl border border-mist bg-mist/30 px-4 py-3 text-sm text-ink/70"
          data-testid="videos-studio-needs-key"
        >
          Add a {gatewayName} gateway key in{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>{" "}
          to generate videos.
        </div>
      ) : null}

      {error ? (
        <div
          className="mt-4 rounded-xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
          data-testid="videos-studio-error"
        >
          {error}
        </div>
      ) : null}

      <ExampleGallery mode="videos" onSelect={(entry) => setPrompt(entry.prompt)} />

      <VideoExamples onPick={pickTemplate} selectedId={templateId} />

      <form
        className="mt-8 space-y-3 rounded-xl border border-mist bg-paper p-3 shadow-sm"
        onSubmit={onSubmit}
        data-testid="videos-studio-prompt-bar"
      >
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-md border border-mist bg-paper px-3 py-2 text-sm text-ink"
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
            className="rounded-md border border-mist bg-paper px-3 py-2 text-sm text-ink"
            value={seconds}
            onChange={(event) => setSeconds(Number(event.target.value))}
            disabled={generating || !caps.seconds}
            data-testid="videos-studio-seconds"
          >
            {allowedVideoSeconds(model).map((value) => (
              <option key={value} value={value}>
                {value}s
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-mist bg-paper px-3 py-2 text-sm text-ink disabled:opacity-50"
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
            models={models}
            value={model}
            onChange={setModel}
            disabled={generating || models.length === 0}
            testId="videos-studio-model"
            className="min-w-[12rem] flex-1 rounded-md border border-mist bg-paper px-3 py-2 text-sm text-ink"
          />
        </div>
        {imageToVideo ? (
          <input
            type="url"
            className="w-full rounded-md border border-mist bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40"
            placeholder="Optional still image URL…"
            value={stillUrl}
            onChange={(event) => setStillUrl(event.target.value)}
            disabled={generating}
            data-testid="videos-studio-still"
          />
        ) : model ? (
          <p className="text-xs text-ink/50">This model is text-to-video only</p>
        ) : null}
        <div className="flex gap-2">
          <EnhancePromptButton text={prompt} surface="videos" model={model} disabled={generating} testId="videos-enhance" onApply={setPrompt} />
          <input
            type="text"
            className="min-w-0 flex-1 rounded-md border border-mist bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40"
            placeholder="Describe a video…"
            value={prompt}
            onChange={(event) => changePrompt(event.target.value)}
            disabled={generating}
            data-testid="videos-studio-prompt"
          />
          <button
            type="submit"
            className="shrink-0 rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:bg-navy/40"
            disabled={generating || !ready || !prompt.trim()}
            data-testid="videos-studio-submit"
          >
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>
        <EditPromptTemplates onPick={pickTemplate} selectedId={templateId} />
      </form>

      <section className="mt-8" data-testid="videos-studio-gallery">
        {loading ? (
          <p className="text-sm text-ink/50">Loading gallery…</p>
        ) : items.length === 0 ? (
          <div
            className="rounded-lg border border-mist bg-mist/30 px-4 py-10 text-center"
            data-testid="videos-studio-empty"
          >
            <p className="text-lg font-medium">Nothing here yet</p>
            <p className="mt-2 text-sm text-ink/60">Generate a video to populate this gallery.</p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id} className="overflow-hidden rounded-xl border border-mist bg-paper">
                <video src={mediaSrc(item.url)} controls className="aspect-video w-full bg-black object-contain" />
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  {item.prompt ? <p className="min-w-0 truncate text-xs text-ink/60">{item.prompt}</p> : <span />}
                  <a
                    href={mediaSrc(item.url)}
                    download={`agentforge-video-${item.id}.mp4`}
                    className="shrink-0 text-xs underline text-ink/70"
                    data-testid="videos-studio-download"
                  >
                    Download
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
