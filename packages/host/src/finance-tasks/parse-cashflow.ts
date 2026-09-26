/**
 * Figures text → the periods a cash-flow reader confirms.
 *
 * Deterministic, and deliberately so. Every structural fact this needs — which columns are months,
 * which rows are totals of the rows above them, which section a row sits under, what the opening
 * balance was — is already written into the text the importer produced, so it is read with code and
 * never with a model. No amount is transcribed by anything but `cellValue`.
 *
 * What the reader is then asked to confirm is small and honest: one cash-in and one cash-out figure
 * per period, the financing that is not revenue, the opening balance, and the cost behaviour the
 * rules assigned each source category. Nothing is computed here — that happens in the task module,
 * after the confirmation.
 *
 * Three shapes arrive and all three land in the same rows:
 *  - wide, months as columns (`Keterangan | Jan 2024 | …`);
 *  - a ledger the importer already aggregated (`Payroll (2024-01): -196000`);
 *  - a ledger it did not, one transaction per line (`Rent (2024-01-15): -12500`), which is summed to
 *    month × category here rather than left as 120 lines nobody can confirm.
 */
import { ApiError, type TenantContext } from "@agentforge/core";
import {
  CASHFLOW_CONFIRM_BELOW,
  CASHFLOW_ROW_NAMES,
  EMPTY_FOLD,
  cashflowRowsFromFolds,
  cellValue,
  classifyCashflowLabel,
  foldCategories,
  foldPeriodOrder,
  cashflowLedgerFromSentence,
  isPeriodLabel,
  isSignedBook,
  type CashflowCategory,
  type CashflowFold,
  type CashflowItem,
  type CashflowOpening,
  type LineItem,
} from "@agentforge/core/finance";
import { guardFinanceInput, mergeFinancePii, type FinancePiiSummary } from "../finance-privacy";
import { FIGURES_TEXT_MAX } from "../finance-generate";
import type { FinanceTaskParser } from "./types";

/** The tag the importer puts on a row that totals the rows above it. Never summed with its parts. */
const DERIVED_TAG = /^\[subtotal\]\s*/i;
const SECTION_TAG = /^\[([^\]]+)\]\s*/;
const NARROW_LINE = /^(.*?)\s*\(([^()]*)\)\s*:\s*(.+)$/;
const PLAIN_LINE = /^([^:]+):\s*(.+)$/;
const ISO_DAY = /^(\d{4}-\d{1,2})-\d{1,2}$/;
const SKIP_LINE = /^(sheet|ledger|note)\s*:/i;
const OPENING_LABEL = /saldo\s*awal|kas\s*awal|opening\s*(cash|balance)|beginning\s*(cash|balance)/i;
/** Indonesian markers in the source decide which language the confirmed rows are named in. */
const INDONESIAN = /kas masuk|kas keluar|saldo|pemasukan|pengeluaran|penjualan|pendapatan|biaya|beban|bulan|jumlah/i;
/** The importer's own total rows, in either language, so they can be checked instead of summed. */
const TOTAL_IN_LABEL = /^(total (kas )?masuk|operating cash in|cash in|total pemasukan)$/i;
const TOTAL_OUT_LABEL = /^(total (kas )?keluar|operating cash out|cash out|total pengeluaran)$/i;

const CURRENCY_MARK: ReadonlyArray<readonly [RegExp, string]> = Object.freeze([
  [/\bIDR\b|Rp\s?\d/i, "IDR"],
  [/\bUSD\b|\$\s?\d/, "USD"],
  [/\bEUR\b|€\s?\d/, "EUR"],
  [/\bSGD\b/i, "SGD"],
]);

type Cell = { readonly period: string; readonly amount: number };
type SourceRow = {
  readonly label: string;
  readonly section: string;
  readonly derived: boolean;
  readonly cells: Cell[];
};

export type CashflowParseResult = {
  readonly items: CashflowItem[];
  readonly categories: readonly CashflowCategory[];
  readonly periods: readonly string[];
  readonly openingCash: number | null;
  readonly currency: string;
  readonly warnings: readonly string[];
  readonly needsConfirmation: true;
  readonly pii: FinancePiiSummary;
};

/** "1.250.000" is a million and a quarter in an Indonesian book and 1.25 in an English one. */
function numberStyle(text: string): "thousands" | "decimal" {
  const dots = (text.match(/\d\.\d{3}(?!\d)/g) ?? []).length;
  const commas = (text.match(/\d,\d{3}(?!\d)/g) ?? []).length;
  return dots > commas ? "thousands" : "decimal";
}

function readAmount(raw: string, style: "thousands" | "decimal"): number | null {
  const value = cellValue(raw.trim(), style);
  return value === null || !Number.isFinite(value) ? null : value;
}

/** A period that names a day is the month it falls in: that is what makes a raw ledger confirmable. */
function monthOfPeriod(period: string): string {
  return ISO_DAY.exec(period.trim())?.[1] ?? period.trim();
}

