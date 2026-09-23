/**
 * How the periods move, and how long the cash lasts.
 *
 * Runway is reported twice on purpose. "Cash over burn" is ambiguous the moment a statement carries
 * more than one burn figure, and picking one silently is how a brief tells an owner they have seven
 * months when the sheet supports three hundred. So both are named: the average monthly burn over the
 * span the sheet covers, and the burn of the latest period alone, each labelled with its own basis.
 */
import { cagrPercent, growthRates, runwayMonths } from "./engine";
import { type FiscalYearGroup, monthsInGroup, monthsInPeriod } from "./fiscal-periods";
import { roleOf } from "./line-item-normalise";
import { suffixed } from "./period-metrics";
import type { PeriodFigures } from "./period-figures";
import type { ReportLocale } from "./report";
import type { LineItem, Metric } from "./types";

type Labels = Record<ReportLocale, string>;

const LABELS = {
  revenueGrowth: { en: "Revenue growth", id: "Pertumbuhan pendapatan" },
  netProfitGrowth: { en: "Net profit growth", id: "Pertumbuhan laba bersih" },
  operatingCashGrowth: { en: "Operating cash flow growth", id: "Pertumbuhan arus kas operasi" },
  revenueCagr: { en: "Revenue CAGR per period", id: "CAGR pendapatan per periode" },
  monthlyBurn: { en: "Average monthly net burn", id: "Rata-rata burn kas bulanan" },
  impliedBurn: { en: "Implied average monthly net burn", id: "Rata-rata burn kas bulanan tersirat" },
  runway: { en: "Runway on the average monthly burn", id: "Runway atas burn bulanan rata-rata" },
  runwayLatest: { en: "Runway on the latest period's burn", id: "Runway atas burn periode terakhir" },
  breakevenPeriods: {
    en: "Periods until operating breakeven",
    id: "Jumlah periode sampai impas usaha",
  },
} satisfies Record<string, Labels>;

function pick(labels: Labels, locale: ReportLocale, period = ""): string {
  return suffixed(labels[locale] ?? labels.en, period);
}

function metric(
  key: string,
  label: string,
  value: number | null,
  unit: string,
  period: string,
  formula: string,
): Metric {
  return { key, label, value, unit, period, formula };
}

/** How many months the burn a row states actually covers: its own words first, then its period. */
export function burnBasisMonths(label: string, period: string): number {
  if (/\b(?:bulanan|per bulan|monthly|per month|\/\s*mo)\b/i.test(label)) {
    return 1;
  }
  if (/\b(?:kuartalan|triwulanan|per kuartal|quarterly|per quarter)\b/i.test(label)) {
    return 3;
  }
  if (/\b(?:tahunan|per tahun|annual|annually|yearly|per year)\b/i.test(label)) {
    return 12;
  }
  return monthsInPeriod(period);
}

export type BurnReading = { readonly period: string; readonly amount: number; readonly months: number };

/** Every burn figure the sheet states, with the number of months each one covers. */
export function burnReadings(items: readonly LineItem[]): BurnReading[] {
  return items
    .filter((item) => roleOf(item.label) === "burn")
    .map((item) => ({
      period: item.period,
      amount: Math.abs(item.amount),
      months: burnBasisMonths(item.label, item.period),
    }));
}

function monthlyOf(readings: readonly BurnReading[]): number | null {
  const months = readings.reduce((sum, reading) => sum + reading.months, 0);
  if (readings.length === 0 || months <= 0) {
    return null;
  }
  return readings.reduce((sum, reading) => sum + reading.amount, 0) / months;
}

export type TrendOptions = {
  readonly locale: ReportLocale;
  readonly currency: string;
  readonly periods: readonly string[];
  readonly figures: ReadonlyMap<string, PeriodFigures>;
  readonly groups: readonly FiscalYearGroup[];
  readonly latestCash: number | null;
};

function seriesOf(options: TrendOptions, read: (figures: PeriodFigures) => number | null): Array<number | null> {
  return options.periods.map((period) => read(options.figures.get(period) ?? ({} as PeriodFigures)) ?? null);
}

function growthMetrics(options: TrendOptions, labels: Labels, base: string, values: Array<number | null>): Metric[] {
  const filled = values.map((value) => value ?? Number.NaN);
  const rates = growthRates(filled);
  return options.periods.flatMap((period, index) => {
    const rate = rates[index];
    return rate === null || rate === undefined || !Number.isFinite(rate)
      ? []
      : [
          metric(
            suffixed(`${base}_growth`, period),
            pick(labels, options.locale, period),
            rate,
            "%",
            period,
            "vs the previous period",
          ),
        ];
  });
}

/** Growth per period, and the compound rate across the whole span. */
export function trendMetrics(options: TrendOptions): Metric[] {
  const revenue = seriesOf(options, (figures) => figures.revenue);
  const netProfit = seriesOf(options, (figures) => figures.netProfit);
  const operatingCash = seriesOf(options, (figures) => figures.operatingCashFlow);
  // The compound rate spans the periods between the first and last revenue the sheet states. A
  // period with no revenue at either end is not a step, and one figure alone compounds over nothing.
  const firstAt = revenue.findIndex((value) => value !== null);
  const lastAt = revenue.length - 1 - [...revenue].reverse().findIndex((value) => value !== null);
  const first = firstAt < 0 ? null : (revenue[firstAt] ?? null);
  const last = firstAt < 0 ? null : (revenue[lastAt] ?? null);
  const steps = lastAt - firstAt;
  const cagr = first === null || last === null ? null : cagrPercent(first, last, steps);
  return [
    ...growthMetrics(options, LABELS.revenueGrowth, "revenue", revenue),
    ...growthMetrics(options, LABELS.netProfitGrowth, "net_profit", netProfit),
    ...growthMetrics(options, LABELS.operatingCashGrowth, "operating_cash_flow", operatingCash),
    ...(cagr === null
      ? []
      : [
          metric(
            "revenue_cagr",
            pick(LABELS.revenueCagr, options.locale),
            cagr,
            "%",
            "",
            `(last / first) ^ (1 / ${steps}) - 1`,
          ),
        ]),
  ];
}

