"use client";

import { promptTemplateById, type PromptTemplate } from "@agentforge/core/edit";
import { useEffect, useState } from "react";
import { apiFetch, mediaSrc } from "@/lib/api-client";

export type VideoExampleItem = {
  file: string;
  url: string;
  templateId: string;
  title: string;
  prompt: string;
  aspect: "16:9" | "9:16" | "1:1";
  seconds: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  model?: string;
};

type Props = {
  onPick: (template: PromptTemplate) => void;
  selectedId: string | null;
};

const LOAD_FAILED = "Could not load example clips";

function formatSeconds(item: VideoExampleItem): string {
  const seconds = item.durationSeconds ?? item.seconds;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

/**
 * Bundled example clips: real generations of prompt templates, served from the app's own
 * resources folder so they play offline on every install. Clicking a card loads its prompt.
 */
export function VideoExamples({ onPick, selectedId }: Props) {
  const [items, setItems] = useState<VideoExampleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await apiFetch("/api/v1/videos/examples");
        const data = (await response.json().catch(() => ({}))) as {
          examples?: VideoExampleItem[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(data.error?.message ?? LOAD_FAILED);
        }
        if (!cancelled) {
          setItems(data.examples ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : LOAD_FAILED);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p className="mt-6 text-xs text-[var(--text-3)]" data-testid="videos-examples-error">
        {error}
      </p>
    );
  }
  if (!items || items.length === 0) {
    // Nothing bundled (a dev checkout before `pnpm videos:examples`): keep the studio clean.
    return null;
  }

  return (
    <section className="mt-6" data-testid="videos-examples">
      <h2 className="text-sm font-medium text-[var(--text)]">Example clips</h2>
      <p className="mt-1 text-xs text-[var(--text-3)]">
        Generated from the prompt templates below and bundled with the app. Click one to load its prompt.
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const isSelected = item.templateId === selectedId;
          return (
            <li
              key={item.file}
              className={`overflow-hidden rounded-xl border bg-[var(--surface)] ${
                isSelected
                  ? "select-row border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "wash border-[var(--line)] hover:bg-[var(--accent-soft)]"
              }`}
              data-testid="videos-example-card"
              data-template-id={item.templateId}
            >
              <video
                src={mediaSrc(item.url)}
                controls
                muted
                playsInline
                preload="metadata"
                className="aspect-video w-full bg-black object-contain"
                data-testid="videos-example-video"
              />
              <div className="px-3 py-2">
                <p className="truncate text-sm text-[var(--text)]" title={item.title}>
                  {item.title}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-[var(--text-3)]">
                  <span className="rounded border border-[var(--line)] px-1 leading-4">{item.aspect}</span>
                  <span>{formatSeconds(item)}</span>
                  {item.model ? <span className="truncate">{item.model}</span> : null}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-[var(--text-2)]" title={item.prompt}>
                  {item.prompt}
                </p>
                <button
                  type="button"
                  className="wash mt-2 inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-transparent px-3 text-xs text-[var(--text)] hover:bg-[var(--accent-soft)]"
                  aria-pressed={isSelected}
                  data-testid={`videos-example-use-${item.templateId}`}
                  onClick={() => {
                    const template = promptTemplateById(item.templateId);
                    if (template) {
                      onPick(template);
                    }
                  }}
                >
                  Use this prompt
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