function stripTags(raw: string): { label: string; section: string; derived: boolean } {
  const derived = DERIVED_TAG.test(raw);
  const withoutTag = raw.replace(DERIVED_TAG, "");
  const section = SECTION_TAG.exec(withoutTag)?.[1] ?? "";
  return { label: withoutTag.replace(SECTION_TAG, "").trim(), section, derived };
}

/** The header of a wide table: two or more of its cells name a period. */
function wideHeaderAt(lines: readonly string[]): number {
  return lines.findIndex((line) => {
    const cells = line.split("|").map((cell) => cell.trim());
    return cells.length > 2 && cells.slice(1).filter((cell) => isPeriodLabel(cell)).length >= 2;
  });
}

function wideRows(lines: readonly string[], headerAt: number, style: "thousands" | "decimal"): SourceRow[] {
  const header = (lines[headerAt] ?? "").split("|").map((cell) => cell.trim());
  const columns = header.flatMap((cell, index) => (index > 0 && isPeriodLabel(cell) ? [{ index, period: cell }] : []));
  return lines.slice(headerAt + 1).flatMap((line) => {
    if (!line.includes("|")) {
      return [];
    }
    const cells = line.split("|").map((cell) => cell.trim());
    const tags = stripTags(cells[0] ?? "");
    const values = columns.flatMap((column) => {
      const amount = readAmount(cells[column.index] ?? "", style);
      return amount === null ? [] : [{ period: column.period, amount }];
    });
    return values.length === 0 || tags.label === "" ? [] : [{ ...tags, cells: values }];
  });
}

/** `Label (period): amount`, and `Label: amount` for a line that carries no period of its own. */
function narrowRows(lines: readonly string[], style: "thousands" | "decimal"): SourceRow[] {
  return lines.flatMap((line) => {
    if (SKIP_LINE.test(line) || line.includes("|")) {
      return [];
    }
    const withPeriod = NARROW_LINE.exec(line);
    const plain = withPeriod ? null : PLAIN_LINE.exec(line);
    const raw = withPeriod?.[1] ?? plain?.[1] ?? "";
    const period = monthOfPeriod(withPeriod?.[2] ?? "");
    const amount = readAmount(withPeriod?.[3] ?? plain?.[2] ?? "", style);
    const tags = stripTags(raw);
    return amount === null || tags.label === "" ? [] : [{ ...tags, cells: [{ period, amount }] }];
  });
}

function addCell(cells: readonly Cell[], cell: Cell): Cell[] {
  const at = cells.findIndex((entry) => entry.period === cell.period);
  const existing = cells[at];
  return existing
    ? cells.map((entry, index) => (index === at ? { period: cell.period, amount: entry.amount + cell.amount } : entry))
    : [...cells, cell];
}

/** Rows with the same label and section, summed per period — the answer for an un-aggregated ledger. */
function mergeRows(rows: readonly SourceRow[]): SourceRow[] {
  const merged: SourceRow[] = [];
  for (const row of rows) {
    const at = merged.findIndex(
      (entry) => entry.label === row.label && entry.section === row.section && entry.derived === row.derived,
    );
    const current = merged[at];
    if (!current) {
      merged.push({ ...row, cells: [...row.cells] });
      continue;
    }
    merged[at] = { ...current, cells: row.cells.reduce<Cell[]>((all, cell) => addCell(all, cell), current.cells) };
  }
  return merged;
}

/**
 * The importer's own total rows, checked against the re-derived ones.
 *
 * A derived row never becomes a figure: it is a second opinion. When it disagrees with the sum of the
 * rows above it the reader is told, and the re-derived figure is the one that is kept.
 */
function subtotalWarnings(rows: readonly SourceRow[], folds: ReadonlyMap<string, CashflowFold>): string[] {
  const check = (row: SourceRow, read: (fold: CashflowFold) => number) =>
    row.cells.flatMap((cell) => {
      const derived = read(folds.get(cell.period) ?? EMPTY_FOLD);
      return Math.abs(Math.abs(cell.amount) - derived) <= Math.max(1, Math.abs(derived) * 1e-6)
        ? []
        : [`"${row.label}" ${cell.period}: the sheet says ${cell.amount}, the rows above it add to ${derived}`];
    });
  return rows
    .filter((row) => row.derived)
    .flatMap((row) =>
      TOTAL_IN_LABEL.test(row.label)
        ? check(row, (fold) => fold.cashIn)
        : TOTAL_OUT_LABEL.test(row.label)
          ? check(row, (fold) => fold.cashOut)
          : [],
    );
}

function currencyOf(text: string, language: "id" | "en"): string {
  return CURRENCY_MARK.find(([pattern]) => pattern.test(text))?.[1] ?? (language === "id" ? "IDR" : "USD");
}

