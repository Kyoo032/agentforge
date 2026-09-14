"use client";

import { useEffect, useState } from "react";
import type { ArtifactMode, ArtifactRecord, ArtifactSummary } from "@/lib/artifacts-client";
import { getArtifact, listArtifacts } from "@/lib/artifacts-client";
import { getLocale, t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";

type Props = {
  /** Restrict to one mode; omit for every saved artifact. */
  mode?: ArtifactMode;
  label?: string;
  disabled?: boolean;
  testId?: string;
  onPick: (artifact: ArtifactRecord) => void;
};

function modeLabel(mode: ArtifactMode): string {
  return labeled(`rail.${mode}`, mode);
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(getLocale() === "id" ? "id-ID" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "Use a saved dossier / analysis…" dropdown. Loads the list on open, the body on pick. */
export function ArtifactPicker({
  mode,
  label,
  disabled = false,
  testId = "artifact-picker",
  onPick,
}: Props) {
  const buttonLabel = label ?? t("documents.source.picker");
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
        className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-transparent px-3 text-xs font-medium text-[var(--text)] hover:bg-[var(--accent-soft)] disabled:opacity-45"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        data-testid={`${testId}-toggle`}
      >
        {buttonLabel}
      </button>
      {open ? (
        <div
          className="raise absolute left-0 z-20 mt-1 w-80 max-w-[90vw] rounded-xl border border-[var(--line)] bg-[var(--surface)] p-2 text-sm"
          data-testid={`${testId}-panel`}
        >
          {error ? <p className="px-2 py-1 text-xs text-[var(--danger)]">{error}</p> : null}
          {items === null && !error ? (
            <p className="px-2 py-1 text-xs text-[var(--text-2)]">{t("common.loading")}</p>
          ) : null}
          {items && items.length === 0 ? (
            <p className="px-2 py-1 text-xs text-[var(--text-2)]">{t("research.emptyTitle")}</p>
          ) : null}
          <ul className="max-h-64 overflow-y-auto">
            {(items ?? []).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="wash w-full rounded-lg px-2 py-1.5 text-left hover:bg-[var(--accent-soft)] disabled:opacity-45"
                  onClick={() => void pick(item)}
                  disabled={loadingId !== null}
                  data-testid={`${testId}-item`}
                >
                  <span className="block truncate font-medium text-[var(--text)]">{item.title}</span>
                  <span className="block text-xs text-[var(--text-3)]">
                    {modeLabel(item.mode)} · {item.kind} · {formatWhen(item.createdAt)}
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
