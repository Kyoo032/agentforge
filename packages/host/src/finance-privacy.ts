/**
 * The Finance privacy guard.
 *
 * A Finance job has exactly one outbound destination — the pinned model gateway — and it carries the
 * owner's own payroll and ledger rows. So every route that can put a figure in front of the model
 * passes its input through here first: the upload (`/finance/import`), the paste box
 * (`/finance/parse`), and the two brief routes (`/finance`, `/finance/stream`, `/finance/regenerate`).
 *
 * Three rules this file keeps:
 *  - **Redaction is on.** There is no bypass. `injectionGuardBypass` turns off the injection guard
 *    and nothing else; a workspace switch for this does not exist and is not read here.
 *  - **The redacted copy is the only copy that travels.** What the route answers with is what the
 *    model is given, so the owner can read on screen exactly what left the desk.
 *  - **A hit is never written out in the clear.** `samples` are the redacted previews the core
 *    scanner produced, and nothing in this file logs.
 *  - **Redaction may hide an identifier, never a figure.** {@link restoreFinanceAmounts} checks the
 *    second one after the fact, so no future pattern can quietly eat a number again.
 */
import { ApiError } from "@agentforge/core";
import type { PiiKind } from "@agentforge/core";
import {
  cellValue,
  financeFiguresFromSheet,
  financeIdentifierCells,
  scanFinanceTablePii,
  type FinanceImportWarning,
  type FinancePiiHit,
  type FinanceSheet,
  type LineItem,
} from "@agentforge/core/finance";

/** What the studio shows: how many identifiers were hidden, of what kind, and a redacted sample. */
export type FinancePiiSummary = {
  count: number;
  kinds: PiiKind[];
  samples: string[];
};

/** Most redacted previews handed back. The count is the whole truth; the samples are the evidence. */
export const FINANCE_PII_SAMPLE_MAX = 5;

export const EMPTY_FINANCE_PII: FinancePiiSummary = { count: 0, kinds: [], samples: [] };

function summarize(hits: ReadonlyArray<FinancePiiHit>): FinancePiiSummary {
  if (hits.length === 0) {
    return EMPTY_FINANCE_PII;
  }
  const samples: string[] = [];
  for (const hit of hits) {
    if (samples.length >= FINANCE_PII_SAMPLE_MAX) {
      break;
    }
    if (!samples.includes(hit.preview)) {
      samples.push(hit.preview);
    }
  }
  return { count: hits.length, kinds: [...new Set(hits.map((hit) => hit.kind))], samples };
}

/** Two guarded inputs on one request (source text plus line items) report as one number. */
export function mergeFinancePii(left: FinancePiiSummary, right: FinancePiiSummary): FinancePiiSummary {
  if (right.count === 0) {
    return left;
  }
  if (left.count === 0) {
    return right;
  }
  return {
    count: left.count + right.count,
    kinds: [...new Set([...left.kinds, ...right.kinds])],
    samples: [...new Set([...left.samples, ...right.samples])].slice(0, FINANCE_PII_SAMPLE_MAX),
  };
}

/** One cell redaction took a figure out of. Positions only — a restored value is never reported. */
export type FinanceRestoredCell = { readonly row: number; readonly column: number };

/**
 * The last line of defence: a figure that did not survive redaction is put back.
 *
 * The scanner decides what to hide and this decides what it was not allowed to lose. Every cell the
 * importer reads as a number before redaction has to read as the same number after it, in every
 * column no header positively named as an identifier — an identifying column is exempt because
 * `[nik]` replacing a 16-digit run is the whole point of it.
 *
 * It exists because a guard that is wrong about an identifier costs the owner a hidden name, while a
 * guard that is wrong about a figure costs the brief its arithmetic and says nothing. 2024 cost of
 * sales, written `(23.960.000.000)` under a column headed `2024`, reached the model as `[phone])`
 * and every ratio built on it was wrong. The pattern that did that is fixed; this is what makes the
 * next one survivable.
 */
export function restoreFinanceAmounts(
  rows: ReadonlyArray<ReadonlyArray<string>>,
  redacted: ReadonlyArray<ReadonlyArray<string>>,
): { rows: string[][]; restored: FinanceRestoredCell[] } {
  const identifying = financeIdentifierCells(rows);
  const restored: FinanceRestoredCell[] = [];
  const healed = redacted.map((row, rowIndex) =>
    row.map((after, column) => {
      const before = rows[rowIndex]?.[column] ?? after;
      const amount = cellValue(before);
      if (identifying[rowIndex]?.[column] === true || amount === null || cellValue(after) === amount) {
        return after;
      }
      restored.push({ row: rowIndex, column });
      return before;
    }),
  );
  return { rows: healed, restored };
}

