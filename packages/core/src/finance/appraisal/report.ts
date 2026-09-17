/**
 * The appraisal as the one format-neutral report every renderer reads.
 *
 * Two things happen here that do not happen anywhere else in the task. The narrative is put through
 * Market's advice guard — an appraisal states what the figures show and under which hurdle rates the
 * plan clears, and a sentence telling the reader to buy is removed and counted, not quietly kept.
 * And the verdict is made conditional in code: with a negative cell anywhere in the grid, "clears"
 * is only ever true of a named rate, so the flags say which rates and which assumptions.
 */
import { guardAdviceInText } from "../../market/advice-guard";
import type {
  FinanceReport,
  ReportChart,
  ReportFlag,
  ReportKpi,
  ReportLocale,
  ReportNote,
} from "../report";
import type { GuardFlags } from "../report-brief";
import type { FinanceTaskProse, FinanceTaskReportOptions } from "../tasks/types";
import type { AppraisalComputed } from "./compute";
import { formatAmount, formatPercent, formatYears } from "./format";
import { appraisalText, rateLabel, shiftColumnLabel } from "./labels";
import { appraisalTables } from "./tables";

const PERCENT_UNIT = "%";
const RATIO_UNIT = "x";
const PROFITABLE_INDEX = 1;

type Phrase = { readonly id: string; readonly en: string };

function say(phrase: Phrase, locale: ReportLocale): string {
  return locale === "id" ? phrase.id : phrase.en;
}

const PHRASE = Object.freeze({
  negativeAtRate: {
    id: "NPV negatif pada tingkat diskonto ini, jadi rencana ini tidak lolos di angka tersebut.",
    en: "NPV is negative at this discount rate, so the plan does not clear at that figure.",
  },
  irrBelowHurdle: {
    id: "IRR berada di bawah tingkat diskonto yang diminta.",
    en: "The IRR sits below the discount rate that was asked for.",
  },
  irrNotUnique: {
    id: "Arus kas berganti tanda lebih dari sekali dan NPV(r) memotong nol lebih dari sekali, jadi IRR tunggal tidak ada; MIRR dilaporkan sebagai gantinya.",
    en: "The flows change sign more than once and NPV(r) crosses zero more than once, so a single IRR does not exist; MIRR is reported instead.",
  },
  noPayback: {
    id: "Arus kas kumulatif tidak pernah mencapai nol dalam horizon yang diberikan.",
    en: "The cumulative cash flow never reaches zero inside the horizon given.",
  },
  noDiscountedPayback: {
    id: "Arus terdiskonto kumulatif tidak pernah mencapai nol dalam horizon yang diberikan.",
    en: "The cumulative discounted cash flow never reaches zero inside the horizon given.",
  },
  adviceRemoved: {
    id: "Kalimat berisi arahan transaksi dihapus: ini pembacaan angka, bukan saran.",
    en: "A sentence carrying a transaction directive was removed: this is a reading of the figures, not advice.",
  },
  negativeYear: { id: "Arus kas bersih negatif pada", en: "Net cash flow is negative in" },
  negativeCells: { id: "sel negatif dari", en: "negative cells out of" },
  crossesAt: { id: "Arus kas kumulatif pertama kali mencapai nol pada", en: "Cumulative cash flow first reaches zero in" },
  neverCrosses: { id: "Arus kas kumulatif tidak pernah mencapai nol.", en: "Cumulative cash flow never reaches zero." },
  discountedAt: { id: "Garis kedua adalah arus yang sudah didiskonto pada", en: "The second line is the same flows discounted at" },
} as const satisfies Record<string, Phrase>);

function kpi(label: string, value: number | null, unit: string, flag?: ReportKpi["flag"]): ReportKpi {
  return { label, value: value !== null && Number.isFinite(value) ? value : null, unit, ...(flag ? { flag } : {}) };
}

