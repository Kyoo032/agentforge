"use client";

import { useEffect, useState } from "react";
import type { ArtifactMode, ArtifactRecord, ArtifactSummary } from "@/lib/artifacts-client";
import { getArtifact, listArtifacts } from "@/lib/artifacts-client";

type Props = {
  /** Restrict to one mode; omit for every saved artifact. */
  mode?: ArtifactMode;
  label?: string;
  disabled?: boolean;
  testId?: string;
  onPick: (artifact: ArtifactRecord) => void;
};

const MODE_LABEL: Record<ArtifactMode, string> = {
  research: "Research",
  data: "Data",
  finance: "Finance",
  documents: "Documents",
  presentations: "Presentation",
  legal: "Legal",
};

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "Use a saved dossier / analysis…" dropdown. Loads the list on open, the body on pick. */
export function ArtifactPicker({
  mode,
  label = "Use a saved artifact…",
  disabled = false,
  testId = "artifact-picker",
  onPick,
}: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ArtifactSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setError(null);
    listArtifacts(mode).then(
      (list) => {
        if (!cancelled) {
          setItems(list);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not list saved artifacts");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, mode]);

  async function pick(item: ArtifactSummary) {
    setLoadingId(item.id);
    setError(null);
    try {
      onPick(await getArtifact(item.id));
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that artifact");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="relative" data-testid={testId}>
      <button
        type="button"
        className="rounded-md border border-mist px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        data-testid={`${testId}-toggle`}
      >
        {label}
      </button>
      {open ? (
        <div
          className="absolute left-0 z-20 mt-1 w-80 max-w-[90vw] rounded-lg border border-mist bg-paper p-2 text-sm shadow-lg"
          data-testid={`${testId}-panel`}
        >
          {error ? <p className="px-2 py-1 text-xs text-red-700">{error}</p> : null}
          {items === null && !error ? <p className="px-2 py-1 text-xs text-ink/60">Loading…</p> : null}
          {items && items.length === 0 ? (
            <p className="px-2 py-1 text-xs text-ink/60">Nothing saved yet. Run Research first.</p>
          ) : null}
          <ul className="max-h-64 overflow-y-auto">
            {(items ?? []).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-mist/50 disabled:opacity-50"
                  onClick={() => void pick(item)}
                  disabled={loadingId !== null}
                  data-testid={`${testId}-item`}
                >
                  <span className="block truncate font-medium text-ink">{item.title}</span>
                  <span className="block text-xs text-ink/55">
                    {MODE_LABEL[item.mode]} · {item.kind} · {formatWhen(item.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
