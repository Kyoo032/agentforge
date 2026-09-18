/**
 * Every word this task's report puts on a page, in both languages.
 *
 * The report is not the studio: it is exported as a workbook, a deck and a document, and read long
 * after the session that produced it — so its own copy travels with it rather than being resolved
 * against whatever locale file the app happens to ship. The studio's chrome keeps its locale keys;
 * this is the report's own vocabulary.
 *
 * The band wording is deliberate. `bands.headline` says **rule-of-thumb**, in both languages,
 * because these thresholds are conventions and not advice, and the reader is entitled to see that
 * said out loud on the page rather than inferred from a colour.
 */
import type { LocalizedText } from "../tasks";
import type { ReportLocale } from "../report";
import type { RatioBandLevel, RatioTrendDirection } from "./bands";

export function say(text: LocalizedText, locale: ReportLocale): string {
  return locale === "id" ? text.id : text.en;
}

export const RATIO_TEXT = Object.freeze({
  subtitle: { id: "Posisi per", en: "Position as at" } satisfies LocalizedText,
  scorecardTitle: { id: "Kartu skor rasio", en: "Ratio scorecard" } satisfies LocalizedText,
  totalsTitle: { id: "Pos yang dijumlahkan", en: "Classified totals" } satisfies LocalizedText,
  trendTitle: { id: "Rasio antar periode", en: "Ratios across periods" } satisfies LocalizedText,
  resultTitle: { id: "Ikhtisar laba rugi", en: "Profit summary" } satisfies LocalizedText,
  bucketsTitle: { id: "Pengelompokan pos", en: "Line classification" } satisfies LocalizedText,
  balanceTitle: { id: "Uji keseimbangan neraca", en: "Balance check" } satisfies LocalizedText,
  inputsTitle: { id: "Baris yang dikonfirmasi", en: "Confirmed rows" } satisfies LocalizedText,
  calcTitle: { id: "Perhitungan", en: "Calculations" } satisfies LocalizedText,
  bandsTitle: { id: "Ambang rujukan", en: "Reference bands" } satisfies LocalizedText,
  columns: Object.freeze({
    label: { id: "Pos", en: "Line" },
    period: { id: "Periode", en: "Period" },
    bucket: { id: "Kelompok", en: "Bucket" },
    amount: { id: "Nilai", en: "Amount" },
    currency: { id: "Mata uang", en: "Currency" },
    metric: { id: "Metrik", en: "Metric" },
    value: { id: "Nilai", en: "Value" },
    display: { id: "Tampilan", en: "Display" },
    unit: { id: "Satuan", en: "Unit" },
    formula: { id: "Rumus", en: "Formula" },
    band: { id: "Band", en: "Band" },
    healthy: { id: "Ambang sehat", en: "Healthy at" },
    watch: { id: "Ambang waspada", en: "Watch at" },
    prior: { id: "Tahun sebelumnya", en: "Prior period" },
    trend: { id: "Arah", en: "Trend" },
    confidence: { id: "Keyakinan", en: "Confidence" },
    source: { id: "Dasar", en: "Evidence" },
    rule: { id: "Aturan", en: "Rule" },
    totalAssets: { id: "Jumlah aset", en: "Total assets" },
    totalLiabilities: { id: "Jumlah liabilitas", en: "Total liabilities" },
    totalEquity: { id: "Jumlah ekuitas", en: "Total equity" },
    difference: { id: "Selisih", en: "Difference" },
  }),
  bands: Object.freeze({
    headline: {
      id: "Band di bawah ini adalah ambang rujukan umum (rule of thumb), bukan tolok ukur industri dan bukan nasihat keuangan. Ambang dapat diubah di studio.",
      en: "The bands below are general rule-of-thumb thresholds, not an industry benchmark and not financial advice. They can be changed in the studio.",
    } satisfies LocalizedText,
    healthy: { id: "sehat", en: "healthy" } satisfies LocalizedText,
    watch: { id: "waspada", en: "watch" } satisfies LocalizedText,
    risk: { id: "berisiko", en: "risk" } satisfies LocalizedText,
    none: { id: "tanpa band", en: "no band" } satisfies LocalizedText,
  }),
  trend: Object.freeze({
    up: { id: "naik", en: "up" } satisfies LocalizedText,
    down: { id: "turun", en: "down" } satisfies LocalizedText,
    flat: { id: "tetap", en: "flat" } satisfies LocalizedText,
    none: { id: "—", en: "—" } satisfies LocalizedText,
  }),
  flags: Object.freeze({
    balanceBroken: {
      id: "Neraca tidak seimbang pada periode",
      en: "The balance sheet does not balance for period",
    } satisfies LocalizedText,
    unplaced: {
      id: "baris belum dikelompokkan dan tidak masuk ke rasio mana pun",
      en: "line(s) could not be classified and are in no ratio",
    } satisfies LocalizedText,
    stripped: {
      id: "Angka tanpa jejak dihapus dari narasi",
      en: "A figure that traced to nothing was removed from the narrative",
    } satisfies LocalizedText,
    repaired: {
      id: "tidak ada baris yang terbaca; nilainya diturunkan dari subtotal tercetak",
      en: "no row was readable; the value was backed out of the printed subtotal",
    } satisfies LocalizedText,
    statedMismatch: {
      id: "subtotal tercetak tidak sama dengan penjumlahan baris",
      en: "the printed subtotal does not equal the sum of the rows",
    } satisfies LocalizedText,
    statedWord: { id: "tercetak", en: "printed" } satisfies LocalizedText,
    derivedWord: { id: "dari baris", en: "from the rows" } satisfies LocalizedText,
  }),
  repair: Object.freeze({
    from: { id: "diturunkan dari", en: "derived from" } satisfies LocalizedText,
  }),
  notes: Object.freeze({
    method: { id: "Cara baca", en: "How to read this" } satisfies LocalizedText,
    methodBody: {
      id: "Semua rasio dihitung di kode dari baris yang sudah dikonfirmasi, memakai kolom periode terakhir saja; periode tidak pernah dijumlahkan. Tiap rasio menyebut pembilang dan penyebutnya.",
      en: "Every ratio is computed in code from the confirmed rows, using the newest period column only; periods are never summed. Each ratio names its numerator and denominator.",
    } satisfies LocalizedText,
    assumptions: { id: "Asumsi", en: "Assumptions" } satisfies LocalizedText,
  }),
  facts: Object.freeze({
    heading: {
      id: "Angka terhitung (sudah dihitung di kode; kutip lewat key-nya):",
      en: "Computed figures (already calculated in code; cite them by key):",
    } satisfies LocalizedText,
    empty: {
      id: "(tidak ada yang bisa dihitung dari baris ini)",
      en: "(nothing could be computed from these rows)",
    } satisfies LocalizedText,
    periodLine: { id: "Periode yang dibaca", en: "Period read" } satisfies LocalizedText,
    priorLine: { id: "Periode pembanding", en: "Prior period" } satisfies LocalizedText,
  }),
  gauge: Object.freeze({
    watchLabel: { id: "ambang waspada", en: "watch threshold" } satisfies LocalizedText,
    healthyLabel: { id: "ambang sehat", en: "healthy threshold" } satisfies LocalizedText,
  }),
});

const BAND_WORD: Readonly<Record<RatioBandLevel, LocalizedText>> = Object.freeze({
  healthy: RATIO_TEXT.bands.healthy,
  watch: RATIO_TEXT.bands.watch,
  risk: RATIO_TEXT.bands.risk,
});

export function bandWord(level: RatioBandLevel | null, locale: ReportLocale): string {
  return say(level === null ? RATIO_TEXT.bands.none : BAND_WORD[level], locale);
}

const TREND_WORD: Readonly<Record<RatioTrendDirection, LocalizedText>> = Object.freeze({
  up: RATIO_TEXT.trend.up,
  down: RATIO_TEXT.trend.down,
  flat: RATIO_TEXT.trend.flat,
});

export function trendWord(direction: RatioTrendDirection, hasPrior: boolean, locale: ReportLocale): string {
  return say(hasPrior ? TREND_WORD[direction] : RATIO_TEXT.trend.none, locale);
}
