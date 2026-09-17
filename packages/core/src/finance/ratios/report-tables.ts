/**
 * The tables the ratio report carries. Six of them, each answering one question a reader will ask:
 *
 * - `inputs` — the rows the reader confirmed, with the bucket each was put in. The workbook's
 *   formulas address this sheet, so it is also the thing a reader edits to see the ratios move.
 * - `calc` — every metric, every period, with a live Excel formula behind the value.
 * - `buckets` — how each row was classified and on what evidence. The audit trail.
 * - `balance` — assets against liabilities plus equity, per period, with the difference spelled out.
 * - `scorecard` — the ratios for the read period, banded, with the threshold and the prior year.
 * - `trend` — the same ratios across every period, so the movement is a column and not a claim.
 *
 * Every numeric cell is a real number; the formatted string sits in its own column beside it. The
 * renderers and the eval harness both read the numbers, and the reader reads the strings.
 */
import { INPUTS_TABLE_ID, CALC_TABLE_ID, type ReportCell, type ReportLocale, type ReportTable } from "../report";
import type { ComputedRatios } from "./compute";
import { ratioFigures } from "./compute";
import { formatRatioValue, ratioUnitToken } from "./format";
import { RATIO_CALC_COLUMNS, ratioCalcFormulas } from "./formulas";
import { RATIO_METRICS, RATIO_RATIO_METRICS } from "./keys";
import { ratioFullCard, ratioScorecard, type RatioScorecardEntry } from "./scorecard";
import { RATIO_TEXT, bandWord, say, trendWord } from "./text";

const COLUMN = RATIO_TEXT.columns;

function columns(locale: ReportLocale, keys: readonly (keyof typeof COLUMN)[]): string[] {
  return keys.map((key) => say(COLUMN[key], locale));
}

/** The confirmed rows, in the five columns the Calc formulas address by position. */
export function ratioInputsTable(computed: ComputedRatios, locale: ReportLocale): ReportTable {
  return {
    id: INPUTS_TABLE_ID,
    title: say(RATIO_TEXT.inputsTitle, locale),
    columns: columns(locale, ["label", "period", "bucket", "amount", "currency"]),
    rows: computed.rows.map((row) => [
      row.label,
      row.period ?? "",
      row.bucket,
      row.amount,
      row.currency ?? computed.currency,
    ]),
  };
}

function calcRow(entry: RatioScorecardEntry, locale: ReportLocale, currency: string): ReportCell[] {
  return [
    say(entry.meta.label, locale),
    entry.value,
    ratioUnitToken(entry.meta.unit, locale, currency),
    entry.period,
    say(entry.meta.formula, locale),
  ];
}

/** The read period and the one before it: the two a formula sheet is actually used for. */
function calcPeriods(computed: ComputedRatios, period?: string): readonly string[] {
  const read = period ?? computed.latest;
  const at = computed.periods.indexOf(read);
  const prior = at > 0 ? computed.periods[at - 1] : undefined;
  return [...(prior === undefined ? [] : [prior]), ...(computed.periods.includes(read) ? [read] : [])];
}

/**
 * Every metric of the read period and its comparison, with the live formula behind each value.
 *
 * The rows are period-major so a reader scrolls one year at a time, and the formula matrix is built
 * from the same row order — each formula reads its own row's Period cell, so a year is never mixed.
 *
 * Only two periods, on purpose. A formula sheet exists so a reader can change an input and watch a
 * ratio move, which they do for the period they are reading; the whole history is in the `trend`
 * table beside it, as values. Writing every formula for every period of a monthly statement pushed
 * the report past the 256 KB an artifact can be saved at, and a report that cannot be saved is worse
 * than one whose fifth-oldest month has no live formula.
 */
