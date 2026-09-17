/**
 * The figures text back into statement rows, in code, before any model is asked anything.
 *
 * The spreadsheet importer has already done the hard part: it keeps the period columns on the
 * header line, prefixes each row with the section it was printed under, and tags the rows that are
 * totals. Reading that back is arithmetic, not judgement — so it is done here, deterministically,
 * and the model is left with the one job it is actually better at: naming a bucket for a label the
 * dictionary has never seen.
 *
 * What this refuses to do is as important as what it does. It never sums a row. It never crosses a
 * period. It keeps every sign exactly as the sheet wrote it, because whether `Harga Pokok Penjualan`
 * is negative is the sheet's statement and not ours. And it carries the `[subtotal]` tag through, so
 * the caller can drop totals rather than silently adding a company's assets to itself.
 */
import { DERIVED_TAG, financePeriodHeaders, isPeriodLabel } from "../import-table";
import { readImportedLabel, type RatioRowInput } from "./classify";

/** Cells on one line of the wide figures text are joined by this, exactly as the importer writes it. */
const CELL_SEPARATOR = " | ";
const SHEET_LINE = /^Sheet:\s*/;
const NOTE_LINE = /^(Note|Catatan|Ledger):/i;
const NARROW_LINE = /^(.*?)\s*:\s*([^:]+)$/;
/** `Beban Sewa (Jan): 12000000` — a narrow row that carries its own period in brackets. */
const NARROW_PERIOD = /^(.*?)\s*\(([^()]*)\)\s*$/;
const CURRENCY_PREFIX = /^(rp|idr|usd|eur|gbp|sgd|\$|€|£)\s*/i;
const WRAPPED = /^\((.*)\)$/;
const PLAIN = /^[-+]?\d+$/;
const ID_GROUPED = /^[-+]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;
const EN_GROUPED = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const DECIMAL = /^[-+]?\d+[.,]\d+$/;

/** One cell as a number, or null when it is not one. Brackets mean negative, the way a sheet means it. */
export function readRatioAmount(cell: string): number | null {
  const text = cell.trim();
  const wrapped = WRAPPED.exec(text);
  const inner = (wrapped ? (wrapped[1] ?? "") : text).replace(CURRENCY_PREFIX, "").replace(/\s/g, "").trim();
  const magnitude = readMagnitude(inner);
  return magnitude === null ? null : wrapped ? -magnitude : magnitude;
}

function readMagnitude(inner: string): number | null {
  if (PLAIN.test(inner)) {
    return Number(inner);
  }
  if (ID_GROUPED.test(inner)) {
    return Number(inner.split(".").join("").replace(",", "."));
  }
  if (EN_GROUPED.test(inner)) {
    return Number(inner.split(",").join(""));
  }
  if (DECIMAL.test(inner)) {
    return Number(inner.replace(",", "."));
  }
  return null;
}

export type ReadRatioRows = {
  readonly rows: readonly RatioRowInput[];
  readonly periods: readonly string[];
  /** The rows the importer tagged as totals. Kept apart so a caller can show them without adding them. */
  readonly subtotals: readonly RatioRowInput[];
  readonly currency: string;
};

type Header = { readonly labelAt: number; readonly columns: readonly { index: number; period: string }[] };

/** A line is a header only when every cell beside the label names a period. A data row never does. */
function readHeader(cells: readonly string[]): Header | null {
  const periods = financePeriodHeaders(cells);
  if (periods.length === 0) {
    return null;
  }
  const others = cells.filter((_cell, index) => !periods.some((period) => period.index === index));
  if (others.some((cell) => cell.trim() !== "" && isPeriodLabel(cell))) {
    return null;
  }
  const labelAt = cells.findIndex((_cell, index) => !periods.some((period) => period.index === index));
  return { labelAt: Math.max(labelAt, 0), columns: periods.map((period) => ({ index: period.index, period: period.period })) };
}

function wideRows(cells: readonly string[], header: Header, currency: string): RatioRowInput[] {
  const read = readImportedLabel(cells[header.labelAt] ?? "");
  if (read.label === "") {
    return [];
  }
  return header.columns.flatMap((column) => {
    const amount = readRatioAmount(cells[column.index] ?? "");
    return amount === null
      ? []
      : [{ label: read.label, section: read.section, derived: read.derived, period: column.period, amount, currency }];
  });
}

function narrowRow(line: string, currency: string): RatioRowInput[] {
  const match = NARROW_LINE.exec(line);
  const amount = readRatioAmount(match?.[2] ?? "");
  if (!match || amount === null) {
    return [];
  }
  const withPeriod = NARROW_PERIOD.exec((match[1] ?? "").trim());
  const read = readImportedLabel(withPeriod ? (withPeriod[1] ?? "") : (match[1] ?? ""));
  const period = withPeriod ? (withPeriod[2] ?? "").trim() : "";
  return read.label === ""
    ? []
    : [{ label: read.label, section: read.section, derived: read.derived, period, amount, currency }];
}

/** The currency the text is written in, from whatever symbol it happens to carry. */
export function readRatioCurrency(text: string): string {
  if (/\bRp\b|\bIDR\b/i.test(text)) {
    return "IDR";
  }
  if (/\bUSD\b|\$/.test(text)) {
    return "USD";
  }
  if (/\bEUR\b|€/.test(text)) {
    return "EUR";
  }
  return /\bGBP\b|£/.test(text) ? "GBP" : "";
}

/**
 * Every statement row the figures text carries, with its period, its section and its sign intact.
 *
 * Multiple sheets in one paste are handled by the header line resetting per sheet — a balance sheet
 * and a P&L pasted one after the other keep their own period columns.
 */
export function readRatioRows(figuresText: string): ReadRatioRows {
  const currency = readRatioCurrency(figuresText);
  const found: RatioRowInput[] = [];
  let header: Header | null = null;
  for (const raw of figuresText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || NOTE_LINE.test(line)) {
      continue;
    }
    if (SHEET_LINE.test(line)) {
      header = null;
      continue;
    }
    if (line.includes(CELL_SEPARATOR)) {
      const cells = line.split(CELL_SEPARATOR).map((cell) => cell.trim());
      const next = readHeader(cells);
      if (next) {
        header = next;
        continue;
      }
      found.push(...(header ? wideRows(cells, header, currency) : []));
      continue;
    }
    found.push(...narrowRow(line, currency));
  }
  const rows = found.filter((row) => row.derived !== true);
  return {
    rows,
    subtotals: found.filter((row) => row.derived === true),
    periods: [...new Set(rows.map((row) => row.period ?? ""))],
    currency,
  };
}

/** Re-exported so a caller can spell the importer's own tag without reaching past this module. */
export { DERIVED_TAG };
