/**
 * Every figure this task can put in front of a reader, named once.
 *
 * One list, in the order a scorecard reads: the piles first, then the profit line, then the ratios
 * themselves. The key is the stable identity (`quickRatio`), the unit says how it is drawn, and the
 * label is written in both languages here rather than in the report builder — so the workbook, the
 * deck, the screen and the model's fact sheet all name the same figure the same way.
 *
 * `balanceCheck` is in this list on purpose. A balance sheet that does not balance is a fact about
 * the reading, and it belongs beside the ratios rather than in a comment nobody exports.
 */
import type { LocalizedText } from "../tasks";

export const RATIO_UNITS = ["currency", "ratio", "percent", "days"] as const;
export type RatioUnit = (typeof RATIO_UNITS)[number];

export type RatioMetricMeta = {
  readonly key: string;
  readonly unit: RatioUnit;
  readonly label: LocalizedText;
  /** Which bucket totals go into it, in words. Shown to the reader and given to the model verbatim. */
  readonly formula: LocalizedText;
};

function meta(key: string, unit: RatioUnit, id: string, en: string, fid: string, fen: string): RatioMetricMeta {
  return { key, unit, label: { id, en }, formula: { id: fid, en: fen } };
}

/** The bucket totals a period is summed into. */
export const RATIO_TOTAL_METRICS: readonly RatioMetricMeta[] = Object.freeze([
  meta("cash", "currency", "Kas dan setara kas", "Cash and equivalents", "jumlah pos kas", "sum of the cash bucket"),
  meta("receivables", "currency", "Piutang", "Receivables", "jumlah pos piutang", "sum of the receivables bucket"),
  meta("inventory", "currency", "Persediaan", "Inventory", "jumlah pos persediaan", "sum of the inventory bucket"),
  meta(
    "currentAssets",
    "currency",
    "Jumlah aset lancar",
    "Total current assets",
    "kas + piutang + persediaan + aset lancar lain",
    "cash + receivables + inventory + other current assets",
  ),
  meta(
    "nonCurrentAssets",
    "currency",
    "Jumlah aset tidak lancar",
    "Total non-current assets",
    "aset tetap + akumulasi penyusutan (negatif) + aset tidak lancar lain",
    "fixed assets + contra assets (negative) + other non-current assets",
  ),
  meta(
    "totalAssets",
    "currency",
    "Jumlah aset",
    "Total assets",
    "aset lancar + aset tidak lancar",
    "current assets + non-current assets",
  ),
  meta(
    "currentLiabilities",
    "currency",
    "Jumlah liabilitas jangka pendek",
    "Total current liabilities",
    "liabilitas lancar + utang bank jangka pendek + bagian lancar utang jangka panjang",
    "current liabilities + short-term debt + current portion of long-term debt",
  ),
  meta(
    "nonCurrentLiabilities",
    "currency",
    "Jumlah liabilitas jangka panjang",
    "Total non-current liabilities",
    "utang jangka panjang + liabilitas jangka panjang lain",
    "long-term debt + other non-current liabilities",
  ),
  meta(
    "totalLiabilities",
    "currency",
    "Jumlah liabilitas",
    "Total liabilities",
    "liabilitas jangka pendek + liabilitas jangka panjang",
    "current liabilities + non-current liabilities",
  ),
  meta("totalEquity", "currency", "Jumlah ekuitas", "Total equity", "jumlah pos ekuitas", "sum of the equity bucket"),
  meta(
    "interestBearingDebt",
    "currency",
    "Utang berbunga",
    "Interest-bearing debt",
    "utang bank jangka pendek + bagian lancar utang jangka panjang + utang jangka panjang",
    "short-term debt + current portion of long-term debt + long-term debt",
  ),
  meta(
    "balanceCheck",
    "currency",
    "Selisih neraca",
    "Balance check",
    "jumlah aset - jumlah liabilitas - jumlah ekuitas",
    "total assets - total liabilities - total equity",
  ),
  meta(
    "workingCapital",
    "currency",
    "Modal kerja",
    "Working capital",
    "aset lancar - liabilitas jangka pendek",
    "current assets - current liabilities",
  ),
]);

/** The profit line, rebuilt from the buckets rather than read off a subtotal row. */
export const RATIO_RESULT_METRICS: readonly RatioMetricMeta[] = Object.freeze([
  meta("revenue", "currency", "Pendapatan", "Revenue", "jumlah pos pendapatan", "sum of the revenue bucket"),
  meta("cogs", "currency", "Harga pokok penjualan", "Cost of sales", "nilai mutlak pos HPP", "absolute value of the COGS bucket"),
  meta("grossProfit", "currency", "Laba kotor", "Gross profit", "pendapatan - HPP", "revenue - cost of sales"),
  meta("opex", "currency", "Beban usaha", "Operating expenses", "jumlah pos beban usaha", "sum of the opex bucket"),
  meta("ebit", "currency", "Laba usaha (EBIT)", "Operating profit (EBIT)", "laba kotor - beban usaha", "gross profit - operating expenses"),
  meta(
    "depreciation",
    "currency",
    "Penyusutan dan amortisasi",
    "Depreciation and amortisation",
    "jumlah pos penyusutan (data pendukung)",
    "sum of the depreciation bucket (supporting data)",
  ),
  meta("ebitda", "currency", "EBITDA", "EBITDA", "EBIT + penyusutan dan amortisasi", "EBIT + depreciation and amortisation"),
  meta("interestExpense", "currency", "Beban bunga", "Interest expense", "nilai mutlak pos beban bunga", "absolute value of the interest bucket"),
  meta("tax", "currency", "Beban pajak", "Tax expense", "nilai mutlak pos pajak", "absolute value of the tax bucket"),
  meta("otherIncome", "currency", "Pendapatan (beban) lain-lain", "Other income (expense)", "jumlah pos lain-lain", "sum of the other-income bucket"),
  meta("profitBeforeTax", "currency", "Laba sebelum pajak", "Profit before tax", "EBIT - beban bunga + lain-lain", "EBIT - interest + other income"),
  meta("netProfit", "currency", "Laba bersih", "Net profit", "laba sebelum pajak - beban pajak", "profit before tax - tax"),
  meta(
    "principalRepayment",
    "currency",
    "Pembayaran pokok pinjaman",
    "Principal repayment",
    "jumlah pos pembayaran pokok (data pendukung)",
    "sum of the principal-repayment bucket (supporting data)",
  ),
  meta(
    "debtService",
    "currency",
    "Beban pelunasan utang",
    "Debt service",
    "beban bunga + pembayaran pokok",
    "interest expense + principal repayment",
  ),
]);

