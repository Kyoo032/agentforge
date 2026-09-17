/**
 * A transaction list read as a cash book, defensively.
 *
 * The importer already aggregates a bank export to month × category, and when it has, this module has
 * nothing to do. It exists for the day it has not: an export pasted by hand, a sheet the reader
 * assembled, a file shape the importer did not recognise. A hundred and twenty undated-by-month lines
 * are not periods, and summing them as one figure is the wrong answer rather than a rough one.
 *
 * Two rules, both the ones the eval cases are built to catch:
 * - **The sign wins.** A refund booked "out" with a positive amount is money coming back. Re-deriving
 *   the direction from the label flips it and doubles the error.
 * - **Financing is not revenue.** A funding round moves the balance and never enters operating cash
 *   in, gross burn or net burn.
 */
import { monthOf } from "../import-table";

/** One transaction, after the amount has been read as a number and the sign kept as written. */
export type CashflowLedgerEntry = {
  readonly date: string;
  readonly category: string;
  readonly amount: number;
};

export type CashflowLedgerGroup = {
  readonly month: string;
  readonly category: string;
  readonly amount: number;
  readonly financing: boolean;
};

export type CashflowLedgerTotals = {
  readonly month: string;
  readonly cashIn: number;
  readonly cashOut: number;
  readonly financingIn: number;
};

export type CashflowLedger = {
  readonly groups: readonly CashflowLedgerGroup[];
  readonly totals: readonly CashflowLedgerTotals[];
  /** Rows that carried no month and could not be placed in a period. */
  readonly undated: number;
};

/** Money that came from a funding round, a loan or an owner: it is not trade, whatever the sheet says. */
const FINANCING =
  /financ|funding|pendanaan|investasi|invest|safe note|\bsafe\b|equity|ekuitas|loan|pinjaman|modal|share capital|setoran/i;

export function isFinancingCategory(category: string): boolean {
  return FINANCING.test(category);
}

/** Group by month and category, signs kept. The month is the date's own year and month, never a guess. */
export function aggregateCashflowLedger(entries: readonly CashflowLedgerEntry[]): CashflowLedger {
  const dated = entries.flatMap((entry) => {
    const month = monthOf(entry.date);
    return month === null ? [] : [{ ...entry, month }];
  });
  const keys: { month: string; category: string }[] = [];
  for (const entry of dated) {
    if (!keys.some((key) => key.month === entry.month && key.category === entry.category)) {
      keys.push({ month: entry.month, category: entry.category });
    }
  }
  const groups = keys
    .map((key) => ({
      month: key.month,
      category: key.category,
      amount: dated
        .filter((entry) => entry.month === key.month && entry.category === key.category)
        .reduce((sum, entry) => sum + entry.amount, 0),
      financing: isFinancingCategory(key.category),
    }))
    .sort((left, right) => left.month.localeCompare(right.month) || left.category.localeCompare(right.category));
  return { groups, totals: totalsOf(groups), undated: entries.length - dated.length };
}

/**
 * One month's two sides. A category's *net* sign decides which side it is on, so a month whose refunds
 * outweighed its spend on one category reads as cash in on that category — which is what happened.
 */
function totalsOf(groups: readonly CashflowLedgerGroup[]): CashflowLedgerTotals[] {
  const months = [...new Set(groups.map((group) => group.month))].sort();
  return months.map((month) => {
    const inMonth = groups.filter((group) => group.month === month);
    const operating = inMonth.filter((group) => !group.financing);
    return {
      month,
      cashIn: operating.filter((group) => group.amount > 0).reduce((sum, group) => sum + group.amount, 0),
      cashOut: operating.filter((group) => group.amount < 0).reduce((sum, group) => sum - group.amount, 0),
      financingIn: inMonth.filter((group) => group.financing).reduce((sum, group) => sum + group.amount, 0),
    };
  });
}
