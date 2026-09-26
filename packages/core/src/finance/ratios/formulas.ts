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
 *
 * A pile with no row in the period is not a pile of zero. The report states nothing for it
 * (`present` in `compute.ts`), so the workbook shows nothing either: each formula is wrapped in
 * `IF(COUNTIFS(…)=0,"",…)` over the piles it cannot be stated without — the same blank the `IFERROR`
 * around a division writes. A typed supporting figure is an Inputs row, so it counts as a row here.
 */
import { REPORT_TABLE_FIRST_DATA_ROW } from "../report";
import { RATIO_BUCKET_SIGN, bucketsFeeding, type RatioAggregate, type RatioBucket } from "./buckets";

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

/** The buckets a pile is summed from: one row in any of them in the period, and the pile exists. */
type Pile = readonly RatioBucket[];

function pile(...names: readonly RatioAggregate[]): Pile {
  return [...new Set(names.flatMap((name) => bucketsFeeding(name)))];
}

/**
 * Every pile a metric can be missing for, each read the way `compute.ts` reads it: a total exists
 * when either half does (`sum`), a bucket or an aggregate when it has a row (`present`).
 */
const PILE = Object.freeze({
  cash: ["cash"],
  receivables: ["receivables"],
  inventory: ["inventory"],
  currentAssets: pile("currentAssets"),
  nonCurrentAssets: pile("nonCurrentAssets"),
  totalAssets: pile("currentAssets", "nonCurrentAssets"),
  currentLiabilities: pile("currentLiabilities"),
  nonCurrentLiabilities: pile("nonCurrentLiabilities"),
  totalLiabilities: pile("currentLiabilities", "nonCurrentLiabilities"),
  equity: pile("equity"),
  interestBearingDebt: pile("interestBearingDebt"),
  revenue: pile("revenue"),
  cogs: pile("cogs"),
  opex: pile("opex"),
  depreciation: pile("depreciation"),
  interest: pile("interest"),
  tax: pile("tax"),
  otherIncome: pile("otherIncome"),
  principal: pile("principalRepayment"),
  debtService: pile("interest", "principalRepayment"),
} satisfies Record<string, Pile>);

/**
 * One metric: how the workbook computes it, and the piles it cannot be stated without. A divisor is
 * never listed — with no row it sums to zero, and the `IFERROR` around the division already leaves
 * the cell blank — so `needs` names exactly the piles whose absence nothing else would catch. Every
 * profit line needs revenue, because `compute.ts` starts the ladder there.
 */
type Metric = { readonly needs: readonly Pile[]; readonly build: Build };

function metric(needs: readonly Pile[], build: Build): Metric {
  return { needs, build };
}

