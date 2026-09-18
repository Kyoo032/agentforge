/**
 * The ratio health check as the one format-neutral report every surface reads.
 *
 * Eight KPI tiles, seven tables, one banded gauge per ratio family, the flags a reader must not
 * miss, and the model's guarded prose underneath. The screen, the workbook, the deck and the
 * document all render this object, so a band shown on a dial and a band coloured in a cell are the
 * same decision made once.
 *
 * Two things are flagged here whatever the narrative says, because they are facts about the reading
 * rather than opinions about the company: a balance sheet whose two sides disagree, and rows that
 * could not be classified and therefore sit in no ratio at all.
 */
import type {
  FinanceReport,
  ReportChart,
  ReportFlag,
  ReportKpi,
  ReportLocale,
  ReportNote,
  ReportSeries,
} from "../report";
import type { GuardFlags } from "../report-brief";
import type { FinanceTaskProse } from "../tasks/types";
import { reportFlagLevel } from "./bands";
import type { ComputedRatios } from "./compute";
import { ratioFigures } from "./compute";
import { formatRatioValue, ratioUnitToken } from "./format";
import { ratioMetricMeta } from "./keys";
import {
  ratioBalanceTable,
  ratioBandsTable,
  ratioBucketsTable,
  ratioCalcTable,
  ratioInputsTable,
  ratioScorecardTable,
  ratioTrendTable,
} from "./report-tables";
import { RATIO_GAUGE_KEYS, headlineScorecard, ratioScorecard, type RatioScorecardEntry } from "./scorecard";
import { RATIO_TEXT, bandWord, say, trendWord } from "./text";

export type RatioReportOptions = {
  readonly locale?: ReportLocale;
  readonly subtitle?: string;
  readonly guard?: GuardFlags;
  /** The period the scorecard reads. Defaults to the newest one the rows carry. */
  readonly period?: string;
};

function summaryOf(computed: ComputedRatios, locale: ReportLocale, period: string): ReportKpi[] {
  return headlineScorecard(computed, period).map((entry) => ({
    label: `${say(entry.meta.label, locale)} ${entry.period}`.trim(),
    value: entry.value,
    unit: ratioUnitToken(entry.meta.unit, locale, computed.currency),
    ...(entry.band ? { flag: reportFlagLevel(entry.band) } : {}),
  }));
}

function gaugeNote(entry: RatioScorecardEntry, locale: ReportLocale, currency: string): string {
  const value = formatRatioValue(entry.value, entry.meta.unit, locale, currency);
  const band = bandWord(entry.band, locale);
  const formula = say(entry.meta.formula, locale);
  const prior =
    entry.prior === null
      ? ""
      : ` · ${say(RATIO_TEXT.columns.prior, locale)} ${formatRatioValue(entry.prior, entry.meta.unit, locale, currency)} (${trendWord(entry.trend.direction, true, locale)})`;
  return `${value} — ${band} · ${formula}${prior}`;
}

/** One dial per ratio family, with the two thresholds drawn beside the reading so the scale is real. */
function chartsOf(computed: ComputedRatios, locale: ReportLocale, period: string): ReportChart[] {
  const card = ratioScorecard(computed, period);
  return RATIO_GAUGE_KEYS.flatMap((key) => {
    const entry = card.find((item) => item.meta.key === key);
    if (!entry || entry.value === null) {
      return [];
    }
    const series: ReportSeries[] = [
      { name: ratioUnitToken(entry.meta.unit, locale, computed.currency), values: [entry.value] },
    ];
    if (entry.rule) {
      series.push({ name: say(RATIO_TEXT.gauge.watchLabel, locale), values: [entry.rule.watch] });
      series.push({ name: say(RATIO_TEXT.gauge.healthyLabel, locale), values: [entry.rule.healthy] });
    }
    return [
      {
        id: `gauge-${key}`,
        title: `${say(entry.meta.label, locale)} ${entry.period}`.trim(),
        kind: "gauge" as const,
        categories: [say(entry.meta.label, locale)],
        series,
        note: gaugeNote(entry, locale, computed.currency),
      },
    ];
  });
}

function balanceFlags(computed: ComputedRatios, locale: ReportLocale): ReportFlag[] {
  return computed.periods.flatMap((period) => {
    const difference = ratioFigures(computed, period)?.values.balanceCheck ?? null;
    if (difference === null || difference === 0) {
      return [];
    }
    const written = formatRatioValue(difference, "currency", locale, computed.currency);
    return [
      {
        level: "risk" as const,
        text: `${say(RATIO_TEXT.flags.balanceBroken, locale)} ${period}: ${written}`,
      },
    ];
  });
}

