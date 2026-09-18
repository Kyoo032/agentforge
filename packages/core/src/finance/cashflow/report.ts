/**
 * The finished cash-flow report: the object the screen, the workbook, the deck and the document all
 * read, so none of them can disagree about a number.
 *
 * Nothing is computed here. Every figure on a tile, in a table or on a chart comes from
 * `computeCashflow`, and the prose comes from the model *after* the guard has been over it. What this
 * file decides is only what a reader is shown first, and which of the figures deserve a flag.
 */
import type { FinanceReport, ReportFlag, ReportKpi, ReportLocale, ReportNote } from "../report";
import type { GuardFlags } from "../report-brief";
import { monthCashRunsOut } from "./calendar";
import type { CashflowComputed } from "./compute";
import { formatCashflowValue } from "./format";
import { cashflowCharts } from "./report-charts";
import { cashflowTables } from "./report-tables";
import type { FinanceTaskProse, FinanceTaskReportOptions } from "../tasks/types";

type Text = Readonly<Record<ReportLocale, string>>;

/** Under six months of runway is a risk; under a year is worth watching. The bands the brief uses. */
export const CASHFLOW_RUNWAY_RISK_MONTHS = 6;
export const CASHFLOW_RUNWAY_WATCH_MONTHS = 12;

const ASSUMPTIONS_HEADING: Text = { id: "Asumsi", en: "Assumptions" };

const KPI = Object.freeze({
  closing: { id: "Saldo kas akhir", en: "Closing cash" },
  net: { id: "Arus kas bersih periode terakhir", en: "Net operating cash flow, last period" },
  grossBurn: { id: "Burn kotor (periode terakhir)", en: "Gross burn (recent periods)" },
  netBurn: { id: "Burn bersih (periode terakhir)", en: "Net burn (recent periods)" },
  runway: { id: "Runway (periode terakhir)", en: "Runway (recent periods)" },
  zeroMonth: { id: "Kas habis pada", en: "Cash runs out in" },
  breakeven: { id: "Pendapatan BEP per periode", en: "Breakeven revenue per period" },
  scenarioRunway: { id: "Runway setelah skenario", en: "Runway after the what-if" },
});

const FLAG = Object.freeze({
  runwayRisk: { id: "Runway di bawah 6 bulan", en: "Runway under 6 months" },
  runwayWatch: { id: "Runway di bawah 12 bulan", en: "Runway under 12 months" },
  negative: { id: "Periode dengan arus kas bersih minus", en: "Periods with a negative net cash flow" },
  financing: {
    id: "Saldo terangkat oleh pendanaan, bukan oleh penjualan",
    en: "The balance was lifted by financing, not by trade",
  },
  unconfirmed: {
    id: "Klasifikasi biaya yang masih perlu dikonfirmasi",
    en: "Cost classifications still waiting to be confirmed",
  },
  scenarioBurning: {
    id: "Skenario ini tetap membakar kas",
    en: "The scenario still burns cash",
  },
  noBreakeven: {
    id: "Titik impas tidak dihitung: belum ada biaya yang ditandai variabel",
    en: "Breakeven was not computed: no cost is marked variable yet",
  },
});

function say(text: Text, locale: ReportLocale): string {
  return text[locale] ?? text.en;
}

function runwayBand(months: number | null): ReportKpi["flag"] {
  if (months === null) {
    return undefined;
  }
  return months < CASHFLOW_RUNWAY_RISK_MONTHS ? "risk" : months < CASHFLOW_RUNWAY_WATCH_MONTHS ? "watch" : "good";
}

const MONTHS_UNIT: Text = { id: "bulan", en: "months" };