function openingCashOf(rows: readonly SourceRow[]): CashflowOpening | null {
  const row = rows.find((entry) => OPENING_LABEL.test(entry.label));
  const amount = row?.cells[0]?.amount;
  return row && amount !== undefined ? { label: row.label, amount } : null;
}

/** A row's extra cash-flow fields survive redaction; only its label and period are ever rewritten. */
function redactItems(items: readonly CashflowItem[]): { items: CashflowItem[]; pii: FinancePiiSummary } {
  const guarded = guardFinanceInput({ lineItems: items as unknown as readonly LineItem[] });
  return { items: guarded.lineItems as unknown as CashflowItem[], pii: guarded.pii };
}

/** Category labels are free text, so they are redacted on the same terms as the rows themselves. */
function redactCategories(categories: readonly CashflowCategory[]): {
  categories: CashflowCategory[];
  pii: FinancePiiSummary;
} {
  const asRows: LineItem[] = categories.map((entry) => ({
    label: entry.label,
    period: "",
    amount: 0,
    currency: "",
    category: "other",
  }));
  const guarded = guardFinanceInput({ lineItems: asRows });
  return {
    categories: categories.map((entry, at) => ({ ...entry, label: guarded.lineItems[at]?.label ?? entry.label })),
    pii: guarded.pii,
  };
}

function sourceRows(text: string): SourceRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const style = numberStyle(text);
  const headerAt = wideHeaderAt(lines);
  const above = headerAt >= 0 ? lines.slice(0, headerAt) : lines;
  return mergeRows([...(headerAt >= 0 ? wideRows(lines, headerAt, style) : []), ...narrowRows(above, style)]);
}

function readFigures(body: unknown): string {
  const figures = (body as { figures?: unknown } | null)?.figures;
  if (typeof figures !== "string" || !figures.trim()) {
    throw new ApiError("invalid_request", "figures text is required", 400);
  }
  return figures.trim().slice(0, FIGURES_TEXT_MAX);
}

const UNCONFIRMED_WARNING =
  "Some cost classifications are a rule's best guess; confirm them before the figures are computed";

/**
 * The cash-flow parse hook. It answers with rows to confirm and never with a computed figure, so the
 * owner sees exactly what will be used before a single number is worked out.
 */
export const parseCashflowInput: FinanceTaskParser = async (_tenant: TenantContext, body: unknown) => {
  const source = guardFinanceInput({ figuresText: readFigures(body) });
  const typed = source.figuresText;
  // A sentence such as "Jan in $20,000, out $26,000" is the catalog sample. It becomes the same
  // narrow ledger a sheet already produces, and `cellValue` still reads every amount.
  const ledger = cashflowLedgerFromSentence(typed);
  const rows = sourceRows(typed);
  const sentenceRows =
    ledger && rows.filter((row) => !row.derived && !OPENING_LABEL.test(row.label)).length === 0
      ? sourceRows(ledger)
      : null;
  const readRows = sentenceRows ?? rows;
  const opening = openingCashOf(readRows);
  const categoryRows = readRows.filter((row) => !row.derived && !OPENING_LABEL.test(row.label));
  if (categoryRows.length === 0) {
    throw new ApiError("invalid_finance", "No cash-flow rows could be read from those figures", 422);
  }
  const language: "id" | "en" = INDONESIAN.test(typed) ? "id" : "en";
  // Each category keeps its own figure per period, so the studio can move it between variable, fixed
  // and one-off later and have every derived number fold again from the same place.
  const categories: CashflowCategory[] = categoryRows.map((row) => ({
    ...classifyCashflowLabel(row.label, { section: row.section, amount: row.cells[0]?.amount }),
    amounts: row.cells.map((cell) => ({ period: cell.period, amount: cell.amount })),
  }));
  const folds = foldCategories(categories, isSignedBook(categories));
  const order = foldPeriodOrder(categories);
  const currency = currencyOf(typed, language);
  const redactedItems = redactItems(
    cashflowRowsFromFolds({ order, folds, names: CASHFLOW_ROW_NAMES[language], currency, opening }),
  );
  const redactedCategories = redactCategories(categories);
  const unconfirmed = redactedCategories.categories.filter((entry) => entry.confidence < CASHFLOW_CONFIRM_BELOW);
  return {
    // The classification rides on the first row so the studio can show it for confirmation without a
    // second request, and so the rows the reader approved are the rows the maths reads.
    items: redactedItems.items.map((item, at) =>
      at === 0 ? { ...item, classification: redactedCategories.categories } : item,
    ),
    categories: redactedCategories.categories,
    periods: order,
    openingCash: opening?.amount ?? null,
    currency,
    warnings: [...subtotalWarnings(rows, folds), ...(unconfirmed.length === 0 ? [] : [UNCONFIRMED_WARNING])],
    needsConfirmation: true,
    pii: mergeFinancePii(mergeFinancePii(source.pii, redactedItems.pii), redactedCategories.pii),
  } satisfies CashflowParseResult;
};
