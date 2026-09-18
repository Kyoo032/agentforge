/**
 * Every word the appraisal's report carries, in both languages.
 *
 * These are report content, not interface chrome: they end up inside the workbook, the deck and the
 * document as well as on screen, so they live beside the maths that produced them rather than in a
 * locale file the renderers cannot reach. One record per string keeps `id` and `en` impossible to
 * drift apart.
 */
import { formatNumber } from "../format-number";
import type { ReportLocale } from "../report";

export type Localized = { readonly id: string; readonly en: string };

function pick(text: Localized, locale: ReportLocale): string {
  return locale === "id" ? text.id : text.en;
}

export const APPRAISAL_TEXT = Object.freeze({
  netCashFlow: { id: "Arus kas bersih", en: "Net cash flow" },
  cumulative: { id: "Arus kas kumulatif", en: "Cumulative cash flow" },
  discounted: { id: "Arus kas terdiskonto", en: "Discounted cash flow" },
  cumulativeDiscounted: { id: "Arus terdiskonto kumulatif", en: "Cumulative discounted cash flow" },
  components: { id: "Komponen arus kas", en: "Cash flow components" },
  flowsTable: { id: "Arus kas per tahun", en: "Cash flow by year" },
  sensitivityTable: { id: "Grid sensitivitas NPV", en: "NPV sensitivity grid" },
  hurdlesTable: { id: "NPV pada beberapa tingkat rintangan", en: "NPV at several hurdle rates" },
  checksTable: { id: "Pemeriksaan", en: "Checks" },
  period: { id: "Periode", en: "Period" },
  label: { id: "Label", en: "Label" },
  category: { id: "Kategori", en: "Category" },
  amount: { id: "Nilai", en: "Amount" },
  currency: { id: "Mata uang", en: "Currency" },
  discountRate: { id: "Tingkat diskonto", en: "Discount rate" },
  npv: { id: "NPV", en: "NPV" },
  irr: { id: "IRR", en: "IRR" },
  mirr: { id: "MIRR", en: "MIRR" },
  payback: { id: "Payback sederhana", en: "Simple payback" },
  discountedPayback: { id: "Payback terdiskonto", en: "Discounted payback" },
  profitabilityIndex: { id: "Profitability index", en: "Profitability index" },
  breakevenRate: { id: "Tingkat diskonto impas", en: "Breakeven discount rate" },
  outlay: { id: "Investasi awal", en: "Initial outlay" },
  signChanges: { id: "Pergantian tanda arus kas", en: "Sign changes in the cash flows" },
  zeroCrossings: { id: "Perpotongan nol NPV(r)", en: "Zero crossings of NPV(r)" },
  financeRate: { id: "Tingkat pendanaan MIRR", en: "MIRR finance rate" },
  reinvestRate: { id: "Tingkat reinvestasi MIRR", en: "MIRR reinvestment rate" },
  baseColumn: { id: "Dasar", en: "Base" },
  metric: { id: "Metrik", en: "Metric" },
  value: { id: "Nilai", en: "Value" },
  unit: { id: "Satuan", en: "Unit" },
  formula: { id: "Rumus", en: "Formula" },
  years: { id: "tahun", en: "years" },
  cumulativeChart: { id: "Arus kas kumulatif", en: "Cumulative cash flow" },
  sensitivityChart: { id: "NPV menurut diskonto dan arus kas", en: "NPV by discount rate and cash flows" },
  assumptions: { id: "Asumsi", en: "Assumptions" },
  title: { id: "Kelayakan investasi", en: "Investment appraisal" },
} as const satisfies Record<string, Localized>);

export type AppraisalTextKey = keyof typeof APPRAISAL_TEXT;

/** One of the report's own strings, in the reader's language. */
export function appraisalText(key: AppraisalTextKey, locale: ReportLocale): string {
  return pick(APPRAISAL_TEXT[key], locale);
}

/** The section ids this task narrates, named for the reader. Must match `tasks.ts`. */
export const APPRAISAL_SECTIONS = Object.freeze([
  { id: "verdict", title: { id: "Apa yang ditunjukkan angkanya", en: "What the figures show" } },
  { id: "appraisal-metrics", title: { id: "Metrik kelayakan", en: "Appraisal metrics" } },
  { id: "sensitivity", title: { id: "Sensitivitas", en: "Sensitivity" } },
  { id: "assumptions", title: { id: "Asumsi", en: "Assumptions" } },
] as const);

/** "arus -10%" / "flows -10%", the column a sensitivity shift is shown under. */
export function shiftColumnLabel(shiftPercent: number, locale: ReportLocale): string {
  if (shiftPercent === 0) {
    return appraisalText("baseColumn", locale);
  }
  const sign = shiftPercent > 0 ? "+" : "";
  return locale === "id" ? `Arus ${sign}${shiftPercent}%` : `Flows ${sign}${shiftPercent}%`;
}

/**
 * "NPV @ 12%", the way every hurdle and every grid row names its rate. A whole rate keeps no
 * decimals — "NPV @ 12,00%" reads as a measurement rather than as the hurdle someone chose.
 */
export function rateLabel(ratePercent: number, locale: ReportLocale): string {
  const rate = formatNumber(ratePercent, locale, Number.isInteger(ratePercent) ? 0 : 2);
  return `${appraisalText("npv", locale)} @ ${rate}%`;
}