/** A metric's own name in the reader's language, so a flag and a table cell agree about what it is. */
function metricName(key: string, locale: ReportLocale): string {
  const meta = ratioMetricMeta(key);
  return meta ? say(meta.label, locale) : key;
}

/**
 * The two things the printed subtotals said that the rows alone could not.
 *
 * A rebuilt bucket and a subtotal the rows contradict are both facts about the READING, so they are
 * flagged whatever the narrative says — a scorecard that quietly computed EBIT without a cost of
 * sales is the one failure this task must never ship silently.
 */
function reconcileFlags(computed: ComputedRatios, locale: ReportLocale): ReportFlag[] {
  const money = (value: number) => formatRatioValue(value, "currency", locale, computed.currency);
  const repaired = computed.repairs.map((entry) => ({
    level: "watch" as const,
    text: `${metricName(entry.key, locale)} ${entry.period}: ${say(RATIO_TEXT.flags.repaired, locale)} ${metricName(entry.from, locale)} — ${money(entry.amount)}`,
  }));
  const contradicted = computed.mismatches.map((entry) => ({
    level: "risk" as const,
    text: `${metricName(entry.key, locale)} ${entry.period}: ${say(RATIO_TEXT.flags.statedMismatch, locale)} — ${say(RATIO_TEXT.flags.statedWord, locale)} ${money(entry.stated)}, ${say(RATIO_TEXT.flags.derivedWord, locale)} ${money(entry.derived)}`,
  }));
  return [...contradicted, ...repaired];
}

function bandFlags(computed: ComputedRatios, locale: ReportLocale, period: string): ReportFlag[] {
  return headlineScorecard(computed, period)
    .filter((entry) => entry.band === "watch" || entry.band === "risk")
    .map((entry) => ({
      level: reportFlagLevel(entry.band ?? "watch"),
      text: `${say(entry.meta.label, locale)} ${entry.period}: ${formatRatioValue(entry.value, entry.meta.unit, locale, computed.currency)} — ${bandWord(entry.band, locale)}`,
    }));
}

function flagsOf(
  computed: ComputedRatios,
  locale: ReportLocale,
  period: string,
  guard: GuardFlags | undefined,
): ReportFlag[] {
  const stripped = (guard?.flagged ?? []).map((entry) => ({
    level: "watch" as const,
    text: `${say(RATIO_TEXT.flags.stripped, locale)}: ${entry.text}`,
  }));
  const unplaced =
    computed.unplaced.length === 0
      ? []
      : [
          {
            level: "watch" as const,
            text: `${computed.unplaced.length} ${say(RATIO_TEXT.flags.unplaced, locale)}`,
          },
        ];
  return [
    ...balanceFlags(computed, locale),
    ...reconcileFlags(computed, locale),
    ...unplaced,
    ...stripped,
    ...bandFlags(computed, locale, period),
  ];
}

function notesOf(prose: FinanceTaskProse, locale: ReportLocale): ReportNote[] {
  const sections = prose.sections.map((section) => ({ heading: section.heading, body: section.body }));
  const method: ReportNote = {
    heading: say(RATIO_TEXT.notes.method, locale),
    body: `${say(RATIO_TEXT.notes.methodBody, locale)}\n\n${say(RATIO_TEXT.bands.headline, locale)}`,
  };
  const assumptions =
    prose.assumptions.length === 0
      ? []
      : [{ heading: say(RATIO_TEXT.notes.assumptions, locale), body: prose.assumptions.join("\n") }];
  return [...sections, method, ...assumptions];
}

/** The whole report: KPIs, tables, gauges, flags and the guarded prose, in the reader's language. */
export function ratioReport(
  computed: ComputedRatios,
  prose: FinanceTaskProse,
  options: RatioReportOptions = {},
): FinanceReport {
  const locale = options.locale ?? "en";
  const period = options.period ?? computed.latest;
  const subtitle = options.subtitle ?? `${say(RATIO_TEXT.subtitle, locale)} ${period}`.trim();
  return {
    task: "ratios",
    title: prose.title,
    ...(subtitle ? { subtitle } : {}),
    locale,
    ...(computed.currency ? { currency: computed.currency } : {}),
    summary: summaryOf(computed, locale, period),
    tables: [
      ratioScorecardTable(computed, locale, period),
      ratioInputsTable(computed, locale),
      ratioCalcTable(computed, locale, period),
      ratioBalanceTable(computed, locale),
      ratioBucketsTable(computed, locale),
      ratioTrendTable(computed, locale),
      ratioBandsTable(computed, locale),
    ],
    charts: chartsOf(computed, locale, period),
    flags: flagsOf(computed, locale, period, options.guard),
    notes: notesOf(prose, locale),
  };
}
