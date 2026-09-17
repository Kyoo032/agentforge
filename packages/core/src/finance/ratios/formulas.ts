/**
 * The Calc sheet as live Excel, mirroring the maths in `compute.ts` cell for cell.
 *
 * The point is that a reader can change one row on the Inputs sheet and watch every ratio move —
 * which is only honest if the workbook divides the same piles the report did. So the formulas are
 * built from the same bucket-membership table the totals are: `interestBearingDebt` sums exactly the
 * three buckets `bucketsFeeding` names, and adding a bucket in `buckets.ts` changes both at once.
 *
 * Inputs columns are A Label, B Period, C Bucket, D Amount, E Currency; Calc columns are A Metric,
 * B Value, C Unit, D Period, E Formula. Nothing the user typed is ever inlined into a formula: the
 * only literals are our own bucket names, and the period is addressed as the row's own Period cell.
 *
 * `ABS` appears wherever a bucket's sign policy does. A sheet that writes `Harga Pokok Penjualan`
 * negative and `Beban Penjualan` positive has to end in the same EBIT either way, and that reading
 * is the one place where the workbook assumes a bucket's rows share a sign.
 */
import { REPORT_TABLE_FIRST_DATA_ROW } from "../report";
import {
  RATIO_BUCKET_SIGN,
  bucketsFeeding,
  type RatioAggregate,
  type RatioBucket,
} from "./buckets";

/** The Inputs sheet this task writes, in column order. */
export const RATIO_INPUTS_COLUMNS = ["Label", "Period", "Bucket", "Amount", "Currency"] as const;
/** The Calc sheet this task writes, in column order. */
export const RATIO_CALC_COLUMNS = ["Metric", "Value", "Unit", "Period", "Formula"] as const;
/** Index of the Calc column a metric's live formula is written into. */
export const RATIO_CALC_VALUE_COLUMN = 1;

const AMOUNT = "Inputs!$D:$D";
const BUCKET = "Inputs!$C:$C";
const PERIOD = "Inputs!$B:$B";
const CALC_PERIOD_COLUMN = "D";

function periodRef(rowIndex: number): string {
  return `$${CALC_PERIOD_COLUMN}${REPORT_TABLE_FIRST_DATA_ROW + rowIndex}`;
}

/** One bucket's total for the row's own period, with that bucket's sign policy applied. */
function bucketSum(bucket: RatioBucket, rowIndex: number): string {
  const sum = `SUMIFS(${AMOUNT},${BUCKET},"${bucket}",${PERIOD},${periodRef(rowIndex)})`;
  const sign = RATIO_BUCKET_SIGN[bucket];
  if (sign === "magnitude") {
    return `ABS(${sum})`;
  }
  return sign === "negative" ? `-ABS(${sum})` : sum;
}

/** One aggregate: every bucket that feeds it, added once. */
function agg(name: RatioAggregate, rowIndex: number): string {
  const parts = bucketsFeeding(name).map((bucket) => bucketSum(bucket, rowIndex));
  return parts.length === 0 ? "0" : `(${parts.join("+")})`;
}

function div(numerator: string, denominator: string): string {
  return `IFERROR(${numerator}/${denominator},"")`;
}

function pct(numerator: string, denominator: string): string {
  return `IFERROR(${numerator}/${denominator}*100,"")`;
}

type Build = (rowIndex: number) => string;

/** The intermediate expressions every metric below is composed from. */
function parts(row: number) {
  const currentAssets = agg("currentAssets", row);
  const nonCurrentAssets = agg("nonCurrentAssets", row);
  const currentLiabilities = agg("currentLiabilities", row);
  const nonCurrentLiabilities = agg("nonCurrentLiabilities", row);
  const equity = agg("equity", row);
  const revenue = agg("revenue", row);
  const cogs = agg("cogs", row);
  const opex = agg("opex", row);
  const depreciation = agg("depreciation", row);
  const interest = agg("interest", row);
  const tax = agg("tax", row);
  const otherIncome = agg("otherIncome", row);
  const principal = agg("principalRepayment", row);
  const totalAssets = `(${currentAssets}+${nonCurrentAssets})`;
  const totalLiabilities = `(${currentLiabilities}+${nonCurrentLiabilities})`;
  const grossProfit = `(${revenue}-${cogs})`;
  const ebit = `(${grossProfit}-${opex})`;
  const ebitda = `(${ebit}+${depreciation})`;
  const profitBeforeTax = `(${ebit}-${interest}+${otherIncome})`;
  const netProfit = `(${profitBeforeTax}-${tax})`;
  return {
    currentAssets,
    nonCurrentAssets,
    totalAssets,
    currentLiabilities,
    nonCurrentLiabilities,
    totalLiabilities,
    interestBearingDebt: agg("interestBearingDebt", row),
    equity,
    cash: bucketSum("cash", row),
    receivables: bucketSum("receivables", row),
    inventory: bucketSum("inventory", row),
    revenue,
    cogs,
    opex,
    depreciation,
    interest,
    tax,
    otherIncome,
    principal,
    grossProfit,
    ebit,
    ebitda,
    profitBeforeTax,
    netProfit,
    debtService: `(${interest}+${principal})`,
  };
}

