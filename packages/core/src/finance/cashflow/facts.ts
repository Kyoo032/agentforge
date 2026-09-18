/**
 * What the model is shown, and what the guard will take back.
 *
 * `cashflowPromptFacts` is the only thing the narration ever sees: no rows, no raw floats, no free
 * text the reader pasted — one line per computed figure, already written in the reader's own number
 * format. `cashflowAllowedNumbers` is the same list seen from the other side, widened only by the
 * readings of those same figures (the sign written the other way, the magnitudes a writer reaches
 * for). The two are built from one array, so a figure can never be shown without being allowed.
 */
import { monthCashRunsOut } from "./calendar";
import type { CashflowComputed, CashflowInput } from "./compute";
import { cashflowFigures } from "./figures";
import { allowedReadings, formatCashflowValue } from "./format";
import type { ReportLocale } from "../report";

type Text = Readonly<Record<ReportLocale, string>>;

const HEADING: Text = {
  id: "Angka arus kas yang sudah dihitung di kode (kutip persis; jangan menghitung ulang):",
  en: "Cash-flow figures already computed in code (quote them exactly; do not recompute):",
};

const NOTHING: Text = {
  id: "(tidak ada yang bisa dihitung dari baris ini)",
  en: "(nothing could be computed from these rows)",
};

const ZERO_CASH: Text = { id: "Kas habis pada", en: "Cash runs out in" };
const NEGATIVE: Text = { id: "Periode dengan arus kas bersih minus", en: "Periods with a negative net cash flow" };
const SCENARIO: Text = { id: "Skenario yang diterapkan", en: "Scenario applied" };
const NO_SCENARIO: Text = { id: "Tidak ada skenario what-if pada laporan ini", en: "No what-if scenario on this report" };
const UNCONFIRMED: Text = {
  id: "Klasifikasi biaya yang belum dikonfirmasi pembaca",
  en: "Cost classifications the reader has not confirmed",
};
const CURRENCY: Text = { id: "Mata uang", en: "Currency" };
const FINANCING_NOTE: Text = {
  id: "Pendanaan bukan pendapatan: ia menambah saldo bank tetapi tidak masuk ke kas masuk operasional maupun ke burn.",
  en: "Financing is not revenue: it lifts the bank balance but never enters operating cash in, gross burn or net burn.",
};

function say(text: Text, locale: ReportLocale): string {
  return text[locale] ?? text.en;
}

function adjustmentLine(computed: CashflowComputed, locale: ReportLocale): string {
  const { scenario } = computed;
  if (scenario.adjustments.length === 0) {
    return say(NO_SCENARIO, locale);
  }
  const parts = scenario.adjustments.map((adjustment) => {
    if (adjustment.kind === "percent") {
      return `${adjustment.target} ${adjustment.changePct >= 0 ? "+" : ""}${adjustment.changePct}%${
        adjustment.scalesVariable ? " (variable cost rides along)" : ""
      }`;
    }
    if (adjustment.kind === "absolute") {
      return `${adjustment.target} ${adjustment.amount >= 0 ? "+" : ""}${adjustment.amount}`;
    }
    if (adjustment.kind === "recurring") {
      return `recurring ${adjustment.amountPerPeriod} per period`;
    }
    return `one-off ${adjustment.amount}`;
  });
  const label = scenario.label.trim();
  return `${say(SCENARIO, locale)}: ${label ? `${label} — ` : ""}${parts.join("; ")}`;
}

/** The lines that are words rather than figures: what the book covers and what the reader must know. */
function contextLines(computed: CashflowComputed, locale: ReportLocale): string[] {
  const zero = monthCashRunsOut(computed.lastPeriod, computed.monthsToZeroCash, locale);
  const negative = computed.negativePeriods.map((period) => period.period);
  return [
    computed.currency ? `${say(CURRENCY, locale)}: ${computed.currency}` : "",
    zero
      ? `${say(ZERO_CASH, locale)}: ${zero.label} — ${formatCashflowValue(computed.monthsToZeroCash, "months", locale)} ${
          computed.lastPeriod ? `after ${computed.lastPeriod}` : ""
        }`.trim()
      : "",
    negative.length === 0 ? "" : `${say(NEGATIVE, locale)}: ${negative.join(", ")}`,
    computed.financing.length === 0 ? "" : say(FINANCING_NOTE, locale),
    adjustmentLine(computed, locale),
    computed.unconfirmed.length === 0
      ? ""
      : `${say(UNCONFIRMED, locale)}: ${computed.unconfirmed.map((entry) => entry.label).join(", ")}`,
  ].filter((line) => line !== "");
}

/** One line per computed figure: key, label, the value as the reader sees it, its period, its formula. */
export function cashflowPromptFacts(computed: CashflowComputed, locale: ReportLocale): string {
  const lines = cashflowFigures(computed, locale).map(
    (entry) =>
      `- ${entry.key} | ${entry.label} | ${formatCashflowValue(entry.value, entry.unit, locale, computed.currency)} | ${
        entry.period || "-"
      } | ${entry.formula}`,
  );
  const body = lines.length === 0 ? say(NOTHING, locale) : lines.join("\n");
  return [say(HEADING, locale), body, ...contextLines(computed, locale)].join("\n");
}

/**
 * Every figure the narration may quote: the rows the reader confirmed, the parameters typed beside
 * them, and every computed value — each with the readings a writer might legitimately use.
 */
export function cashflowAllowedNumbers(input: CashflowInput, computed: CashflowComputed): number[] {
  const typed = Object.values(input.params).filter((value): value is number => typeof value === "number");
  const adjustments = computed.scenario.adjustments.flatMap((adjustment) =>
    adjustment.kind === "percent"
      ? [adjustment.changePct]
      : adjustment.kind === "recurring"
        ? [adjustment.amountPerPeriod]
        : [adjustment.amount],
  );
  return allowedReadings([
    ...input.items.map((item) => item.amount),
    ...typed,
    ...adjustments,
    // The locale only changes how a figure is written, never what it is, so one pass is enough.
    ...cashflowFigures(computed, "en").map((entry) => entry.value),
  ]);
}
