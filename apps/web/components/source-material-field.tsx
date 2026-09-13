"use client";

import { useState } from "react";
import { ArtifactPicker } from "@/components/artifact-picker";

/** Mirrors the host cap in packages/host/src/job-source.ts. */
export const SOURCE_TEXT_MAX_CHARS = 120_000;

type Props = {
  value: string;
  onChange: (next: string) => void;
  title?: string | null;
  onTitle?: (title: string | null) => void;
  disabled?: boolean;
  testIdPrefix: string;
};

/** Optional "Source material" box with a saved-artifact picker. Empty means the mode works as before. */
export function SourceMaterialField({ value, onChange, title = null, onTitle, disabled = false, testIdPrefix }: Props) {
  const [open, setOpen] = useState(value.length > 0);
  const shown = open || value.length > 0;
  const over = value.length > SOURCE_TEXT_MAX_CHARS;

  return (
    <div className="rounded-lg border border-mist bg-paper/60 px-3 py-2" data-testid={`${testIdPrefix}-source`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="text-xs font-medium text-ink/70 underline-offset-2 hover:underline"
          onClick={() => setOpen((current) => !current)}
          disabled={disabled}
          data-testid={`${testIdPrefix}-source-toggle`}
        >
          {shown ? "Source material" : "Add source material"}
        </button>
        {title ? (
          <span className="truncate text-xs text-ink/55" data-testid={`${testIdPrefix}-source-title`}>
            from “{title}”
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <ArtifactPicker
            disabled={disabled}
            testId={`${testIdPrefix}-source-picker`}
            onPick={(artifact) => {
              onChange(artifact.body);
              onTitle?.(artifact.title);
              setOpen(true);
            }}
          />
          {value ? (
            <button
              type="button"
              className="text-xs text-ink/60 hover:text-ink"
              onClick={() => {
                onChange("");
                onTitle?.(null);
              }}
              disabled={disabled}
              data-testid={`${testIdPrefix}-source-clear`}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
      {shown ? (
        <>
          <textarea
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              onTitle?.(null);
            }}
            rows={6}
            disabled={disabled}
            className="mt-2 w-full rounded-md border border-mist bg-paper px-3 py-2 font-mono text-[12px] text-ink outline-none"
            placeholder="Paste a dossier, analysis, or notes. The draft will use only this material for facts."
            data-testid={`${testIdPrefix}-source-text`}
            aria-label="Source material"
          />
          <p className={`mt-1 text-[12px] ${over ? "text-red-700" : "text-ink/45"}`}>
            {value.length.toLocaleString()} / {SOURCE_TEXT_MAX_CHARS.toLocaleString()} characters
            {over ? " — the host keeps the first part only" : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}