function readingsIn(readings: readonly BurnReading[], group: FiscalYearGroup): BurnReading[] {
  return readings.filter((reading) => group.periods.includes(reading.period));
}

/** Average monthly burn per fiscal year, and one for the whole span when there are no fiscal years. */
function monthlyBurnMetrics(readings: readonly BurnReading[], options: TrendOptions): Metric[] {
  const groups = options.groups.filter((group) => readingsIn(readings, group).length > 0);
  if (groups.length === 0) {
    const monthly = monthlyOf(readings);
    return monthly === null
      ? []
      : [
          metric(
            "monthly_burn",
            pick(LABELS.monthlyBurn, options.locale),
            monthly,
            options.currency,
            "",
            "stated burn / months covered",
          ),
        ];
  }
  return groups.flatMap((group) => {
    const inGroup = readingsIn(readings, group);
    const months = monthsInGroup(group);
    const total = inGroup.reduce((sum, reading) => sum + reading.amount, 0);
    return months <= 0
      ? []
      : [
          metric(
            suffixed("monthly_burn", group.label),
            pick(LABELS.monthlyBurn, options.locale, group.label),
            total / months,
            options.currency,
            group.label,
            `${group.label} burn / ${months} months`,
          ),
        ];
  });
}

function totalOver(options: TrendOptions, read: (figures: PeriodFigures) => number | null): number {
  return options.periods.reduce(
    (sum, period) => sum + (read(options.figures.get(period) ?? ({} as PeriodFigures)) ?? 0),
    0,
  );
}

/**
 * No burn line on the sheet: the shortfall between what the periods cost and what they earned,
 * spread over the months those periods cover. Runway is counted in months, so the burn it divides by
 * has to be a monthly one — two fiscal years short by 600 each burn 50 a month, not 600. Coarser than
 * a stated burn, and named so — it is the only answer the inputs support.
 */
function impliedBurnMetrics(options: TrendOptions): Metric[] {
  const withOpex = options.periods.filter((period) => (options.figures.get(period)?.opex ?? null) !== null);
  const months = withOpex.reduce((total, period) => total + monthsInPeriod(period), 0);
  if (withOpex.length === 0 || months <= 0) {
    return [];
  }
  const burn =
    (totalOver(options, (figures) => figures.opex) - totalOver(options, (figures) => figures.revenue)) / months;
  if (!(burn > 0)) {
    return [];
  }
  const runway = options.latestCash === null ? null : runwayMonths(options.latestCash, burn);
  return [
    metric(
      "burn",
      pick(LABELS.impliedBurn, options.locale),
      burn,
      options.currency,
      "",
      "(opex - revenue) / months covered",
    ),
    ...(runway === null
      ? []
      : [
          metric(
            "runway",
            pick(LABELS.runway, options.locale),
            runway,
            "months",
            "",
            "cash / implied average monthly burn",
          ),
        ]),
  ];
}

/** Runway on every burn basis the sheet supports, each one named with the basis it used. */
export function burnMetrics(items: readonly LineItem[], options: TrendOptions): Metric[] {
  const readings = burnReadings(items);
  if (readings.length === 0) {
    return impliedBurnMetrics(options);
  }
  if (options.latestCash === null) {
    return monthlyBurnMetrics(readings, options);
  }
  const cash = options.latestCash;
  const monthly = monthlyBurnMetrics(readings, options);
  const latest = readings.at(-1);
  const latestMonthly = latest && latest.months > 0 ? latest.amount / latest.months : null;
  return [
    ...monthly,
    ...monthly.slice(-1).flatMap((entry) => {
      const months = entry.value === null ? null : runwayMonths(cash, entry.value);
      return months === null
        ? []
        : [
            metric(
              suffixed("runway", entry.period),
              pick(LABELS.runway, options.locale, entry.period),
              months,
              "months",
              entry.period,
              "cash / average monthly burn",
            ),
          ];
    }),
    ...(latestMonthly === null || runwayMonths(cash, latestMonthly) === null
      ? []
      : [
          metric(
            "runway_latest_burn",
            pick(LABELS.runwayLatest, options.locale),
            runwayMonths(cash, latestMonthly),
            "months",
            latest?.period ?? "",
            "cash / (latest period burn / its months)",
          ),
        ]),
  ];
}

/** The first period whose operating profit is not negative, counted from the start of the span. */
export function breakevenPeriodMetric(options: TrendOptions): Metric[] {
  const profits = options.periods.map((period) => options.figures.get(period)?.operatingProfit ?? null);
  if (profits.length < 2 || profits[0] === null || (profits[0] as number) >= 0) {
    return [];
  }
  const at = profits.findIndex((value) => value !== null && value >= 0);
  return at < 0
    ? []
    : [
        metric(
          "periods_to_operating_breakeven",
          pick(LABELS.breakevenPeriods, options.locale),
          at + 1,
          "",
          options.periods[at] ?? "",
          "first period with a non-negative operating profit",
        ),
      ];
}