/** The tiles a reader looks at first. Numbers only — the display strings live in the tables. */
export function cashflowKpis(computed: CashflowComputed, locale: ReportLocale): ReportKpi[] {
  const money = computed.currency;
  const months = say(MONTHS_UNIT, locale);
  const burn = computed.primaryBurn;
  const zero = monthCashRunsOut(computed.lastPeriod, computed.monthsToZeroCash, locale);
  const scenario = computed.outcomes.find((outcome) => outcome.basis === "recentAverage") ?? computed.outcomes[0];
  return [
    { label: say(KPI.closing, locale), value: computed.closingCash, unit: money },
    { label: say(KPI.net, locale), value: computed.periods.at(-1)?.netOperating ?? null, unit: money },
    { label: say(KPI.grossBurn, locale), value: burn.grossBurn, unit: money },
    { label: say(KPI.netBurn, locale), value: burn.netBurn, unit: money },
    {
      label: say(KPI.runway, locale),
      value: burn.runwayMonths,
      unit: months,
      ...(runwayBand(burn.runwayMonths) ? { flag: runwayBand(burn.runwayMonths) } : {}),
    },
    ...(zero ? [{ label: say(KPI.zeroMonth, locale), value: zero.label }] : []),
    ...(computed.breakeven.revenuePerPeriod === null
      ? []
      : [{ label: say(KPI.breakeven, locale), value: computed.breakeven.revenuePerPeriod, unit: money }]),
    ...(scenario
      ? [
          {
            label: say(KPI.scenarioRunway, locale),
            value: scenario.runwayMonths,
            unit: months,
            ...(runwayBand(scenario.runwayMonths) ? { flag: runwayBand(scenario.runwayMonths) } : {}),
          },
        ]
      : []),
  ];
}

/** What the reader is asked to look at, including every figure the guard had to strip. */
export function cashflowFlags(computed: CashflowComputed, locale: ReportLocale, guard?: GuardFlags): ReportFlag[] {
  const runway = computed.primaryBurn.runwayMonths;
  const scenario = computed.outcomes.find((outcome) => outcome.netBurn > 0);
  return [
    ...(guard?.flagged ?? []).map((entry) => ({ level: "watch" as const, text: entry.text })),
    ...(runway !== null && runway < CASHFLOW_RUNWAY_RISK_MONTHS
      ? [{ level: "risk" as const, text: `${say(FLAG.runwayRisk, locale)}: ${formatCashflowValue(runway, "months", locale)}` }]
      : runway !== null && runway < CASHFLOW_RUNWAY_WATCH_MONTHS
        ? [{ level: "watch" as const, text: `${say(FLAG.runwayWatch, locale)}: ${formatCashflowValue(runway, "months", locale)}` }]
        : []),
    ...(computed.negativePeriods.length === 0
      ? []
      : [
          {
            level: "watch" as const,
            text: `${say(FLAG.negative, locale)}: ${computed.negativePeriods.map((period) => period.period).join(", ")}`,
          },
        ]),
    ...(computed.totals.financingIn > 0 ? [{ level: "watch" as const, text: say(FLAG.financing, locale) }] : []),
    ...(computed.unconfirmed.length === 0
      ? []
      : [
          {
            level: "watch" as const,
            text: `${say(FLAG.unconfirmed, locale)}: ${computed.unconfirmed.map((entry) => entry.label).join(", ")}`,
          },
        ]),
    ...(scenario ? [{ level: "watch" as const, text: say(FLAG.scenarioBurning, locale) }] : []),
    ...(computed.breakeven.contributionMarginPct === null
      ? [{ level: "watch" as const, text: say(FLAG.noBreakeven, locale) }]
      : []),
  ];
}

function notesOf(prose: FinanceTaskProse, locale: ReportLocale): ReportNote[] {
  const sections = prose.sections.map((section) => ({ heading: section.heading, body: section.body }));
  return prose.assumptions.length === 0
    ? sections
    : [...sections, { heading: say(ASSUMPTIONS_HEADING, locale), body: prose.assumptions.join("\n") }];
}

/** The computed book and the guarded prose, as the one report every renderer reads. */
export function cashflowReport(
  computed: CashflowComputed,
  prose: FinanceTaskProse,
  options: FinanceTaskReportOptions = {},
): FinanceReport {
  const locale: ReportLocale = options.locale ?? "en";
  return {
    task: "cashflow",
    title: prose.title,
    ...(options.subtitle ? { subtitle: options.subtitle } : {}),
    locale,
    ...(computed.currency ? { currency: computed.currency } : {}),
    summary: cashflowKpis(computed, locale),
    tables: cashflowTables(computed, locale),
    charts: cashflowCharts(computed, locale),
    flags: cashflowFlags(computed, locale, options.guard),
    notes: notesOf(prose, locale),
  };
}
