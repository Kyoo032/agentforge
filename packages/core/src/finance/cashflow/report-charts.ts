/**
 * The two pictures a cash-flow reader actually needs.
 *
 * The balance line is the whole answer in one shape: where the cash has been, and — as a second,
 * dotted-by-convention series — where it goes if the recent burn keeps up, ending at the month it
 * reaches zero. That projection is the runway marker; it is drawn from the same computed burn the
 * tables quote, so the chart cannot disagree with the number beside it.
 *
 * The net-per-period bars are the other half: a month can be profitable and still take cash out of
 * the till, and the bars are where that shows.
 */
import type { ReportChart, ReportLocale } from "../report";
import { addCalendarMonths, formatCalendarMonth, parseCalendarMonth } from "./calendar";
import type { CashflowComputed } from "./compute";
import { formatCashflowValue } from "./format";

type Text = Readonly<Record<ReportLocale, string>>;

const BALANCE_TITLE: Text = { id: "Saldo kas per periode", en: "Cash balance by period" };
const BALANCE_SERIES: Text = { id: "Saldo akhir", en: "Closing cash" };
const PROJECTION_SERIES: Text = { id: "Proyeksi pada burn terakhir", en: "Projection at the recent burn" };
const NET_TITLE: Text = { id: "Arus kas bersih per periode", en: "Net operating cash flow by period" };
const NET_SERIES: Text = { id: "Arus kas bersih", en: "Net operating cash flow" };
const RUNWAY_NOTE: Text = { id: "Kas habis pada", en: "Cash runs out in" };
const NO_BURN_NOTE: Text = {
  id: "Tidak ada burn bersih pada periode terakhir, jadi tidak ada proyeksi kas habis.",
  en: "There is no net burn over the recent periods, so no run-out is projected.",
};

/** A projection longer than this is not a runway, it is a guess; the chart stops rather than sprawls. */
const PROJECTION_MAX_POINTS = 36;

function say(text: Text, locale: ReportLocale): string {
  return text[locale] ?? text.en;
}

/** The month labels after the last one in the book, named the way the book names its own periods. */
function projectedLabels(lastPeriod: string, count: number, locale: ReportLocale): string[] {
  const start = parseCalendarMonth(lastPeriod);
  return [...Array(count).keys()].map((step) =>
    start === null ? `+${step + 1}` : formatCalendarMonth(addCalendarMonths(start, step + 1), locale),
  );
}

/**
 * The balance line plus its runway marker.
 *
 * The projection starts on the last real balance — so the two series meet rather than float apart —
 * and steps down by the recent net burn until it hits zero, which it is clamped to.
 */
export function cashBalanceChart(computed: CashflowComputed, locale: ReportLocale): ReportChart | null {
  if (computed.periods.length === 0) {
    return null;
  }
  const burn = computed.primaryBurn.netBurn ?? 0;
  const months = computed.monthsToZeroCash;
  const steps = burn > 0 && months !== null ? Math.min(PROJECTION_MAX_POINTS, Math.max(1, Math.ceil(months))) : 0;
  const actual = computed.periods.map((period) => period.closingCash);
  const labels = computed.periods.map((period) => period.period);
  const projection = [...Array(steps).keys()].map((step) => Math.max(0, computed.closingCash - burn * (step + 1)));
  const lead = actual.slice(0, -1).map(() => null);
  const zero = steps === 0 ? null : projectedLabels(computed.lastPeriod, steps, locale).at(-1);
  return {
    id: "cash-balance",
    title: say(BALANCE_TITLE, locale),
    kind: "line",
    categories: [...labels, ...projectedLabels(computed.lastPeriod, steps, locale)],
    series: [
      { name: say(BALANCE_SERIES, locale), values: [...actual, ...projection.map(() => null)] },
      {
        name: say(PROJECTION_SERIES, locale),
        values: [...lead, computed.closingCash, ...projection],
      },
    ],
    note:
      zero === null || zero === undefined
        ? say(NO_BURN_NOTE, locale)
        : `${say(RUNWAY_NOTE, locale)} ${zero} — ${formatCashflowValue(months, "months", locale)}`,
  };
}

/** Net operating cash flow per period. Negative bars are the months that took cash out of the till. */
export function netCashChart(computed: CashflowComputed, locale: ReportLocale): ReportChart | null {
  if (computed.periods.length === 0) {
    return null;
  }
  return {
    id: "net-cash",
    title: say(NET_TITLE, locale),
    kind: "bar",
    categories: computed.periods.map((period) => period.period),
    series: [{ name: say(NET_SERIES, locale), values: computed.periods.map((period) => period.netOperating) }],
  };
}

export function cashflowCharts(computed: CashflowComputed, locale: ReportLocale): ReportChart[] {
  return [cashBalanceChart(computed, locale), netCashChart(computed, locale)].filter(
    (chart): chart is ReportChart => chart !== null,
  );
}
