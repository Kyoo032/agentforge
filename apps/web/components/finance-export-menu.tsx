"use client";

import { useEffect, useState } from "react";
import type { FinanceReport, FinanceResult } from "@/lib/finance-client";
import {
  FINANCE_EXPORT_FORMATS,
  downloadFinanceExport,
  loadFinanceExportFormat,
  saveFinanceExportFormat,
  type FinanceExportFormat,
} from "@/lib/finance-export";
import { t } from "@/lib/i18n";

type Props = {
  /** The saved brief, when there is one. The result below is what actually gets rendered. */
  artifactId?: string | null;
  result: FinanceResult;
  /** The task this result belongs to. It rides on the request so the file is named for its task. */
  task?: string;
  /** A task's own report. Sent in place of the brief, so every task exports through one renderer. */
  report?: FinanceReport;
  workspaceId: string | null;
  disabled?: boolean;
};

const BUTTON = "rounded-md border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--text)]";

function formatLabel(format: FinanceExportFormat): string {
  return t(`finance.export.format.${format}`);
}

function FormatMenu({
  current,
  onPick,
}: {
  current: FinanceExportFormat;
  onPick: (format: FinanceExportFormat) => void;
}) {
  return (
    <ul
      className="absolute right-0 z-10 mt-1 min-w-44 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-raise)]"
      data-testid="finance-export-menu"
    >
      {FINANCE_EXPORT_FORMATS.map((format) => (
        <li key={format}>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-xs text-[var(--text)] hover:bg-[var(--accent-soft)]"
            onClick={() => onPick(format)}
            aria-current={format === current}
            data-testid={`finance-export-${format}`}
          >
            {formatLabel(format)}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Export in the format this desk used last, or open the menu and pick another. */
export function FinanceExportMenu({ artifactId, result, task, report, workspaceId, disabled = false }: Props) {
  const [format, setFormat] = useState<FinanceExportFormat>(() => loadFinanceExportFormat(workspaceId));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setFormat(loadFinanceExportFormat(workspaceId));
  }, [workspaceId]);

  async function run(next: FinanceExportFormat): Promise<void> {
    setOpen(false);
    setFormat(next);
    saveFinanceExportFormat(workspaceId, next);
    setBusy(true);
    setError("");
    try {
      const sent = report ?? result.report;
      await downloadFinanceExport(
        {
          ...(sent ? { report: sent } : { brief: result.brief }),
          artifactId: artifactId ?? result.artifactId,
          format: next,
          ...(task ? { task } : {}),
        },
        t("finance.export.failed"),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("finance.export.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative inline-flex flex-col items-end">
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          className={`${BUTTON} disabled:opacity-50`}
          onClick={() => void run(format)}
          disabled={disabled || busy}
          data-testid="finance-export"
        >
          {busy ? t("finance.export.working") : `${t("finance.export.button")} · ${formatLabel(format)}`}
        </button>
        <button
          type="button"
          className={`${BUTTON} disabled:opacity-50`}
          onClick={() => setOpen(!open)}
          disabled={disabled || busy}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={t("finance.export.choose")}
          data-testid="finance-export-toggle"
        >
          ▾
        </button>
      </div>
      {open ? <FormatMenu current={format} onPick={(next) => void run(next)} /> : null}
      {error ? (
        <p className="mt-1 text-xs text-[var(--danger)]" data-testid="finance-export-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
