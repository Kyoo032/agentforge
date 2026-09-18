/**
 * Every word the budget report puts on screen, in both languages.
 *
 * Core carries no i18n runtime, and it must not: the report is the one object the workbook, the deck,
 * the document and the browser all read, so its column headers and its section names have to be
 * decided once, here, rather than four times downstream. The web locale files carry the *studio's*
 * copy; this file carries the *report's*.
 *
 * One rule these strings keep: a roll-up is never named after the sheet's own subtotal row. A report
 * that writes "Total revenue" next to the revenue lines invites exactly the double counting the
 * whole task exists to avoid, so the roll-ups say "all lines" instead.
 */
import type { ReportLocale } from "../report";
import type { BudgetPairProposal } from "./match";
import type { BudgetDirection } from "./variance";
import type { BudgetAggregateId } from "./variance";

type Pair = Readonly<Record<ReportLocale, string>>;

function pick(pair: Pair, locale: ReportLocale): string {
  return pair[locale] ?? pair.en;
}

const WORDS = Object.freeze({
  title: { id: "Anggaran vs realisasi", en: "Budget vs actual" },
  subtitle: { id: "Selisih per baris, hanya yang lewat batas dijelaskan", en: "Variance per line; only the lines over the limit are explained" },
  line: { id: "Baris", en: "Line item" },
  budget: { id: "Anggaran", en: "Budget" },
  actual: { id: "Realisasi", en: "Actual" },
  variance: { id: "Selisih", en: "Variance" },
  variancePct: { id: "Selisih %", en: "Variance %" },
  direction: { id: "Arah", en: "Direction" },
  flag: { id: "Tanda", en: "Flag" },
  partner: { id: "Pasangan", en: "Partner" },
  match: { id: "Kecocokan", en: "Match" },
  period: { id: "Periode", en: "Period" },
  section: { id: "Pos", en: "Section" },
  reading: { id: "Bacaan", en: "Reading" },
  fullPeriod: { id: "Seluruh periode", en: "Full period" },
  flagged: { id: "ditandai", en: "flagged" },
  withinLimit: { id: "dalam batas", en: "within limit" },
  favourable: { id: "menguntungkan", en: "favourable" },
  unfavourable: { id: "tidak menguntungkan", en: "unfavourable" },
  neutral: { id: "sesuai anggaran", en: "on budget" },
  unmatched: { id: "tak berpasangan", en: "unmatched" },
  budgetOnly: { id: "hanya di anggaran", en: "budget only" },
  actualOnly: { id: "hanya di realisasi", en: "actual only" },
  varianceTable: { id: "Selisih per baris", en: "Variance by line" },
  periodTable: { id: "Selisih per baris —", en: "Variance by line —" },
  aggregateTable: { id: "Selisih per pos", en: "Variance by section" },
  flagsTable: { id: "Baris ditandai per periode", en: "Flagged lines by period" },
  flagCountsTable: { id: "Jumlah baris ditandai", en: "Flagged-line counts" },
  inputsTable: { id: "Baris yang dikonfirmasi", en: "Confirmed rows" },
  calcTable: { id: "Perhitungan", en: "Calc" },
  varianceChart: { id: "Selisih per baris", en: "Variance by line" },
  periodChart: { id: "Selisih per pos, tiap periode", en: "Variance by section, per period" },
  flaggedNote: { id: "Baris yang ditandai", en: "Flagged lines" },
  unmatchedNote: { id: "Baris tak berpasangan", en: "Unmatched lines" },
  excludedNote: { id: "Baris yang tidak ikut dihitung", en: "Rows left out of the comparison" },
  basisNote: { id: "Dasar perhitungan", en: "How this was computed" },
  noFlagged: { id: "Tidak ada baris yang melewati batas.", en: "No line ran past the limit." },
  noUnmatched: { id: "Setiap baris menemukan pasangannya.", en: "Every line found its partner." },
  linesCount: { id: "Baris dibandingkan", en: "Lines compared" },
  flaggedCount: { id: "Baris ditandai", en: "Lines flagged" },
  unmatchedCount: { id: "Baris tak berpasangan", en: "Lines unmatched" },
  chartCap: { id: "Hanya baris dengan selisih terbesar yang digambar.", en: "Only the largest variances are drawn." },
});

export type BudgetWord = keyof typeof WORDS;

export function budgetWord(key: BudgetWord, locale: ReportLocale): string {
  return pick(WORDS[key], locale);
}

const AGGREGATE_NAMES: Readonly<Record<BudgetAggregateId, Pair>> = Object.freeze({
  revenue: { id: "Pendapatan, semua baris", en: "Revenue, all lines" },
  cogs: { id: "Harga pokok, semua baris", en: "Cost of sales, all lines" },
  opex: { id: "Beban operasional, semua baris", en: "Operating expenses, all lines" },
  cost: { id: "Beban, semua baris", en: "Costs, all lines" },
  grossProfit: { id: "Laba kotor", en: "Gross profit" },
  result: { id: "Surplus/(defisit)", en: "Operating result" },
});

/** The name a roll-up carries. Deliberately not the sheet's own subtotal wording. */
export function budgetAggregateName(id: BudgetAggregateId, locale: ReportLocale): string {
  return pick(AGGREGATE_NAMES[id], locale);
}

/**
 * What argued for a pair, in the reader's language.
 *
 * The matcher keeps four stages apart because they score differently; a report only has room for the
 * kind of argument, so the dictionary and the trigrams both read as "wording". A stage nobody listed
 * reads as "unmatched", which is the safe sentence: it claims nothing.
 */
const STAGE_WORDS: Readonly<Record<string, Pair>> = Object.freeze({
  exact: { id: "label sama", en: "same label" },
  dictionary: { id: "kamus keuangan", en: "finance dictionary" },
  trigram: { id: "ejaan mirip", en: "similar wording" },
  embedding: { id: "makna mirip", en: "similar meaning" },
  manual: { id: "diatur pengguna", en: "set by hand" },
  ambiguous: { id: "terlalu mirip untuk dipilih", en: "too close to call" },
});

export function budgetStageWord(stage: BudgetPairProposal["stage"], locale: ReportLocale): string {
  const word = STAGE_WORDS[stage];
  return word ? pick(word, locale) : budgetWord("unmatched", locale);
}

export function budgetDirectionWord(direction: BudgetDirection, locale: ReportLocale): string {
  return budgetWord(direction === "neutral" ? "neutral" : direction, locale);
}

/** How the threshold rule reads in one sentence, with the two limits already formatted. */
export function budgetThresholdSentence(
  locale: ReportLocale,
  amount: string,
  percent: string,
  mode: "and" | "or",
): string {
  if (locale === "id") {
    const joiner = mode === "and" ? "sekaligus" : "atau";
    return `Baris ditandai bila selisihnya minimal ${amount} ${joiner} minimal ${percent} dari anggarannya.`;
  }
  const joiner = mode === "and" ? "and" : "or";
  return `A line is flagged when its variance is at least ${amount} ${joiner} at least ${percent} of its budget.`;
}
