/**
 * The subtotals a statement PRINTS, read back as figures the maths can be held against.
 *
 * `read-figures.ts` already keeps every `[subtotal]` row apart from the leaves so nothing is ever
 * summed twice. That list is not waste: `LABA USAHA (EBIT)` is the company's own assertion about its
 * operating profit, and a scorecard that rebuilds EBIT from the rows without ever looking at it can
 * be wrong by the whole of a cost line and say nothing. This file turns those printed rows into
 * named figures so `reconcile.ts` can compare the two readings and say so out loud when they differ.
 *
 * Three rules hold here:
 *  - **Order is meaning.** `JUMLAH LIABILITAS DAN EKUITAS` is the balance-sheet footing and not the
 *    liabilities total, and `Jumlah Aset Tidak Lancar` is not the current-asset total however much
 *    the word `lancar` it contains — so both are matched before the shorter rules get to them.
 *  - **A key is a metric key.** Every name here is one `keys.ts` already knows, so a printed subtotal
 *    and the figure it is compared against are labelled with the same words in both languages.
 *  - **Nothing is summed.** One printed row, one reading, one period.
 */
import { z } from "zod";
import { normalizeRatioLabel } from "./classify";

/** One `[subtotal]`-tagged row as the importer read it. Amounts keep the sheet's own sign. */
export type RatioStatedRow = {
  readonly label: string;
  readonly period?: string;
  readonly amount: number;
};

export const ratioStatedRowSchema = z.object({
  label: z.string().min(1),
  period: z.string().default(""),
  amount: z.number().finite(),
});

/**
 * The figures a printed subtotal can speak to. Every one of these is a metric key in `keys.ts`, so
 * the flag a reader sees names the figure the same way the scorecard does.
 */
export const RATIO_STATED_KEYS = [
  "currentAssets",
  "nonCurrentAssets",
  "totalAssets",
  "currentLiabilities",
  "nonCurrentLiabilities",
  "totalLiabilities",
  "totalEquity",
  "revenue",
  "grossProfit",
  "opex",
  "ebit",
  "profitBeforeTax",
  "netProfit",
] as const;

export type RatioStatedKey = (typeof RATIO_STATED_KEYS)[number];

export type RatioStatedTotals = Readonly<Partial<Record<RatioStatedKey, number>>>;

type StatedRule = {
  readonly key: RatioStatedKey | null;
  readonly pattern: RegExp;
};

const TOTAL = "(?:jumlah|total)";

/**
 * First match wins, so the longer reading always sits above the shorter one it contains. A rule with
 * a `null` key is a row that is deliberately NOT a figure: the balance-sheet footing repeats the
 * asset total and would otherwise be read as the liabilities total.
 */
const STATED_RULES: readonly StatedRule[] = Object.freeze([
  { key: null, pattern: new RegExp(`${TOTAL} (liabilitas|kewajiban|liabilities) (dan|and) (ekuitas|equity)`) },
  {
    key: "nonCurrentAssets",
    pattern: new RegExp(`${TOTAL} (aset|aktiva|assets?)[a-z ]*(tidak lancar|non current|noncurrent|tetap)`),
  },
  { key: "currentAssets", pattern: new RegExp(`${TOTAL} (aset|aktiva|assets?)[a-z ]*(lancar|current)`) },
  { key: "totalAssets", pattern: new RegExp(`${TOTAL} (aset|aktiva|assets?)\\b`) },
  {
    key: "currentLiabilities",
    pattern: new RegExp(`${TOTAL} (liabilitas|kewajiban|liabilities)[a-z ]*(jangka pendek|current|short term)`),
  },
  {
    key: "nonCurrentLiabilities",
    pattern: new RegExp(`${TOTAL} (liabilitas|kewajiban|liabilities)[a-z ]*(jangka panjang|non current|long term)`),
  },
  { key: "totalLiabilities", pattern: new RegExp(`${TOTAL} (liabilitas|kewajiban|liabilities)\\b`) },
  { key: "totalEquity", pattern: new RegExp(`${TOTAL} (ekuitas|equity)\\b`) },
  { key: "grossProfit", pattern: /\b(laba|rugi) kotor\b|gross (profit|margin amount)/ },
  { key: "opex", pattern: new RegExp(`${TOTAL} (beban usaha|beban operasi|biaya usaha|operating expense)`) },
  { key: "profitBeforeTax", pattern: /(laba|rugi) sebelum pajak|profit before tax|pre ?tax (profit|income)/ },
  { key: "ebit", pattern: /(laba|rugi) (usaha|operasi|operasional)|\bebit\b|operating (profit|income)/ },
  { key: "netProfit", pattern: /(laba|rugi) (bersih|neto|tahun berjalan)|net (profit|income|earnings)/ },
  { key: "revenue", pattern: new RegExp(`${TOTAL} (pendapatan|penjualan|revenue|sales)`) },
]);

/** Costs are printed either way round; a pile of spending is a size, not a direction. */
const MAGNITUDE_KEYS: ReadonlySet<RatioStatedKey> = new Set<RatioStatedKey>(["opex"]);

/** Which figure this printed subtotal is, or null when it is a footing or nothing we name. */
export function ratioStatedKeyFor(label: string): RatioStatedKey | null {
  const flat = normalizeRatioLabel(label);
  if (flat === "") {
    return null;
  }
  return STATED_RULES.find((rule) => rule.pattern.test(flat))?.key ?? null;
}

/**
 * The printed subtotals of ONE period, by figure.
 *
 * The first row that claims a key keeps it: a statement that repeats a total (a running footing, a
 * comparative block) is stating the same thing twice, and the first printing is the one in context.
 */
export function statedTotalsFor(rows: readonly RatioStatedRow[], period: string): RatioStatedTotals {
  const totals: Partial<Record<RatioStatedKey, number>> = {};
  for (const row of rows) {
    if ((row.period ?? "") !== period || !Number.isFinite(row.amount)) {
      continue;
    }
    const key = ratioStatedKeyFor(row.label);
    if (key === null || totals[key] !== undefined) {
      continue;
    }
    totals[key] = MAGNITUDE_KEYS.has(key) ? Math.abs(row.amount) : row.amount;
  }
  return totals;
}

/** The periods the printed subtotals cover, in the order they were printed. */
export function statedPeriods(rows: readonly RatioStatedRow[]): readonly string[] {
  const seen: string[] = [];
  for (const row of rows) {
    const period = row.period ?? "";
    if (!seen.includes(period)) {
      seen.push(period);
    }
  }
  return seen;
}
