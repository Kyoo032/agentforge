/**
 * Where one balance-sheet or P&L row sits, and what it rolls up into.
 *
 * A ratio is only ever as honest as the pile its numerator was taken from, so the pile is named
 * here rather than inferred at the point of division. Two facts live in this file and nowhere else:
 *
 * - **Multi-membership.** A bucket may belong to several aggregates. `current-portion-ltd` is the
 *   reason this file exists: the current slice of a term loan is a current liability *and*
 *   interest-bearing debt, and a reader who sees it in only one of those two is reading a different
 *   company. `short-term-debt` is the same shape for a bank line due inside the year.
 * - **Sign policy.** A sheet writes its costs however it likes — `Harga Pokok Penjualan` as a
 *   negative, `Beban Penjualan` as a positive, `Akumulasi Penyusutan` in brackets. Each bucket says
 *   how its amount is read, so the arithmetic downstream never has to guess.
 *
 * `excluded` is the honest answer for a subtotal row, a heading, or a label nothing could place: it
 * contributes to no aggregate and the studio asks the reader to put it somewhere.
 */
import { z } from "zod";

export const RATIO_BUCKETS = [
  "cash",
  "receivables",
  "inventory",
  "other-current-asset",
  "fixed-asset",
  "contra-asset",
  "other-noncurrent-asset",
  "current-liability",
  "short-term-debt",
  "current-portion-ltd",
  "long-term-debt",
  "other-noncurrent-liability",
  "equity",
  "revenue",
  "cogs",
  "opex",
  "depreciation",
  "interest",
  "tax",
  "principal-repayment",
  "other-income",
  // A sentence that states EBITDA outright ("EBITDA $80,000"), rather than the P&L it is built from.
  "ebitda",
  "excluded",
] as const;

export type RatioBucket = (typeof RATIO_BUCKETS)[number];

export const ratioBucketSchema = z.enum(RATIO_BUCKETS);

export function isRatioBucket(value: unknown): value is RatioBucket {
  return typeof value === "string" && (RATIO_BUCKETS as readonly string[]).includes(value);
}

/** The piles the ratio maths divides. A bucket may feed more than one of them. */
export const RATIO_AGGREGATES = [
  "currentAssets",
  "nonCurrentAssets",
  "currentLiabilities",
  "nonCurrentLiabilities",
  "interestBearingDebt",
  "equity",
  "revenue",
  "cogs",
  "opex",
  "depreciation",
  "interest",
  "tax",
  "principalRepayment",
  "otherIncome",
] as const;

export type RatioAggregate = (typeof RATIO_AGGREGATES)[number];

/**
 * How a bucket's amount is read off the sheet.
 * - `signed` — kept exactly as written; the sheet's own sign carries meaning.
 * - `magnitude` — read as a size. A cost is a cost whether the sheet wrote it as -23.96bn or 23.96bn.
 * - `negative` — always a deduction. A contra-asset reduces the asset it sits under, however it was typed.
 */
export const RATIO_SIGNS = ["signed", "magnitude", "negative"] as const;
export type RatioSign = (typeof RATIO_SIGNS)[number];

const SIGN: Readonly<Record<RatioBucket, RatioSign>> = Object.freeze({
  cash: "signed",
  receivables: "signed",
  inventory: "signed",
  "other-current-asset": "signed",
  "fixed-asset": "signed",
  "contra-asset": "negative",
  "other-noncurrent-asset": "signed",
  "current-liability": "signed",
  "short-term-debt": "signed",
  "current-portion-ltd": "signed",
  "long-term-debt": "signed",
  "other-noncurrent-liability": "signed",
  equity: "signed",
  revenue: "signed",
  cogs: "magnitude",
  opex: "magnitude",
  depreciation: "magnitude",
  interest: "magnitude",
  tax: "magnitude",
  "principal-repayment": "magnitude",
  // A net other-income line is a gain when positive and a charge when negative; both are real.
  "other-income": "signed",
  ebitda: "signed",
  excluded: "signed",
});

const NONE: readonly RatioAggregate[] = Object.freeze([]);