/** The ratios themselves. Three debt-to-equity readings and two DSCR bases, each labelled. */
export const RATIO_RATIO_METRICS: readonly RatioMetricMeta[] = Object.freeze([
  meta("currentRatio", "ratio", "Rasio lancar", "Current ratio", "aset lancar / liabilitas jangka pendek", "current assets / current liabilities"),
  meta(
    "quickRatio",
    "ratio",
    "Rasio cepat",
    "Quick ratio",
    "(aset lancar - persediaan) / liabilitas jangka pendek",
    "(current assets - inventory) / current liabilities",
  ),
  meta("cashRatio", "ratio", "Rasio kas", "Cash ratio", "kas / liabilitas jangka pendek", "cash / current liabilities"),
  meta(
    "debtToEquityTotal",
    "ratio",
    "Utang terhadap ekuitas (total liabilitas)",
    "Debt to equity (total liabilities)",
    "jumlah liabilitas / jumlah ekuitas",
    "total liabilities / total equity",
  ),
  meta(
    "debtToEquityInterestBearing",
    "ratio",
    "Utang berbunga terhadap ekuitas",
    "Debt to equity (interest-bearing)",
    "utang berbunga / jumlah ekuitas",
    "interest-bearing debt / total equity",
  ),
  meta(
    "nonCurrentDebtToEquity",
    "ratio",
    "Liabilitas jangka panjang terhadap ekuitas",
    "Debt to equity (long-term only)",
    "liabilitas jangka panjang / jumlah ekuitas",
    "non-current liabilities / total equity",
  ),
  meta("debtToAssets", "ratio", "Utang terhadap aset", "Debt to assets", "jumlah liabilitas / jumlah aset", "total liabilities / total assets"),
  meta("equityRatio", "ratio", "Rasio ekuitas", "Equity ratio", "jumlah ekuitas / jumlah aset", "total equity / total assets"),
  meta("interestCoverage", "ratio", "Kemampuan menutup bunga", "Interest coverage", "EBIT / beban bunga", "EBIT / interest expense"),
  meta("dscrEbitda", "ratio", "DSCR (basis EBITDA)", "DSCR (EBITDA basis)", "EBITDA / beban pelunasan utang", "EBITDA / debt service"),
  meta("dscrEbit", "ratio", "DSCR (basis EBIT)", "DSCR (EBIT basis)", "EBIT / beban pelunasan utang", "EBIT / debt service"),
  meta("grossMarginPct", "percent", "Margin kotor", "Gross margin", "laba kotor / pendapatan", "gross profit / revenue"),
  meta("operatingMarginPct", "percent", "Margin usaha", "Operating margin", "EBIT / pendapatan", "EBIT / revenue"),
  meta("netMarginPct", "percent", "Margin bersih", "Net margin", "laba bersih / pendapatan", "net profit / revenue"),
  meta("returnOnAssetsPct", "percent", "Imbal hasil aset", "Return on assets", "laba bersih / jumlah aset", "net profit / total assets"),
  meta("returnOnEquityPct", "percent", "Imbal hasil ekuitas", "Return on equity", "laba bersih / jumlah ekuitas", "net profit / total equity"),
  meta("assetTurnover", "ratio", "Perputaran aset", "Asset turnover", "pendapatan / jumlah aset", "revenue / total assets"),
  meta("inventoryTurnover", "ratio", "Perputaran persediaan", "Inventory turnover", "HPP / persediaan", "cost of sales / inventory"),
  meta("inventoryDays", "days", "Hari persediaan", "Inventory days", "hari setahun / perputaran persediaan", "days per year / inventory turnover"),
  meta("receivableDays", "days", "Hari piutang", "Receivable days", "piutang / pendapatan x hari setahun", "receivables / revenue x days per year"),
]);

export const RATIO_METRICS: readonly RatioMetricMeta[] = Object.freeze([
  ...RATIO_TOTAL_METRICS,
  ...RATIO_RESULT_METRICS,
  ...RATIO_RATIO_METRICS,
]);

export type RatioMetricKey = string;

const BY_KEY = new Map(RATIO_METRICS.map((entry) => [entry.key, entry]));

export function ratioMetricMeta(key: string): RatioMetricMeta | null {
  return BY_KEY.get(key) ?? null;
}
