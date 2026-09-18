/**
 * What an import warning says on screen.
 *
 * The host answers with the table reader's own developer English ("3 columns were not imported"),
 * because the reader runs where there is no locale. So the wire carries the code and the detail, and
 * the sentence is written here — the same warning reads naturally in both languages, and nothing
 * untranslated ever reaches the owner.
 */
import { t } from "./i18n";

/** One thing the table reader could not keep. The shape `POST /api/v1/finance/import` answers with. */
export type FinanceImportWarning = {
  readonly code: string;
  /** Developer English, kept for a bug report. Never shown.  */
  readonly message: string;
  /** What was left out: column names, row labels, or one summary line like "12 lines". */
  readonly detail: readonly string[];
};

/** Every code the reader emits today, and the string that says it in the reader's language. */
const WARNING_KEYS: Readonly<Record<string, string>> = {
  dropped_columns: "finance.upload.warnings.droppedColumns",
  dropped_rows: "finance.upload.warnings.droppedRows",
  direction_mismatch: "finance.upload.warnings.directionMismatch",
  truncated: "finance.upload.warnings.truncated",
  compacted: "finance.upload.warnings.compacted",
  capped_cells: "finance.upload.warnings.cappedCells",
  pii_amount_restored: "finance.upload.warnings.piiAmountRestored",
};

/**
 * How many things one warning is about. `detail` is either the list itself ("No", "NPWP") or a
 * single summary line ("12 lines"), so a leading number wins and the list length is the fallback.
 */
export function financeWarningCount(warning: FinanceImportWarning): number {
  const only = warning.detail.length === 1 ? /^(\d+)\b/.exec(warning.detail[0] ?? "") : null;
  return only ? Number(only[1]) : warning.detail.length;
}

/** The sentence for one warning, or `null` for a code this build has no words for. */
export function financeWarningText(warning: FinanceImportWarning): string | null {
  const key = WARNING_KEYS[warning.code];
  return key ? t(key, { n: financeWarningCount(warning) }) : null;
}

/** Never trust the wire: anything that is not warning-shaped is dropped rather than half-read. */
export function parseFinanceWarnings(value: unknown): FinanceImportWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = (item ?? {}) as { code?: unknown; message?: unknown; detail?: unknown };
    if (typeof record.code !== "string" || record.code.trim() === "") {
      return [];
    }
    const detail = Array.isArray(record.detail) ? record.detail.map((entry) => String(entry ?? "")) : [];
    return [{ code: record.code, message: typeof record.message === "string" ? record.message : "", detail }];
  });
}

/** What the privacy guard hid before the upload answered, as the studio shows it. */
export type FinancePiiSummary = { readonly count: number; readonly kinds: readonly string[] };

export const EMPTY_FINANCE_PII: FinancePiiSummary = { count: 0, kinds: [] };

export function parseFinancePii(value: unknown): FinancePiiSummary {
  const record = (value ?? {}) as { count?: unknown; kinds?: unknown };
  const count = typeof record.count === "number" && Number.isFinite(record.count) ? Math.max(0, record.count) : 0;
  const kinds = Array.isArray(record.kinds) ? record.kinds.map((kind) => String(kind ?? "")) : [];
  return count === 0 ? EMPTY_FINANCE_PII : { count, kinds };
}
