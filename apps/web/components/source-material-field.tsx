"use client";

import { useState } from "react";
import { ArtifactPicker } from "@/components/artifact-picker";
import { t } from "@/lib/i18n";

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
    <div
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2"
      data-testid={`${testIdPrefix}-source`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="text-xs font-medium text-[var(--text-2)] underline-offset-2 hover:underline"
          onClick={() => setOpen((current) => !current)}
          disabled={disabled}
          data-testid={`${testIdPrefix}-source-toggle`}
        >
          {shown ? t("documents.source.label") : t("documents.source.add")}
        </button>
        {title ? (
          <span className="truncate text-xs text-[var(--text-3)]" data-testid={`${testIdPrefix}-source-title`}>
            {t("documents.source.from", { title })}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <ArtifactPicker
            disabled={disabled}
            testId={`${testIdPrefix}-source-picker`}
            label={t("documents.source.picker")}
            onPick={(artifact) => {
              onChange(artifact.body);
              onTitle?.(artifact.title);
              setOpen(true);
            }}
          />
          {value ? (
            <button
              type="button"
              className="text-xs text-[var(--text-2)] hover:text-[var(--text)]"
              onClick={() => {
                onChange("");
                onTitle?.(null);
              }}
              disabled={disabled}
              data-testid={`${testIdPrefix}-source-clear`}
            >
              {t("documents.source.clear")}
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
            className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--text)] outline-none"
            placeholder={t("documents.source.placeholder")}
            data-testid={`${testIdPrefix}-source-text`}
            aria-label={t("documents.source.aria")}
          />
          <p className={`mt-1 text-xs ${over ? "text-[var(--danger)]" : "text-[var(--text-3)]"}`}>
            {t("documents.source.chars", {
              current: value.length.toLocaleString(),
              max: SOURCE_TEXT_MAX_CHARS.toLocaleString(),
            })}
            {over ? t("documents.source.truncated") : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}
