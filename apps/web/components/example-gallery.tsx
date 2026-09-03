"use client";

import { useMemo, useState } from "react";
import { libraryForMode, type LibraryEntry, type LibraryMode } from "@agentforge/core/templates";

type ExampleGalleryProps = {
  mode: LibraryMode;
  onSelect: (entry: LibraryEntry) => void;
};

function exampleId(entry: LibraryEntry): string {
  return `${entry.mode}-${entry.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function ExampleGallery({ mode, onSelect }: ExampleGalleryProps) {
  const entries = useMemo(() => libraryForMode(mode), [mode]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find((entry) => exampleId(entry) === selectedId) ?? null;

  return (
    <section className="mt-6" data-testid="example-gallery">
      <h2 className="text-sm font-medium text-ink">Start from a template</h2>
      <p className="mt-1 text-xs text-ink/55">
        Click a card to load a full brief. Replace the sample details, then generate.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => {
          const id = exampleId(entry);
          const isSelected = selectedId === id;
          return (
            <li key={id}>
              <button
                type="button"
                data-testid="example-card"
                data-example-id={id}
                aria-pressed={isSelected}
                className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                  isSelected
                    ? "border-accent bg-accent/5 text-ink"
                    : "border-mist bg-paper text-ink hover:border-accent"
                }`}
                onClick={() => {
                  setSelectedId(id);
                  onSelect(entry);
                }}
              >
                {entry.title}
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? (
        <p className="mt-3 text-sm text-ink/70" data-testid="example-result">
          {selected.resultSummary}
        </p>
      ) : null}
    </section>
  );
}