/** Every metric the workbook can recompute, as a builder keyed by the metric's own key. */
const BUILDERS: Readonly<Record<string, Build>> = Object.freeze({
  cash: (row) => parts(row).cash,
  receivables: (row) => parts(row).receivables,
  inventory: (row) => parts(row).inventory,
  currentAssets: (row) => parts(row).currentAssets,
  nonCurrentAssets: (row) => parts(row).nonCurrentAssets,
  totalAssets: (row) => parts(row).totalAssets,
  currentLiabilities: (row) => parts(row).currentLiabilities,
  nonCurrentLiabilities: (row) => parts(row).nonCurrentLiabilities,
  totalLiabilities: (row) => parts(row).totalLiabilities,
  totalEquity: (row) => parts(row).equity,
  interestBearingDebt: (row) => parts(row).interestBearingDebt,
  balanceCheck: (row) => {
    const p = parts(row);
    return `${p.totalAssets}-${p.totalLiabilities}-${p.equity}`;
  },
  workingCapital: (row) => {
    const p = parts(row);
    return `${p.currentAssets}-${p.currentLiabilities}`;
  },
  revenue: (row) => parts(row).revenue,
  cogs: (row) => parts(row).cogs,
  grossProfit: (row) => parts(row).grossProfit,
  opex: (row) => parts(row).opex,
  ebit: (row) => parts(row).ebit,
  depreciation: (row) => parts(row).depreciation,
  ebitda: (row) => parts(row).ebitda,
  interestExpense: (row) => parts(row).interest,
  tax: (row) => parts(row).tax,
  otherIncome: (row) => parts(row).otherIncome,
  profitBeforeTax: (row) => parts(row).profitBeforeTax,
  netProfit: (row) => parts(row).netProfit,
  principalRepayment: (row) => parts(row).principal,
  debtService: (row) => parts(row).debtService,
  currentRatio: (row) => div(parts(row).currentAssets, parts(row).currentLiabilities),
  quickRatio: (row) => {
    const p = parts(row);
    return div(`(${p.currentAssets}-${p.inventory})`, p.currentLiabilities);
  },
  cashRatio: (row) => div(parts(row).cash, parts(row).currentLiabilities),
  debtToEquityTotal: (row) => div(parts(row).totalLiabilities, parts(row).equity),
  debtToEquityInterestBearing: (row) => div(parts(row).interestBearingDebt, parts(row).equity),
  nonCurrentDebtToEquity: (row) => div(parts(row).nonCurrentLiabilities, parts(row).equity),
  debtToAssets: (row) => div(parts(row).totalLiabilities, parts(row).totalAssets),
  equityRatio: (row) => div(parts(row).equity, parts(row).totalAssets),
  interestCoverage: (row) => div(parts(row).ebit, parts(row).interest),
  dscrEbitda: (row) => div(parts(row).ebitda, parts(row).debtService),
  dscrEbit: (row) => div(parts(row).ebit, parts(row).debtService),
  grossMarginPct: (row) => pct(parts(row).grossProfit, parts(row).revenue),
  operatingMarginPct: (row) => pct(parts(row).ebit, parts(row).revenue),
  netMarginPct: (row) => pct(parts(row).netProfit, parts(row).revenue),
  returnOnAssetsPct: (row) => pct(parts(row).netProfit, parts(row).totalAssets),
  returnOnEquityPct: (row) => pct(parts(row).netProfit, parts(row).equity),
  assetTurnover: (row) => div(parts(row).revenue, parts(row).totalAssets),
  inventoryTurnover: (row) => div(parts(row).cogs, parts(row).inventory),
});

/** The live formula for this metric's Value cell, or null when the workbook cannot express it. */
export function ratioMetricFormula(key: string, rowIndex: number): string | null {
  const build = BUILDERS[key];
  return build ? build(rowIndex) : null;
}

/** A formula matrix parallel to the Calc rows: the Value column only, null everywhere else. */
export function ratioCalcFormulas(keys: readonly string[]): (string | null)[][] {
  return keys.map((key, rowIndex) =>
    RATIO_CALC_COLUMNS.map((_column, columnIndex) =>
      columnIndex === RATIO_CALC_VALUE_COLUMN ? ratioMetricFormula(key, rowIndex) : null,
    ),
  );
}