/** Every metric the workbook can recompute, keyed by the metric's own key. */
const METRICS: Readonly<Record<string, Metric>> = Object.freeze({
  cash: metric([PILE.cash], (row) => parts(row).cash),
  receivables: metric([PILE.receivables], (row) => parts(row).receivables),
  inventory: metric([PILE.inventory], (row) => parts(row).inventory),
  currentAssets: metric([PILE.currentAssets], (row) => parts(row).currentAssets),
  nonCurrentAssets: metric([PILE.nonCurrentAssets], (row) => parts(row).nonCurrentAssets),
  totalAssets: metric([PILE.totalAssets], (row) => parts(row).totalAssets),
  currentLiabilities: metric([PILE.currentLiabilities], (row) => parts(row).currentLiabilities),
  nonCurrentLiabilities: metric([PILE.nonCurrentLiabilities], (row) => parts(row).nonCurrentLiabilities),
  totalLiabilities: metric([PILE.totalLiabilities], (row) => parts(row).totalLiabilities),
  totalEquity: metric([PILE.equity], (row) => parts(row).equity),
  interestBearingDebt: metric([PILE.interestBearingDebt], (row) => parts(row).interestBearingDebt),
  balanceCheck: metric([PILE.totalAssets, PILE.totalLiabilities, PILE.equity], (row) => {
    const p = parts(row);
    return `${p.totalAssets}-${p.totalLiabilities}-${p.equity}`;
  }),
  workingCapital: metric([PILE.currentAssets, PILE.currentLiabilities], (row) => {
    const p = parts(row);
    return `${p.currentAssets}-${p.currentLiabilities}`;
  }),
  revenue: metric([PILE.revenue], (row) => parts(row).revenue),
  cogs: metric([PILE.cogs], (row) => parts(row).cogs),
  grossProfit: metric([PILE.revenue], (row) => parts(row).grossProfit),
  opex: metric([PILE.opex], (row) => parts(row).opex),
  ebit: metric([PILE.revenue], (row) => parts(row).ebit),
  depreciation: metric([PILE.depreciation], (row) => parts(row).depreciation),
  // The P&L ladder when a revenue row exists; otherwise the stated EBITDA bucket. Blank when neither does.
  ebitda: metric([], (row) => {
    const noRevenue = `${pileCount(PILE.revenue, row)}=0`;
    const noStated = `${pileCount(["ebitda"], row)}=0`;
    return `IF(AND(${noRevenue},${noStated}),"",IF(${noRevenue},${bucketSum("ebitda", row)},${parts(row).ebitda}))`;
  }),
  interestExpense: metric([PILE.interest], (row) => parts(row).interest),
  tax: metric([PILE.tax], (row) => parts(row).tax),
  otherIncome: metric([PILE.otherIncome], (row) => parts(row).otherIncome),
  profitBeforeTax: metric([PILE.revenue], (row) => parts(row).profitBeforeTax),
  netProfit: metric([PILE.revenue], (row) => parts(row).netProfit),
  principalRepayment: metric([PILE.principal], (row) => parts(row).principal),
  debtService: metric([PILE.debtService], (row) => parts(row).debtService),
  currentRatio: metric([PILE.currentAssets], (row) => div(parts(row).currentAssets, parts(row).currentLiabilities)),
  quickRatio: metric([PILE.currentAssets], (row) => {
    const p = parts(row);
    return div(`(${p.currentAssets}-${p.inventory})`, p.currentLiabilities);
  }),
  cashRatio: metric([PILE.cash], (row) => div(parts(row).cash, parts(row).currentLiabilities)),
  debtToEquityTotal: metric([PILE.totalLiabilities], (row) => div(parts(row).totalLiabilities, parts(row).equity)),
  debtToEquityInterestBearing: metric([PILE.interestBearingDebt], (row) =>
    div(parts(row).interestBearingDebt, parts(row).equity),
  ),
  nonCurrentDebtToEquity: metric([PILE.nonCurrentLiabilities], (row) =>
    div(parts(row).nonCurrentLiabilities, parts(row).equity),
  ),
  debtToAssets: metric([PILE.totalLiabilities], (row) => div(parts(row).totalLiabilities, parts(row).totalAssets)),
  equityRatio: metric([PILE.equity], (row) => div(parts(row).equity, parts(row).totalAssets)),
  interestCoverage: metric([PILE.revenue], (row) => div(parts(row).ebit, parts(row).interest)),
  dscrEbitda: metric([PILE.revenue], (row) => div(parts(row).ebitda, parts(row).debtService)),
  dscrEbit: metric([PILE.revenue], (row) => div(parts(row).ebit, parts(row).debtService)),
  grossMarginPct: metric([], (row) => pct(parts(row).grossProfit, parts(row).revenue)),
  operatingMarginPct: metric([], (row) => pct(parts(row).ebit, parts(row).revenue)),
  netMarginPct: metric([], (row) => pct(parts(row).netProfit, parts(row).revenue)),
  returnOnAssetsPct: metric([PILE.revenue], (row) => pct(parts(row).netProfit, parts(row).totalAssets)),
  returnOnEquityPct: metric([PILE.revenue], (row) => pct(parts(row).netProfit, parts(row).equity)),
  assetTurnover: metric([PILE.revenue], (row) => div(parts(row).revenue, parts(row).totalAssets)),
  inventoryTurnover: metric([PILE.cogs], (row) => div(parts(row).cogs, parts(row).inventory)),
});

/** How many Inputs rows one pile has in the row's own period. */
function pileCount(buckets: Pile, rowIndex: number): string {
  return buckets.map((bucket) => `COUNTIFS(${BUCKET},"${bucket}",${PERIOD},${periodRef(rowIndex)})`).join("+");
}

/** The formula, blank — as the report's figure is null — whenever a pile it needs has no row. */
function blankUnless(needs: readonly Pile[], rowIndex: number, formula: string): string {
  const missing = needs.map((needed) => `${pileCount(needed, rowIndex)}=0`);
  if (missing.length === 0) {
    return formula;
  }
  const test = missing.length === 1 ? missing.join("") : `OR(${missing.join(",")})`;
  return `IF(${test},"",${formula})`;
}

/** The live formula for this metric's Value cell, or null when the workbook cannot express it. */
export function ratioMetricFormula(key: string, rowIndex: number): string | null {
  const entry = METRICS[key];
  return entry ? blankUnless(entry.needs, rowIndex, entry.build(rowIndex)) : null;
}

/** A formula matrix parallel to the Calc rows: the Value column only, null everywhere else. */
export function ratioCalcFormulas(keys: readonly string[]): (string | null)[][] {
  return keys.map((key, rowIndex) =>
    RATIO_CALC_COLUMNS.map((_column, columnIndex) =>
      columnIndex === RATIO_CALC_VALUE_COLUMN ? ratioMetricFormula(key, rowIndex) : null,
    ),
  );
}