export function ratioCalcTable(computed: ComputedRatios, locale: ReportLocale, period?: string): ReportTable {
  const entries = calcPeriods(computed, period).flatMap((entry) => ratioFullCard(computed, entry));
  return {
    id: CALC_TABLE_ID,
    title: say(RATIO_TEXT.calcTitle, locale),
    columns: [...RATIO_CALC_COLUMNS],
    rows: entries.map((entry) => calcRow(entry, locale, computed.currency)),
    formulas: ratioCalcFormulas(entries.map((entry) => entry.meta.key)),
  };
}

/** How every row was placed, and on what evidence — the table the studio shows before computing. */
export function ratioBucketsTable(computed: ComputedRatios, locale: ReportLocale): ReportTable {
  return {
    id: "buckets",
    title: say(RATIO_TEXT.bucketsTitle, locale),
    columns: columns(locale, ["label", "period", "bucket", "amount", "confidence", "source", "rule"]),
    rows: computed.rows.map((row) => [
      row.label,
      row.period ?? "",
      row.bucket,
      row.amount,
      Number(row.confidence.toFixed(2)),
      row.source,
      row.reason,
    ]),
  };
}

/** Assets against liabilities plus equity, per period. A non-zero difference is the report's own alarm. */
export function ratioBalanceTable(computed: ComputedRatios, locale: ReportLocale): ReportTable {
  return {
    id: "balance",
    title: say(RATIO_TEXT.balanceTitle, locale),
    columns: columns(locale, ["period", "totalAssets", "totalLiabilities", "totalEquity", "difference"]),
    rows: computed.periods.map((period) => {
      const values = ratioFigures(computed, period)?.values ?? {};
      return [
        period,
        values.totalAssets ?? null,
        values.totalLiabilities ?? null,
        values.totalEquity ?? null,
        values.balanceCheck ?? null,
      ];
    }),
  };
}

function scorecardRow(entry: RatioScorecardEntry, locale: ReportLocale, currency: string): ReportCell[] {
  return [
    say(entry.meta.label, locale),
    entry.value,
    formatRatioValue(entry.value, entry.meta.unit, locale, currency),
    bandWord(entry.band, locale),
    entry.rule?.healthy ?? null,
    entry.rule?.watch ?? null,
    entry.prior,
    trendWord(entry.trend.direction, entry.prior !== null, locale),
  ];
}

/** The read period's ratios, each beside the threshold it was judged against and last year's figure. */
export function ratioScorecardTable(computed: ComputedRatios, locale: ReportLocale, period?: string): ReportTable {
  return {
    id: "scorecard",
    title: say(RATIO_TEXT.scorecardTitle, locale),
    columns: columns(locale, ["metric", "value", "display", "band", "healthy", "watch", "prior", "trend"]),
    rows: ratioScorecard(computed, period).map((entry) => scorecardRow(entry, locale, computed.currency)),
  };
}

/** Every ratio across every period: the trend as a column rather than a sentence. */
export function ratioTrendTable(computed: ComputedRatios, locale: ReportLocale): ReportTable {
  return {
    id: "trend",
    title: say(RATIO_TEXT.trendTitle, locale),
    columns: [say(COLUMN.metric, locale), ...computed.periods.map((period) => period || "—")],
    rows: [...RATIO_METRICS].map((meta) => [
      say(meta.label, locale),
      ...computed.periods.map((period) => ratioFigures(computed, period)?.values[meta.key] ?? null),
    ]),
  };
}

/** The bands in force, as a table a reader can check the colour of every ratio against. */
export function ratioBandsTable(computed: ComputedRatios, locale: ReportLocale): ReportTable {
  const labelled = RATIO_RATIO_METRICS.flatMap((meta) => {
    const rule = computed.bands.find((entry) => entry.metric === meta.key);
    return rule ? [{ meta, rule }] : [];
  });
  return {
    id: "bands",
    title: say(RATIO_TEXT.bandsTitle, locale),
    columns: columns(locale, ["metric", "healthy", "watch", "formula"]),
    rows: labelled.map(({ meta, rule }) => [
      say(meta.label, locale),
      rule.healthy,
      rule.watch,
      say(meta.formula, locale),
    ]),
  };
}
