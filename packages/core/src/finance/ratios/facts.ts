/**
 * The only numbers the model is shown, and the only numbers the guard will take back.
 *
 * These two have to agree exactly. A figure printed in the fact sheet but missing from the allowed
 * list comes back as `[unverified figure]` — which reads to the owner like the model invented it,
 * when in fact this file forgot to declare it. So both are built from one walk over the same
 * computed object, and the module's own test asserts that every number in the prose facts verifies.
 *
 * The allowed list is deliberately wider than the fact sheet in one respect only: a reader who is
 * given `Rp 12.607.000.000` may write `Rp 12,6 miliar`, so each currency figure also declares its
 * magnitude readings. Nothing else is added — a number that is not an input row, a computed value,
 * a band threshold or the days-per-year constant cannot survive the guard.
 */
import type { ReportLocale } from "../report";
import type { ComputedRatios } from "./compute";
import { formatRatioValue, formatRatioMagnitude, ratioAllowedReadings } from "./format";
import { RATIO_METRICS } from "./keys";
import { ratioFullCard, type RatioScorecardEntry } from "./scorecard";
import { RATIO_TEXT, bandWord, say, trendWord } from "./text";

function factLine(entry: RatioScorecardEntry, locale: ReportLocale, currency: string): string {
  const value = formatRatioValue(entry.value, entry.meta.unit, locale, currency);
  const magnitude = entry.meta.unit === "currency" ? formatRatioMagnitude(entry.value, locale, currency) : "";
  const written = magnitude === "" ? value : `${value} (${magnitude})`;
  const band = entry.band === null ? "" : ` | ${say(RATIO_TEXT.columns.band, locale)}: ${bandWord(entry.band, locale)}`;
  const prior =
    entry.prior === null
      ? ""
      : ` | ${say(RATIO_TEXT.columns.prior, locale)} ${entry.priorPeriod}: ${formatRatioValue(entry.prior, entry.meta.unit, locale, currency)} (${trendWord(entry.trend.direction, true, locale)})`;
  return `- ${entry.meta.key}.${entry.period} | ${say(entry.meta.label, locale)} | ${written} | ${say(entry.meta.formula, locale)}${band}${prior}`;
}

function bandLines(computed: ComputedRatios, locale: ReportLocale): string[] {
  return computed.bands.map(
    (rule) =>
      `- band.${rule.metric} | ${say(RATIO_TEXT.columns.healthy, locale)} ${rule.healthy} | ${say(RATIO_TEXT.columns.watch, locale)} ${rule.watch} | ${rule.direction}`,
  );
}

/**
 * Every computed figure, in the reader's language, keyed so the narrative can cite one by name.
 *
 * Every period is listed, newest last, because the trend is part of the reading — but each line
 * carries its own period so a figure can never be quoted without one.
 */
export function ratioPromptFacts(computed: ComputedRatios, locale: ReportLocale): string {
  const entries = computed.periods.flatMap((period) => ratioFullCard(computed, period));
  if (entries.length === 0) {
    return `${say(RATIO_TEXT.facts.heading, locale)}\n${say(RATIO_TEXT.facts.empty, locale)}`;
  }
  const header = [
    say(RATIO_TEXT.facts.heading, locale),
    `${say(RATIO_TEXT.facts.periodLine, locale)}: ${computed.latest}`,
    computed.prior === null ? null : `${say(RATIO_TEXT.facts.priorLine, locale)}: ${computed.prior}`,
    say(RATIO_TEXT.bands.headline, locale),
  ].filter((line): line is string => line !== null);
  return [
    ...header,
    ...entries.map((entry) => factLine(entry, locale, computed.currency)),
    ...bandLines(computed, locale),
  ].join("\n");
}

/**
 * Every figure the narrative may quote: the confirmed rows, every computed value, the bands — and
 * both readings of a printed subtotal the rows contradict, because the report prints both in a flag
 * and a reader who repeats the one the maths rejected is quoting the report, not inventing.
 */
export function ratioAllowedNumbers(computed: ComputedRatios): readonly number[] {
  const inputs = computed.rows.flatMap((row) => ratioAllowedReadings(row.amount, "currency"));
  const values = computed.byPeriod.flatMap((figures) =>
    RATIO_METRICS.flatMap((meta) => ratioAllowedReadings(figures.values[meta.key] ?? null, meta.unit)),
  );
  const thresholds = computed.bands.flatMap((rule) => [rule.healthy, rule.watch]);
  const reconciled = [
    ...computed.repairs.map((entry) => entry.amount),
    ...computed.mismatches.flatMap((entry) => [entry.derived, entry.stated]),
  ].flatMap((value) => ratioAllowedReadings(value, "currency"));
  return [
    ...new Set([...inputs, ...values, ...thresholds, ...reconciled, computed.daysPerYear].filter(Number.isFinite)),
  ];
}
