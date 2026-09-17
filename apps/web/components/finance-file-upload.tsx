"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  FINANCE_IMPORT_ACCEPT,
  financeImportIsDocument,
  importFinanceFile,
  importFinanceFileAllSheets,
  type FinanceImportResult,
  type FinanceImportSheet,
} from "@/lib/finance-import-client";
import { financeWarningText } from "@/lib/finance-import-warnings";
import { t } from "@/lib/i18n";

export type FinanceFileUploadProps = {
  /**
   * Hands the figures text to the studio, which puts it in the paste box. The upload feeds the
   * existing flow: the owner still parses the text and confirms every row before anything is computed.
   * A document also hands over its prose, which carries the figures its tables never held.
   */
  onFigures: (text: string, proseText?: string) => void;
  /** True while a brief is running, so an upload cannot change the inputs under a job. */
  disabled?: boolean;
};

/** The picker's value for "every table at once". Not a sheet name: no sheet may be called this. */
const ALL_SHEETS = "*";

type Loaded = { file: File; result: FinanceImportResult; picked: string };

const DROP_ZONE =
  "w-full rounded-lg border border-dashed border-[var(--line)] px-4 py-5 text-center text-sm text-[var(--text-2)] transition-colors hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50";

function shownSheet(loaded: Loaded): FinanceImportSheet | null {
  return loaded.result.sheets.find((sheet) => sheet.name === loaded.result.sheet) ?? loaded.result.sheets[0] ?? null;
}

/** The uploaded sheet as it is: header row in bold, the first rows below it, cells as written. */
function PreviewTable({ sheet }: { sheet: FinanceImportSheet }) {
  const [header, ...rows] = sheet.preview;
  return (
    <div className="overflow-x-auto">
      <p className="panel-label">{t("finance.upload.previewLabel", { count: sheet.preview.length })}</p>
      <table className="mt-1 w-full border-collapse text-xs" data-testid="finance-upload-preview">
        <thead>
          <tr>
            {(header ?? []).map((cell, index) => (
              <th
                // biome-ignore lint/suspicious/noArrayIndexKey: a preview cell has no id of its own
                key={`h${index}-${cell}`}
                className="border-b border-[var(--line)] px-2 py-1 text-left font-medium text-[var(--text-2)]"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a preview row has no id of its own
            <tr key={`r${rowIndex}-${row.join("|")}`}>
              {row.map((cell, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a preview cell has no id of its own
                <td key={`c${index}-${cell}`} className="border-b border-[var(--line)] px-2 py-1 text-[var(--text)]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What the reader left out and what the guard hid, stated plainly before the owner uses the figures.
 *
 * A dropped column is a number they will look for in the brief and not find, so it is said here
 * rather than discovered later; a hidden identifier is said because it changed what they are about
 * to send. Both are calm notes, not errors — the import worked.
 */
function ImportNotices({ result }: { result: FinanceImportResult }) {
  const lines = result.warnings.map(financeWarningText).filter((line): line is string => line !== null);
  if (lines.length === 0 && result.pii.count === 0) {
    return null;
  }
  return (
    <div className="space-y-1 text-xs text-[var(--text-3)]" role="status">
      {lines.length > 0 ? (
        <div data-testid="finance-upload-warnings">
          <p className="panel-label">{t("finance.upload.warningsTitle")}</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.pii.count > 0 ? (
        <p data-testid="finance-upload-pii">{t("finance.upload.pii", { n: result.pii.count })}</p>
      ) : null}
    </div>
  );
}

/**
 * CSV / Excel upload for the Finance inputs panel. It reads the file on the host, shows what was
 * found, and on "Use these figures" hands the plain text to `onFigures` — the paste → parse → confirm
 * flow below it is untouched.
 */
export function FinanceFileUpload({ onFigures, disabled = false }: FinanceFileUploadProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = disabled || busy;

  /**
   * A document is read whole by default: its tables are chapters of one report and picking one of
   * them silently drops the rest. A spreadsheet keeps offering its sheets as alternatives, because
   * there they usually are.
   */
  async function read(file: File, sheet?: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const whole = sheet === undefined ? financeImportIsDocument(file.name) : sheet === ALL_SHEETS;
      const result = whole ? await importFinanceFileAllSheets(file) : await importFinanceFile(file, sheet);
      setLoaded({ file, result, picked: whole ? ALL_SHEETS : (sheet ?? result.sheet) });
    } catch (failure) {
      setLoaded(null);
      setError(failure instanceof Error ? failure.message : t("finance.upload.errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    // Cleared so picking the same file twice still fires a change event.
    event.target.value = "";
    if (file) {
      void read(file);
    }
  }

  function onDrop(event: DragEvent<HTMLButtonElement>): void {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!locked && file) {
      void read(file);
    }
  }

  function onRemove(): void {
    setLoaded(null);
    setError(null);
  }

  const sheet = loaded ? shownSheet(loaded) : null;

  return (
    <div className="space-y-2" data-testid="finance-upload">
      <p className="panel-label">{t("finance.upload.label")}</p>
      <input
        ref={input}
        type="file"
        accept={FINANCE_IMPORT_ACCEPT}
        className="hidden"
        onChange={onPick}
        disabled={locked}
        aria-label={t("finance.upload.fileAria")}
        data-testid="finance-upload-input"
      />
      <button
        type="button"
        className={DROP_ZONE}
        onClick={() => input.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        disabled={locked}
        data-testid="finance-upload-drop"
      >
        {busy ? t("finance.upload.reading") : (loaded?.file.name ?? t("finance.upload.dropHint"))}
        <br />
        <span className="text-xs text-[var(--text-3)]">
          {loaded ? t("finance.upload.replace") : t("finance.upload.choose")}
        </span>
      </button>
      {error ? (
        <p className="text-sm text-[var(--danger)]" role="alert" data-testid="finance-upload-error">
          {error}
        </p>
      ) : null}
      {loaded && sheet ? (
        <div className="space-y-2">
          {loaded.result.sheets.length > 1 ? (
            <div>
              <label htmlFor="finance-upload-sheet" className="panel-label">
                {t("finance.upload.sheet")}
              </label>
              <select
                id="finance-upload-sheet"
                className="input mt-1"
                value={loaded.picked}
                onChange={(event) => void read(loaded.file, event.target.value)}
                disabled={locked}
                aria-label={t("finance.upload.sheetAria")}
                data-testid="finance-upload-sheet"
              >
                <option value={ALL_SHEETS}>
                  {t("finance.upload.allSheets", { count: loaded.result.sheets.length })}
                </option>
                {loaded.result.sheets.map((option) => (
                  <option key={option.name} value={option.name}>
                    {t("finance.upload.sheetOption", { name: option.name, rows: option.rowCount })}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <PreviewTable sheet={sheet} />
          <ImportNotices result={loaded.result} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onFigures(loaded.result.figuresText, loaded.result.proseText)}
              disabled={locked || loaded.result.figuresText.trim() === ""}
              data-testid="finance-upload-use"
            >
              {t("finance.upload.use")}
            </button>
            <button type="button" className="btn" onClick={onRemove} disabled={busy} data-testid="finance-upload-remove">
              {t("finance.upload.remove")}
            </button>
          </div>
          <p className="text-xs text-[var(--text-3)]">{t("finance.upload.useHint")}</p>
        </div>
      ) : null}
    </div>
  );
}
