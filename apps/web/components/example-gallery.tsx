"use client";

import { useMemo, useState } from "react";
import type { LibraryEntry, LibraryMode } from "@agentforge/core/templates";
import { galleryChrome, localizedLibrary } from "@/lib/ui-copy";

type ExampleGalleryProps = {
  mode: LibraryMode;
  onSelect: (entry: LibraryEntry) => void;
};

export function ExampleGallery({ mode, onSelect }: ExampleGalleryProps) {
  const entries = useMemo(() => localizedLibrary(mode), [mode]);
  const chrome = useMemo(() => galleryChrome(mode), [mode]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find((entry) => entry.exampleId === selectedId) ?? null;

  return (
    <section className="mt-6" data-testid="example-gallery">
      <h2 className="text-sm font-medium text-[var(--text)]">{chrome.title}</h2>
      <p className="mt-1 text-xs text-[var(--text-3)]">{chrome.hint}</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => {
          const isSelected = selectedId === entry.exampleId;
          return (
            <li key={entry.exampleId}>
              <button
                type="button"
                data-testid="example-card"
                data-example-id={entry.exampleId}
                aria-pressed={isSelected}
                className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm ${
                  isSelected
                    ? "select-row border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]"
                    : "wash border-[var(--line)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--accent-soft)]"
                }`}
                onClick={() => {
                  setSelectedId(entry.exampleId);
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
        <p className="mt-3 text-sm text-[var(--text-2)]" data-testid="example-result">
          {selected.resultSummary}
        </p>
      ) : null}
    </section>
  );
}
