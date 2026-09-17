/**
 * The ratio step's state, as pure functions the panel can be tested without.
 *
 * The studio is a shell that knows three fields — the pasted text, the confirmed rows and the
 * parameters — so everything this task needs beyond a row goes through `params`: the buckets the
 * owner changed, the thresholds they moved, and the period they are reading. That keeps the whole
 * task inside its own folder while still riding the one channel the studio forwards to the host.
 *
 * The balance check here runs the product's own `computeRatios` over the rows on screen. It is the
 * same arithmetic the report will do, so the banner cannot say "balanced" about a statement the
 * report then flags — and the owner sees it before a job is ever started.
 */
import {
  RATIO_BUCKETS,
  RATIO_BUCKET_STATEMENT,
  classifyRatioRows,
  computeRatios,
  isRatioBucket,
  ratioBandTable,
  type ClassifiedRatioRow,
  type FinanceParams,
  type LineItem,
  type RatioBandOverride,
  type RatioBandRule,
  type RatioBucket,
  type RatioBucketOverride,
  type RatioStatedRow,
  type RatioStatement,
} from "@agentforge/core/finance";

/** One row as the parse hook answered: the amount, the bucket it was put in, and the evidence. */
export type RatiosClassifiedRow = {
  readonly label: string;
  readonly period: string;
  readonly amount: number;
  readonly currency: string;
  readonly bucket: RatioBucket;
  readonly confidence: number;
  readonly source: string;
  readonly reason: string;
  readonly section: string;
};

/** The bucket the owner picked, keyed by row. Only changes are kept: the rest re-derive identically. */
export type RatiosBucketChanges = Readonly<Record<string, RatioBucket>>;

export const RATIOS_BUCKET_OPTIONS: readonly RatioBucket[] = RATIO_BUCKETS;

export function ratiosRowKey(label: string, period: string): string {
  return `${label}|${period}`;
}

/** What the table shows for this row: the owner's choice when there is one, the parse's otherwise. */
export function displayedBucket(row: RatiosClassifiedRow, changes: RatiosBucketChanges): RatioBucket {
  const chosen = changes[ratiosRowKey(row.label, row.period)];
  return chosen && isRatioBucket(chosen) ? chosen : row.bucket;
}

/** True once the owner has moved this row themselves. Drawn differently, and sent as an override. */
export function isChanged(row: RatiosClassifiedRow, changes: RatiosBucketChanges): boolean {
  const chosen = changes[ratiosRowKey(row.label, row.period)];
  return chosen !== undefined && chosen !== row.bucket;
}

/** A change recorded, or dropped again when the owner puts a row back where it started. */
export function withBucketChange(
  changes: RatiosBucketChanges,
  row: RatiosClassifiedRow,
  bucket: RatioBucket,
): RatiosBucketChanges {
  const key = ratiosRowKey(row.label, row.period);
  const { [key]: _dropped, ...rest } = changes;
  return bucket === row.bucket ? rest : { ...rest, [key]: bucket };
}

/**
 * Only the rows the owner actually moved travel to the host.
 *
 * Everything else is re-derived there from the same dictionary and lands in the same bucket, so the
 * report's evidence column keeps saying "label dictionary" for the rows nobody touched — which is
 * the honest record of what happened.
 */
export function ratiosOverrides(changes: RatiosBucketChanges): RatioBucketOverride[] {
  return Object.entries(changes).flatMap(([key, bucket]) => {
    const at = key.lastIndexOf("|");
    const label = at === -1 ? key : key.slice(0, at);
    const period = at === -1 ? "" : key.slice(at + 1);
    return label === "" || !isRatioBucket(bucket)
      ? []
      : [{ label, period, bucket, confidence: 1, source: "override" as const }];
  });
}

/**
 * This task's extra settings, carried in `params`.
 *
 * `FinanceParams` names the brief's four knobs and nothing else, so a task with settings of its own
 * has one honest choice: ride the same field, and say here — once — that it is doing so. The host
 * validates every key it reads, so nothing untyped reaches the maths.
 */
export type RatiosParams = {
  readonly buckets?: readonly RatioBucketOverride[];
  readonly bands?: readonly RatioBandOverride[];
  /** The subtotal rows the parse read off the sheet. Checked against, never summed. */
  readonly stated?: readonly RatioStatedRow[];
  readonly period?: string;
  readonly daysPerYear?: number;
  readonly depreciation?: number;
  readonly principalRepayment?: number;
};