/** The headline figures, labelled the way the memo and the workbook label them. */
export function appraisalSummary(computed: AppraisalComputed, locale: ReportLocale): ReportKpi[] {
  const money = computed.currency || "";
  const years = appraisalText("years", locale);
  const irrClears = computed.irr.irrPercent !== null && computed.irr.irrPercent >= computed.discountRatePercent;
  return [
    kpi(
      rateLabel(computed.discountRatePercent, locale),
      computed.npv,
      money,
      computed.npv === null ? undefined : computed.npv >= 0 ? "good" : "risk",
    ),
    computed.irr.unique
      ? kpi(appraisalText("irr", locale), computed.irr.irrPercent, PERCENT_UNIT, irrClears ? "good" : "risk")
      : kpi(appraisalText("mirr", locale), computed.mirrPercent, PERCENT_UNIT, "watch"),
    kpi(appraisalText("payback", locale), computed.paybackYears, years, computed.paybackYears === null ? "watch" : undefined),
    kpi(
      appraisalText("discountedPayback", locale),
      computed.discountedPaybackYears,
      years,
      computed.discountedPaybackYears === null ? "watch" : undefined,
    ),
    kpi(
      appraisalText("profitabilityIndex", locale),
      computed.profitabilityIndex,
      RATIO_UNIT,
      computed.profitabilityIndex === null
        ? undefined
        : computed.profitabilityIndex >= PROFITABLE_INDEX
          ? "good"
          : "risk",
    ),
    kpi(appraisalText("breakevenRate", locale), computed.breakevenRatePercent, PERCENT_UNIT),
  ];
}

function crossingNote(computed: AppraisalComputed, locale: ReportLocale): string {
  const crossing = computed.periods.find((period) => period.cumulative >= 0);
  const rate = formatPercent(computed.discountRatePercent, locale, 0);
  const tail = `${say(PHRASE.discountedAt, locale)} ${rate}.`;
  return crossing
    ? `${say(PHRASE.crossesAt, locale)} ${crossing.period} (${formatYears(computed.paybackYears, locale)} ${appraisalText("years", locale)}). ${tail}`
    : `${say(PHRASE.neverCrosses, locale)} ${tail}`;
}

function negativeCellNote(computed: AppraisalComputed, locale: ReportLocale): string {
  const total = computed.ratePercents.length * computed.shiftPercents.length;
  if (computed.negativeCells.length === 0) {
    return `0 ${say(PHRASE.negativeCells, locale)} ${total}.`;
  }
  const named = computed.negativeCells
    .map((entry) => `${formatPercent(entry.ratePercent, locale, 0)} / ${shiftColumnLabel(entry.shiftPercent, locale)}`)
    .join("; ");
  return `${computed.negativeCells.length} ${say(PHRASE.negativeCells, locale)} ${total}: ${named}.`;
}

/** The cumulative line and the sensitivity grid — the two pictures the plan's flow graph calls for. */
export function appraisalCharts(computed: AppraisalComputed, locale: ReportLocale): ReportChart[] {
  return [
    {
      id: "cumulative-cash-flow",
      title: appraisalText("cumulativeChart", locale),
      kind: "line",
      categories: computed.periods.map((period) => period.period),
      series: [
        { name: appraisalText("cumulative", locale), values: computed.periods.map((period) => period.cumulative) },
        {
          name: appraisalText("cumulativeDiscounted", locale),
          values: computed.periods.map((period) =>
            Number.isFinite(period.cumulativeDiscounted) ? period.cumulativeDiscounted : null,
          ),
        },
      ],
      note: crossingNote(computed, locale),
    },
    {
      id: "sensitivity",
      title: appraisalText("sensitivityChart", locale),
      kind: "heat",
      categories: computed.shiftPercents.map((shift) => shiftColumnLabel(shift, locale)),
      series: computed.sensitivity.map((row, index) => ({
        name: formatPercent(computed.ratePercents[index] ?? null, locale, 0),
        values: row.map((entry) => (entry.npv !== null && Number.isFinite(entry.npv) ? entry.npv : null)),
      })),
      note: negativeCellNote(computed, locale),
    },
  ];
}