const MEMBERSHIP: Readonly<Record<RatioBucket, readonly RatioAggregate[]>> = Object.freeze({
  cash: Object.freeze(["currentAssets"] as const),
  receivables: Object.freeze(["currentAssets"] as const),
  inventory: Object.freeze(["currentAssets"] as const),
  "other-current-asset": Object.freeze(["currentAssets"] as const),
  "fixed-asset": Object.freeze(["nonCurrentAssets"] as const),
  "contra-asset": Object.freeze(["nonCurrentAssets"] as const),
  "other-noncurrent-asset": Object.freeze(["nonCurrentAssets"] as const),
  "current-liability": Object.freeze(["currentLiabilities"] as const),
  // Both of these are due inside the year and both carry interest: two aggregates, one row.
  "short-term-debt": Object.freeze(["currentLiabilities", "interestBearingDebt"] as const),
  "current-portion-ltd": Object.freeze(["currentLiabilities", "interestBearingDebt"] as const),
  "long-term-debt": Object.freeze(["nonCurrentLiabilities", "interestBearingDebt"] as const),
  "other-noncurrent-liability": Object.freeze(["nonCurrentLiabilities"] as const),
  equity: Object.freeze(["equity"] as const),
  revenue: Object.freeze(["revenue"] as const),
  cogs: Object.freeze(["cogs"] as const),
  opex: Object.freeze(["opex"] as const),
  depreciation: Object.freeze(["depreciation"] as const),
  interest: Object.freeze(["interest"] as const),
  tax: Object.freeze(["tax"] as const),
  "principal-repayment": Object.freeze(["principalRepayment"] as const),
  "other-income": Object.freeze(["otherIncome"] as const),
  // Not a pile. The EBITDA metric reads this bucket only when no P&L row produced one.
  ebitda: NONE,
  excluded: NONE,
});

/** Which statement a bucket belongs to, so the studio can group the classification table. */
export const RATIO_STATEMENTS = ["balance-sheet", "income-statement", "supporting", "none"] as const;
export type RatioStatement = (typeof RATIO_STATEMENTS)[number];

const STATEMENT: Readonly<Record<RatioBucket, RatioStatement>> = Object.freeze({
  cash: "balance-sheet",
  receivables: "balance-sheet",
  inventory: "balance-sheet",
  "other-current-asset": "balance-sheet",
  "fixed-asset": "balance-sheet",
  "contra-asset": "balance-sheet",
  "other-noncurrent-asset": "balance-sheet",
  "current-liability": "balance-sheet",
  "short-term-debt": "balance-sheet",
  "current-portion-ltd": "balance-sheet",
  "long-term-debt": "balance-sheet",
  "other-noncurrent-liability": "balance-sheet",
  equity: "balance-sheet",
  revenue: "income-statement",
  cogs: "income-statement",
  opex: "income-statement",
  interest: "income-statement",
  tax: "income-statement",
  "other-income": "income-statement",
  // Neither statement: these two only ever feed EBITDA and the debt-service denominator.
  depreciation: "supporting",
  "principal-repayment": "supporting",
  ebitda: "supporting",
  excluded: "none",
});

export const RATIO_BUCKET_SIGN = SIGN;
export const RATIO_BUCKET_MEMBERSHIP = MEMBERSHIP;
export const RATIO_BUCKET_STATEMENT = STATEMENT;

/** The aggregates this bucket contributes to. Empty for `excluded`. */
export function bucketAggregates(bucket: RatioBucket): readonly RatioAggregate[] {
  return MEMBERSHIP[bucket] ?? NONE;
}

/** The amount as the aggregate should receive it, after this bucket's sign policy. */
export function bucketAmount(bucket: RatioBucket, amount: number): number {
  const sign = SIGN[bucket] ?? "signed";
  if (sign === "magnitude") {
    return Math.abs(amount);
  }
  return sign === "negative" ? -Math.abs(amount) : amount;
}

/** The buckets that feed one aggregate, in the enum's own order. Used by the workbook formulas. */
export function bucketsFeeding(aggregate: RatioAggregate): readonly RatioBucket[] {
  return RATIO_BUCKETS.filter((bucket) => bucketAggregates(bucket).includes(aggregate));
}
