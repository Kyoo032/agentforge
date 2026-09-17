/**
 * Bank exports and cash books arrive one transaction per row — date, category, direction, amount —
 * and 120 of those lines are not figures anyone can read. They are aggregated to month × category
 * with signed amounts instead.
 *
 * The sign of `amount` wins over the `direction` label, always. A refund booked "out" with a positive
 * amount is a reversal, and re-applying a sign from the label would flip it back and double the error;
 * every row where the two disagree comes back as a warning so the screen can say so.
 *
 * Money that came in from a funding round is not revenue, so a financing category is kept as its own
 * line and left out of the operating cash in / cash out totals.
 */
import type { FinanceImportWarning } from "./limits";
import type { NumberStyle } from "./numbers";
import { cellValue } from "./numbers";

/** Fewest rows before a table is worth reading as a ledger rather than as a small summary. */
export const LEDGER_MIN_ROWS = 12;
/** Share of a column's cells that must parse before the column takes that role. */
const COLUMN_THRESHOLD = 0.8;

const DATE_CELL = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$|^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;
const IN_WORDS = /^(in|masuk|credit|kredit|inflow|deposit|received|terima|penerimaan)$/i;
const OUT_WORDS = /^(out|keluar|debit|debet|withdrawal|outflow|paid|bayar|pengeluaran|expense)$/i;
/** A funding round moves the bank balance without ever being operating revenue. */
const FINANCING = /financ|funding|pendanaan|investasi|invest|safe|equity|ekuitas|loan|pinjaman|modal|share capital/i;

/** "2024-03-25" or "25/03/2024" to "2024-03"; null when the cell is not a date. */
export function monthOf(cell: string): string | null {
  const match = DATE_CELL.exec(cell.trim());
  if (!match) {
    return null;
  }
  const year = match[1] ?? match[6] ?? "";
  const month = match[2] ?? match[5] ?? "";
  return year === "" || month === "" ? null : `${year}-${month.padStart(2, "0")}`;
}

function share(cells: ReadonlyArray<string>, test: (cell: string) => boolean): number {
  const filled = cells.filter((cell) => cell.trim() !== "");
  return filled.length === 0 ? 0 : filled.filter(test).length / filled.length;
}

export type LedgerColumns = {
  readonly date: number;
  readonly category: number;
  readonly amount: number;
  /** -1 when the ledger has no direction column. */
  readonly direction: number;
};

/** The four ledger columns, or null when this is not a transaction list. */
export function ledgerColumns(
  header: ReadonlyArray<string>,
  body: ReadonlyArray<ReadonlyArray<string>>,
  style: NumberStyle,
): LedgerColumns | null {
  if (body.length < LEDGER_MIN_ROWS) {
    return null;
  }
  const columns = header.map((_cell, index) => body.map((row) => row[index] ?? ""));
  const date = columns.findIndex((cells) => share(cells, (cell) => monthOf(cell) !== null) >= COLUMN_THRESHOLD);
  const amount = columns.reduce(
    (best, cells, index) =>
      index !== date && share(cells, (cell) => cellValue(cell, style) !== null) >= COLUMN_THRESHOLD ? index : best,
    -1,
  );
  const direction = columns.findIndex(
    (cells, index) =>
      index !== date &&
      index !== amount &&
      share(cells, (cell) => IN_WORDS.test(cell.trim()) || OUT_WORDS.test(cell.trim())) >= COLUMN_THRESHOLD,
  );
  const category = columns.findIndex((cells, index) => {
    if (index === date || index === amount || index === direction) {
      return false;
    }
    const filled = cells.filter((cell) => cell.trim() !== "");
    const distinct = new Set(filled.map((cell) => cell.trim().toLowerCase())).size;
    return filled.length > 0 && distinct >= 2 && distinct <= filled.length / 2;
  });
  return date >= 0 && amount >= 0 && category >= 0 ? { date, category, amount, direction } : null;
}

export type LedgerGroup = {
  readonly month: string;
  readonly category: string;
  readonly amount: number;
  readonly financing: boolean;
};

export type LedgerTotals = { readonly month: string; readonly cashIn: number; readonly cashOut: number };

export type Ledger = {
  readonly groups: ReadonlyArray<LedgerGroup>;
  readonly totals: ReadonlyArray<LedgerTotals>;
  readonly warnings: ReadonlyArray<FinanceImportWarning>;
};

function mismatched(direction: string, amount: number): boolean {
  const label = direction.trim();
  if (label === "" || amount === 0) {
    return false;
  }
  return (IN_WORDS.test(label) && amount < 0) || (OUT_WORDS.test(label) && amount > 0);
}

function totalsOf(groups: ReadonlyArray<LedgerGroup>): LedgerTotals[] {
  const months = [...new Set(groups.map((group) => group.month))].sort();
  return months.map((month) => {
    const operating = groups.filter((group) => group.month === month && !group.financing);
    const cashIn = operating.filter((group) => group.amount > 0).reduce((sum, group) => sum + group.amount, 0);
    const cashOut = operating.filter((group) => group.amount < 0).reduce((sum, group) => sum - group.amount, 0);
    return { month, cashIn, cashOut };
  });
}

/** Every transaction row summed into one figure per month and category, signs kept as written. */
export function aggregateLedger(
  body: ReadonlyArray<ReadonlyArray<string>>,
  columns: LedgerColumns,
  style: NumberStyle,
): Ledger {
  const entries = body.flatMap((row) => {
    const month = monthOf(row[columns.date] ?? "");
    const amount = cellValue(row[columns.amount] ?? "", style);
    const category = (row[columns.category] ?? "").trim();
    if (month === null || amount === null || category === "") {
      return [];
    }
    const direction = columns.direction >= 0 ? (row[columns.direction] ?? "") : "";
    return [{ month, category, amount, direction, conflict: mismatched(direction, amount) }];
  });
  // A category name holds spaces, so month and category are paired rather than joined into a key.
  const pairs = entries
    .map((entry) => ({ month: entry.month, category: entry.category }))
    .filter(
      (pair, at, all) =>
        all.findIndex((other) => other.month === pair.month && other.category === pair.category) === at,
    )
    .sort((left, right) => left.month.localeCompare(right.month) || left.category.localeCompare(right.category));
  const groups = pairs.map((pair) => {
    const matching = entries.filter((entry) => entry.month === pair.month && entry.category === pair.category);
    return {
      month: pair.month,
      category: pair.category,
      amount: matching.reduce((sum, entry) => sum + entry.amount, 0),
      financing: FINANCING.test(pair.category),
    };
  });
  const conflicts = entries.filter((entry) => entry.conflict);
  const dropped = body.length - entries.length;
  return {
    groups,
    totals: totalsOf(groups),
    warnings: [
      ...(conflicts.length > 0
        ? [
            {
              code: "direction_mismatch" as const,
              message: `${conflicts.length} ledger rows have a direction that disagrees with the sign of the amount; the sign was kept`,
              detail: conflicts.map((entry) => `${entry.month} ${entry.category} ${entry.direction} ${entry.amount}`),
            },
          ]
        : []),
      ...(dropped > 0
        ? [
            {
              code: "dropped_rows" as const,
              message: `${dropped} ledger rows had no date, category or amount`,
              detail: [`${dropped} rows`],
            },
          ]
        : []),
    ],
  };
}