/** What the reader is asked to look at: the guard's strikeouts first, then what the figures flag. */
export function appraisalFlags(
  computed: AppraisalComputed,
  locale: ReportLocale,
  guard: GuardFlags | undefined,
  adviceRemoved: number,
): ReportFlag[] {
  const flags: ReportFlag[] = (guard?.flagged ?? []).map((entry) => ({ level: "watch", text: entry.text }));
  if (adviceRemoved > 0) {
    flags.push({ level: "watch", text: say(PHRASE.adviceRemoved, locale) });
  }
  if (computed.npv !== null && computed.npv < 0) {
    flags.push({ level: "risk", text: `${rateLabel(computed.discountRatePercent, locale)}: ${say(PHRASE.negativeAtRate, locale)}` });
  }
  if (computed.irr.unique && computed.irr.irrPercent !== null && computed.irr.irrPercent < computed.discountRatePercent) {
    flags.push({ level: "risk", text: say(PHRASE.irrBelowHurdle, locale) });
  }
  if (!computed.irr.unique && computed.irr.crossings !== 1) {
    flags.push({ level: "watch", text: say(PHRASE.irrNotUnique, locale) });
  }
  if (computed.paybackYears === null) {
    flags.push({ level: "watch", text: say(PHRASE.noPayback, locale) });
  }
  if (computed.discountedPaybackYears === null) {
    flags.push({ level: "watch", text: say(PHRASE.noDiscountedPayback, locale) });
  }
  for (const year of computed.negativeYears) {
    flags.push({
      level: "watch",
      text: `${say(PHRASE.negativeYear, locale)} ${year.period}: ${formatAmount(year.net, locale, computed.currency)}.`,
    });
  }
  if (computed.negativeCells.length > 0) {
    flags.push({ level: "watch", text: negativeCellNote(computed, locale) });
  }
  return flags;
}

type GuardedProse = { readonly notes: ReportNote[]; readonly removed: number };

/** The model's sections with any transaction directive struck out, and the count of what went. */
function guardedNotes(prose: FinanceTaskProse, locale: ReportLocale): GuardedProse {
  let removed = 0;
  const notes = prose.sections.map((section) => {
    const guarded = guardAdviceInText(section.body);
    removed += guarded.replaced;
    return { heading: section.heading, body: guarded.text };
  });
  if (prose.assumptions.length === 0) {
    return { notes, removed };
  }
  const assumptions = prose.assumptions.map((line) => guardAdviceInText(line));
  removed += assumptions.reduce((total, line) => total + line.replaced, 0);
  return {
    notes: [
      ...notes,
      { heading: appraisalText("assumptions", locale), body: assumptions.map((line) => line.text).join("\n") },
    ],
    removed,
  };
}

/** A short line under the title naming the rate, the horizon and the currency the report is in. */
function subtitleOf(computed: AppraisalComputed, locale: ReportLocale): string {
  const rate = formatPercent(computed.discountRatePercent, locale, 0);
  const years = computed.periods.length > 0 ? computed.periods.length - 1 : 0;
  const money = computed.currency ? ` · ${computed.currency}` : "";
  return locale === "id"
    ? `Diskonto ${rate} · ${years} ${appraisalText("years", locale)}${money}`
    : `Discount rate ${rate} · ${years} ${appraisalText("years", locale)}${money}`;
}

/** The whole report: computed figures, guarded prose, and nothing invented in between. */
export function appraisalReport(
  computed: AppraisalComputed,
  prose: FinanceTaskProse,
  options: FinanceTaskReportOptions = {},
): FinanceReport {
  const locale: ReportLocale = options.locale ?? "en";
  const guarded = guardedNotes(prose, locale);
  const title = guardAdviceInText(prose.title.trim() || appraisalText("title", locale)).text;
  return {
    task: "appraisal",
    title,
    subtitle: options.subtitle ?? subtitleOf(computed, locale),
    locale,
    ...(computed.currency ? { currency: computed.currency } : {}),
    summary: appraisalSummary(computed, locale),
    tables: appraisalTables(computed, locale),
    charts: appraisalCharts(computed, locale),
    flags: appraisalFlags(computed, locale, options.guard, guarded.removed),
    notes: guarded.notes,
  };
}