/** How many figures had to be handed back. The count is the whole report; the values never travel. */
function restoredWarnings(restored: ReadonlyArray<FinanceRestoredCell>): FinanceImportWarning[] {
  if (restored.length === 0) {
    return [];
  }
  return [
    {
      code: "pii_amount_restored",
      message: `${restored.length} redacted cells held a figure and were restored`,
      detail: [`${restored.length} cells`],
    },
  ];
}

/** A hit on a cell that was handed back hid nothing, so the summary does not count it as hidden. */
function wasRestored(restored: ReadonlyArray<FinanceRestoredCell>, hit: FinancePiiHit): boolean {
  const cell = hit.cell;
  return cell !== undefined && restored.some((at) => at.row === cell.row && at.column === cell.column);
}

/** Sheet rows for a preview the owner is shown. Same column rules as the text the model gets. */
export function redactFinanceRows(rows: ReadonlyArray<ReadonlyArray<string>>): string[][] {
  // Through the net as well, so the preview the owner reads is the copy the model is handed.
  return restoreFinanceAmounts(rows, scanFinanceTablePii({ rows }).redacted).rows;
}

/** Every sheet in the picker, redacted, so the preview rows match the text the parse box receives. */
export function redactFinanceSheets(sheets: ReadonlyArray<FinanceSheet>): FinanceSheet[] {
  return sheets.map((sheet) => ({ name: sheet.name, rows: redactFinanceRows(sheet.rows) }));
}

export function guardFinanceInput(input: { sheet: FinanceSheet }): {
  sheet: FinanceSheet;
  figuresText: string;
  /** What the reader could not keep. Shown to the owner; nothing here repeats a redacted value. */
  warnings: FinanceImportWarning[];
  pii: FinancePiiSummary;
};
export function guardFinanceInput(input: { figuresText: string }): { figuresText: string; pii: FinancePiiSummary };
export function guardFinanceInput(input: { lineItems: ReadonlyArray<LineItem> }): {
  lineItems: LineItem[];
  pii: FinancePiiSummary;
};
/**
 * Redact one Finance input and say what was hidden.
 *
 * A sheet is redacted as rows and only then written out as figures text, so the text the paste box
 * receives is built from redacted cells rather than scrubbed afterwards — a name that became
 * "Karyawan 1" in the table is "Karyawan 1" in every line that mentions it.
 *
 * The reader's own warnings come back with it. A column it could not keep is a number the owner will
 * look for and not find, and the upload is the last place anyone can still say so.
 */
export function guardFinanceInput(input: {
  sheet?: FinanceSheet;
  figuresText?: string;
  lineItems?: ReadonlyArray<LineItem>;
}): {
  sheet?: FinanceSheet;
  figuresText?: string;
  lineItems?: LineItem[];
  warnings?: FinanceImportWarning[];
  pii: FinancePiiSummary;
} {
  if (input.sheet) {
    const scanned = scanFinanceTablePii({ rows: input.sheet.rows });
    const healed = restoreFinanceAmounts(input.sheet.rows, scanned.redacted);
    const sheet: FinanceSheet = { name: input.sheet.name, rows: healed.rows };
    const figures = financeFiguresFromSheet(sheet);
    const kept = scanned.hits.filter((hit) => !wasRestored(healed.restored, hit));
    return {
      sheet,
      figuresText: figures.text,
      warnings: [...figures.warnings, ...restoredWarnings(healed.restored)],
      pii: summarize(kept),
    };
  }
  if (input.figuresText !== undefined) {
    const scanned = scanFinanceTablePii({ figuresText: input.figuresText });
    return { figuresText: scanned.redacted, pii: summarize(scanned.hits) };
  }
  if (input.lineItems) {
    const scanned = scanFinanceTablePii({ lineItems: input.lineItems });
    return { lineItems: scanned.redacted, pii: summarize(scanned.hits) };
  }
  throw new ApiError("invalid_request", "Nothing to guard: pass a sheet, figures text or line items", 400);
}
