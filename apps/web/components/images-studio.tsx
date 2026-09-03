"use client";

import { Link } from "@/lib/nav";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ExampleGallery } from "@/components/example-gallery";
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
  { id: "square", label: "Square" },
  { id: "landscape", label: "Landscape" },
  { id: "portrait", label: "Portrait" },
] as const;

export function ImagesStudio() {
  const { gatewayName } = useProductBrand();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [models, setModels] = useState<StudioModel[]>([]);
  const [model, setModel] = useState("");
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]["id"]>("square");
  const [prompt, setPrompt] = useState("");
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
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
        setError(data.error?.message ?? "Could not load image studio");
        setReady(false);
        return;
      }
      setItems(data.items ?? []);
      setModels(data.models ?? []);
      setModel(data.defaultModel || data.models?.[0]?.id || "");
      setReady(Boolean(data.ready));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load image studio");
      setReady(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || generating) {
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
        setError(data.error?.message ?? "Image generation failed");
        return;
      }
      setPrompt("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col px-6 py-10 text-ink" data-testid="images-studio">
      <h1 className="text-2xl font-semibold tracking-tight">Images</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/60">Prompt-to-image studio. Results show in the gallery below.</p>

      {!ready && !loading ? (
        <div
          className="mt-6 rounded-xl border border-mist bg-mist/30 px-4 py-3 text-sm text-ink/70"
          data-testid="images-studio-needs-key"
        >
          Add a {gatewayName} gateway key in{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>{" "}
          to generate images.
        </div>
      ) : null}

      {error ? (
        <div
          className="mt-4 rounded-xl border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
          data-testid="images-studio-error"
        >
          {error}
        </div>
      ) : null}

      <ExampleGallery mode="images" onSelect={(entry) => setPrompt(entry.prompt)} />

      <form
        className="mt-8 space-y-3 rounded-xl border border-mist bg-paper p-3 shadow-sm"
        onSubmit={onSubmit}
        data-testid="images-studio-prompt-bar"
      >
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-md border border-mist bg-paper px-3 py-2 text-sm text-ink"
            value={aspect}
            onChange={(event) => setAspect(event.target.value as (typeof ASPECTS)[number]["id"])}
            disabled={generating}
            data-testid="images-studio-aspect"
          >
            {ASPECTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <ModelSelect
            models={models}
            value={model}
            onChange={setModel}
            disabled={generating || models.length === 0}
            testId="images-studio-model"
            className="min-w-[12rem] flex-1 rounded-md border border-mist bg-paper px-3 py-2 text-sm text-ink"
          />
        </div>
        <div className="flex gap-2">
          <EnhancePromptButton text={prompt} surface="images" model={model} disabled={generating} testId="images-enhance" onApply={setPrompt} />
          <input
            type="text"
            className="min-w-0 flex-1 rounded-md border border-mist bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40"
            placeholder="Describe an image…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={generating}
            data-testid="images-studio-prompt"
          />
          <button
            type="submit"
            className="shrink-0 rounded-md bg-navy px-4 py-2 text-sm font-medium text-white disabled:bg-navy/40"
            disabled={generating || !prompt.trim()}
            data-testid="images-studio-submit"
          >
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>
      </form>

      <section className="mt-8" data-testid="images-studio-gallery">
        {loading ? (
          <p className="text-sm text-ink/50">Loading gallery…</p>
        ) : items.length === 0 ? (
          <div
            className="rounded-lg border border-mist bg-mist/30 px-4 py-10 text-center"
            data-testid="images-studio-empty"
          >
            <p className="text-lg font-medium">Nothing here yet</p>
            <p className="mt-2 text-sm text-ink/60">Generate an image to populate this gallery.</p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id} className="overflow-hidden rounded-xl border border-mist bg-paper">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaSrc(item.url)} alt={item.prompt || "Generated image"} className="aspect-square w-full object-cover" />
                {item.prompt ? <p className="truncate px-3 py-2 text-xs text-ink/60">{item.prompt}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