export function readRatiosParams(params: FinanceParams): RatiosParams {
  return params as RatiosParams;
}

export function withRatiosParams(params: FinanceParams, patch: RatiosParams): FinanceParams {
  return { ...params, ...patch } as FinanceParams;
}

/** Drop a setting when its box is cleared; never mutate the object we were handed. */
export function withRatiosNumber(
  params: FinanceParams,
  key: "daysPerYear" | "depreciation" | "principalRepayment",
  raw: string,
): FinanceParams {
  const { [key]: _dropped, ...rest } = params as Record<string, unknown>;
  return (raw.trim() === "" ? rest : { ...rest, [key]: Number(raw) }) as FinanceParams;
}

/** The threshold table in force: the documented defaults with the owner's own edits over the top. */
export function ratiosBands(params: FinanceParams): readonly RatioBandRule[] {
  return ratioBandTable(readRatiosParams(params).bands ?? []);
}

export function withRatiosBand(params: FinanceParams, metric: string, healthy: number, watch: number): FinanceParams {
  const kept = (readRatiosParams(params).bands ?? []).filter((entry) => entry.metric !== metric);
  return withRatiosParams(params, { bands: [...kept, { metric, healthy, watch }] });
}

export function withoutRatiosBands(params: FinanceParams): FinanceParams {
  const { bands: _dropped, ...rest } = params as Record<string, unknown>;
  return rest as FinanceParams;
}

function rowsFor(items: readonly LineItem[], changes: RatiosBucketChanges): readonly ClassifiedRatioRow[] {
  return classifyRatioRows(
    items.map((item) => ({
      label: item.label,
      period: item.period,
      amount: item.amount,
      currency: item.currency,
      category: item.category,
    })),
    ratiosOverrides(changes),
  );
}

export type RatiosBalanceRow = {
  readonly period: string;
  readonly assets: number | null;
  readonly liabilities: number | null;
  readonly equity: number | null;
  readonly difference: number | null;
  readonly state: "balanced" | "broken" | "unknown";
};

/**
 * Assets against liabilities plus equity, per period, computed on screen with the product's own
 * maths. A difference of zero is the only thing that reads as balanced; anything else is named.
 */
export function ratiosBalance(items: readonly LineItem[], changes: RatiosBucketChanges = {}): RatiosBalanceRow[] {
  const computed = computeRatios(rowsFor(items, changes));
  return computed.byPeriod.map((figures) => {
    const difference = figures.values.balanceCheck ?? null;
    return {
      period: figures.period,
      assets: figures.values.totalAssets ?? null,
      liabilities: figures.values.totalLiabilities ?? null,
      equity: figures.values.totalEquity ?? null,
      difference,
      state: difference === null ? "unknown" : difference === 0 ? "balanced" : "broken",
    };
  });
}

/** The periods the rows carry, oldest first — the list the period picker offers. */
export function ratiosPeriods(items: readonly LineItem[]): readonly string[] {
  return computeRatios(rowsFor(items, {})).periods;
}

/** The period the scorecard reads: the owner's pick when it is still one of the rows', else the newest. */
export function ratiosReadPeriod(items: readonly LineItem[], params: FinanceParams): string {
  const periods = ratiosPeriods(items);
  const chosen = readRatiosParams(params).period;
  return chosen && periods.includes(chosen) ? chosen : (periods[periods.length - 1] ?? "");
}

export type RatiosRowGroup = { readonly statement: RatioStatement; readonly rows: readonly RatiosClassifiedRow[] };

const STATEMENT_ORDER: readonly RatioStatement[] = ["balance-sheet", "income-statement", "supporting", "none"];

/**
 * The classification table, grouped the way the statements were printed and then by section inside
 * each group — so an owner checking a balance sheet reads it in the order their own sheet had it.
 */
export function groupRatiosRows(rows: readonly RatiosClassifiedRow[], changes: RatiosBucketChanges): RatiosRowGroup[] {
  return STATEMENT_ORDER.flatMap((statement) => {
    const kept = rows.filter((row) => RATIO_BUCKET_STATEMENT[displayedBucket(row, changes)] === statement);
    return kept.length === 0 ? [] : [{ statement, rows: kept }];
  });
}

/** One row per label: the table the owner sets a bucket on, with every period folded into it. */
export function uniqueRatiosRows(rows: readonly RatiosClassifiedRow[]): readonly RatiosClassifiedRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.label)) {
      return false;
    }
    seen.add(row.label);
    return true;
  });
}
