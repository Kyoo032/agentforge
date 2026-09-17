/**
 * The period ladder written out as metrics, in the reader's own language.
 *
 * One entry per figure per period, so eight quarters answer with eight values and a two-year
 * statement answers with two — the brief no longer has to pick "the" period and hope it was the one
 * the question meant. Keys stay English and stable (`gross_margin 2024`); only labels move with the
 * locale, because a key is a contract and a label is prose.
 */
import type { ReportLocale } from "./report";
import type { PeriodFigures } from "./period-figures";
import type { Metric } from "./types";

export const PERCENT_UNIT = "%";
export const RATIO_UNIT = "x";

type Labels = Record<ReportLocale, string>;

/** base key → [label, unit is currency?, formula] */
const LADDER: ReadonlyArray<{
  readonly key: keyof PeriodFigures;
  readonly base: string;
  readonly labels: Labels;
  readonly percent?: true;
  /** "6,9 kali", not "6,9 IDR": a coverage is a multiple of the thing it covers. */
  readonly ratio?: true;
  readonly formula: string;
}> = [
  { key: "revenue", base: "revenue", labels: { en: "Revenue", id: "Pendapatan" }, formula: "sum(revenue rows)" },
  {
    key: "cogs",
    base: "cogs",
    labels: { en: "Cost of revenue", id: "Harga pokok penjualan" },
    formula: "sum(cogs rows)",
  },
  {
    key: "grossProfit",
    base: "gross_profit",
    labels: { en: "Gross profit", id: "Laba kotor" },
    formula: "revenue - cogs",
  },
  {
    key: "grossMarginPct",
    base: "gross_margin",
    labels: { en: "Gross margin", id: "Marjin kotor" },
    percent: true,
    formula: "(revenue - cogs) / revenue",
  },
  {
    key: "cogsRatioPct",
    base: "cogs_ratio",
    labels: { en: "Cost of revenue as % of revenue", id: "HPP terhadap pendapatan" },
    percent: true,
    formula: "cogs / revenue",
  },
  { key: "opex", base: "opex", labels: { en: "Operating expenses", id: "Beban usaha" }, formula: "sum(opex rows)" },
  {
    key: "operatingProfit",
    base: "operating_profit",
    labels: { en: "Operating profit", id: "Laba usaha" },
    formula: "gross profit - opex",
  },
  {
    key: "operatingMarginPct",
    base: "operating_margin",
    labels: { en: "Operating margin", id: "Marjin usaha" },
    percent: true,
    formula: "operating profit / revenue",
  },
  {
    key: "interestExpense",
    base: "interest_expense",
    labels: { en: "Interest expense", id: "Beban bunga" },
    formula: "sum(interest rows)",
  },
  {
    key: "otherIncome",
    base: "other_income",
    labels: { en: "Other income", id: "Pendapatan lain-lain" },
    formula: "sum(other income rows)",
  },
  {
    key: "pretaxProfit",
    base: "pretax_profit",
    labels: { en: "Profit before tax", id: "Laba sebelum pajak" },
    formula: "operating profit - interest + other income",
  },
  {
    key: "taxExpense",
    base: "tax_expense",
    labels: { en: "Tax expense", id: "Beban pajak" },
    formula: "sum(tax rows)",
  },
  {
    key: "netProfitAfterTax",
    base: "net_profit_after_tax",
    labels: { en: "Net profit after tax", id: "Laba bersih setelah pajak" },
    formula: "profit before tax - tax",
  },
  {
    key: "netProfit",
    base: "net_profit",
    labels: { en: "Net profit", id: "Laba bersih" },
    formula: "after tax when tax is stated, otherwise operating profit",
  },
  {
    key: "netMarginPct",
    base: "net_margin",
    labels: { en: "Net margin", id: "Marjin bersih" },
    percent: true,
    formula: "net profit / revenue",
  },
  {
    key: "effectiveTaxRatePct",
    base: "effective_tax_rate",
    labels: { en: "Effective tax rate", id: "Tarif pajak efektif" },
    percent: true,
    formula: "tax / profit before tax",
  },
  {
    key: "interestCoverage",
    base: "interest_coverage",
    labels: { en: "Interest coverage", id: "Kemampuan membayar bunga" },
    ratio: true,
    formula: "operating profit / interest expense",
  },
  { key: "cash", base: "cash", labels: { en: "Cash on hand", id: "Kas" }, formula: "sum(cash rows)" },
  {
    key: "operatingCashFlow",
    base: "operating_cash_flow",
    labels: { en: "Operating cash flow", id: "Arus kas operasi" },
    formula: "as stated on the cash-flow statement",
  },
  {
    key: "investingCashFlow",
    base: "investing_cash_flow",
    labels: { en: "Investing cash flow", id: "Arus kas investasi" },
    formula: "as stated on the cash-flow statement",
  },
  {
    key: "financingCashFlow",
    base: "financing_cash_flow",
    labels: { en: "Financing cash flow", id: "Arus kas pendanaan" },
    formula: "as stated on the cash-flow statement",
  },
  {
    key: "freeCashFlow",
    base: "free_cash_flow",
    labels: { en: "Free cash flow", id: "Arus kas bebas" },
    formula: "operating cash flow + investing cash flow",
  },
  {
    key: "cashChange",
    base: "cash_change",
    labels: { en: "Change in cash", id: "Perubahan kas" },
    formula: "operating + investing + financing",
  },
  { key: "burn", base: "burn", labels: { en: "Net burn", id: "Burn kas" }, formula: "as stated on the sheet" },
];

export function suffixed(base: string, period: string): string {
  return period ? `${base} ${period}` : base;
}

function labelFor(labels: Labels, locale: ReportLocale, period: string): string {
  return suffixed(labels[locale] ?? labels.en, period);
}

export type PeriodMetricOptions = {
  readonly locale: ReportLocale;
  readonly currency: string;
};

/** Every stated figure for one period, skipping the ones this period cannot support. */
export function periodLadderMetrics(figures: PeriodFigures, period: string, options: PeriodMetricOptions): Metric[] {
  return LADDER.flatMap((entry) => {
    const value = figures[entry.key];
    if (value === null || value === undefined) {
      return [];
    }
    // `net_profit` repeats `net_profit_after_tax` whenever tax is stated; one row is enough.
    if (entry.base === "net_profit" && figures.netProfitAfterTax !== null) {
      return [];
    }
    return [
      {
        key: suffixed(entry.base, period),
        label: labelFor(entry.labels, options.locale, period),
        value,
        unit: entry.percent ? PERCENT_UNIT : entry.ratio ? RATIO_UNIT : options.currency,
        period,
        formula: entry.formula,
      },
    ];
  });
}
