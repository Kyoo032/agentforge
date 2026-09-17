/**
 * The only figures the model is ever shown, and the only figures the guard will take back.
 *
 * Both come off ONE list. A fact the model is shown but not allowed comes back struck through as
 * `[unverified figure]`, and that would be a bug in this file rather than in the guard — so the
 * list is built once and read twice, and a test holds the two readings against each other.
 */
import type { ReportLocale } from "../report";
import type { LineItem } from "../types";
import type { AppraisalComputed } from "./compute";
import { formatAmount, formatPercent, formatRatio, formatYears, magnitudeReadings } from "./format";
import { appraisalText, rateLabel } from "./labels";

export type AppraisalFact = {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly display: string;
  readonly period: string;
  readonly formula: string;
  /** Currency figures are also spoken in millions and billions, so those readings are allowed too. */
  readonly money: boolean;
};

const HEADING: Record<ReportLocale, string> = {
  en: "Computed appraisal figures (already calculated in code; cite by key, never recompute):",
  id: "Angka kelayakan terhitung (sudah dihitung di kode; kutip lewat key-nya, jangan hitung ulang):",
};

const MISSING: Record<ReportLocale, string> = { en: "not available", id: "tidak tersedia" };

/** `flowsminus10` / `flowsbase` / `flowsplus10` — the column a sensitivity cell sits in. */
function shiftKey(shiftPercent: number): string {
  if (shiftPercent === 0) {
    return "flowsbase";
  }
  return shiftPercent < 0 ? `flowsminus${Math.abs(shiftPercent)}` : `flowsplus${shiftPercent}`;
}

function fact(
  key: string,
  label: string,
  value: number | null,
  display: string,
  formula: string,
  options: { period?: string; money?: boolean } = {},
): AppraisalFact {
  return {
    key,
    label,
    value,
    display,
    period: options.period ?? "",
    formula,
    money: options.money ?? false,
  };
}

function headlineFacts(computed: AppraisalComputed, locale: ReportLocale): AppraisalFact[] {
  const money = computed.currency;
  const rate = computed.discountRatePercent;
  return [
    fact(
      "discountRatePct",
      appraisalText("discountRate", locale),
      rate,
      formatPercent(rate, locale, 2),
      "the rate the request asked for",
    ),
    fact("outlay", appraisalText("outlay", locale), computed.outlay, formatAmount(computed.outlay, locale, money), "flow at t = 0", {
      period: computed.periods[0]?.period,
      money: true,
    }),
    fact(
      "npv",
      rateLabel(rate, locale),
      computed.npv,
      formatAmount(computed.npv, locale, money),
      "sum of flow[t] / (1 + r)^t with t from 0, so t = 0 is undiscounted",
      { money: true },
    ),
    fact(
      "profitabilityIndex",
      appraisalText("profitabilityIndex", locale),
      computed.profitabilityIndex,
      formatRatio(computed.profitabilityIndex, locale),
      "(NPV - flow at t = 0) / -(flow at t = 0)",
    ),
    fact(
      "paybackYears",
      appraisalText("payback", locale),
      computed.paybackYears,
      formatYears(computed.paybackYears, locale),
      "first year the cumulative flow is >= 0, minus 1, plus |cumulative the year before| / that year's flow",
    ),
    fact(
      "discountedPaybackYears",
      appraisalText("discountedPayback", locale),
      computed.discountedPaybackYears,
      formatYears(computed.discountedPaybackYears, locale),
      "the same rule over the flows discounted at the rate above",
    ),
    fact(
      "breakevenRatePct",
      appraisalText("breakevenRate", locale),
      computed.breakevenRatePercent,
      formatPercent(computed.breakevenRatePercent, locale),
      "the lowest rate at which NPV turns negative",
    ),
  ];
}

function irrFacts(computed: AppraisalComputed, locale: ReportLocale): AppraisalFact[] {
  const scan = computed.irr;
  const checks = [
    fact("flowSignChanges", appraisalText("signChanges", locale), scan.signChanges, String(scan.signChanges), "sign flips in the flows"),
    fact("npvZeroCrossings", appraisalText("zeroCrossings", locale), scan.crossings, String(scan.crossings), "zero crossings of NPV(r), scanned across a wide range of rates"),
  ];
  if (scan.unique) {
    return [
      ...checks,
      fact(
        "irrPct",
        appraisalText("irr", locale),
        scan.irrPercent,
        formatPercent(scan.irrPercent, locale),
        "the single rate at which NPV = 0, reported only because the scan found exactly one crossing",
      ),
    ];
  }
  return [
    ...checks,
    fact("irrPct", appraisalText("irr", locale), null, "", "not unique: NPV(r) crosses zero more than once, so no IRR is reported"),
    fact(
      "mirrPct",
      appraisalText("mirr", locale),
      computed.mirrPercent,
      formatPercent(computed.mirrPercent, locale),
      "outflows discounted at the finance rate, inflows compounded at the reinvestment rate",
    ),
    fact("mirrFinanceRatePct", appraisalText("financeRate", locale), computed.financeRatePercent, formatPercent(computed.financeRatePercent, locale, 2), "input"),
    fact("mirrReinvestRatePct", appraisalText("reinvestRate", locale), computed.reinvestRatePercent, formatPercent(computed.reinvestRatePercent, locale, 2), "input"),
  ];
}

function periodFacts(computed: AppraisalComputed, locale: ReportLocale): AppraisalFact[] {
  const money = computed.currency;
  return computed.periods.flatMap((period) => [
    fact(`netCashFlow.${period.period}`, `${appraisalText("netCashFlow", locale)} ${period.period}`, period.net, formatAmount(period.net, locale, money), "sum of the component rows of this year", { period: period.period, money: true }),
    fact(`cumulativeCashFlow.${period.period}`, `${appraisalText("cumulative", locale)} ${period.period}`, period.cumulative, formatAmount(period.cumulative, locale, money), "running total of the net flows", { period: period.period, money: true }),
    fact(
      `cumulativeDiscountedCashFlow.${period.period}`,
      `${appraisalText("cumulativeDiscounted", locale)} ${period.period}`,
      Number.isFinite(period.cumulativeDiscounted) ? period.cumulativeDiscounted : null,
      formatAmount(Number.isFinite(period.cumulativeDiscounted) ? period.cumulativeDiscounted : null, locale, money),
      "running total of the discounted flows; the last one is the NPV",
      { period: period.period, money: true },
    ),
  ]);
}

function sensitivityFacts(computed: AppraisalComputed, locale: ReportLocale): AppraisalFact[] {
  const money = computed.currency;
  return computed.sensitivity.flatMap((row) =>
    row.map((cell) =>
      fact(
        `sensitivityNpv.rate${cell.ratePercent}.${shiftKey(cell.shiftPercent)}`,
        `${rateLabel(cell.ratePercent, locale)} ${cell.shiftPercent === 0 ? "+0%" : `${cell.shiftPercent > 0 ? "+" : ""}${cell.shiftPercent}%`}`,
        cell.npv,
        formatAmount(cell.npv, locale, money),
        "NPV with every flow after t = 0 scaled; the t = 0 outlay never moves",
        { money: true },
      ),
    ),
  );
}

function hurdleFacts(computed: AppraisalComputed, locale: ReportLocale): AppraisalFact[] {
  return computed.hurdles.map((hurdle) =>
    fact(`npvAt.rate${hurdle.ratePercent}`, rateLabel(hurdle.ratePercent, locale), hurdle.npv, formatAmount(hurdle.npv, locale, computed.currency), "NPV of the base flows at this hurdle rate", {
      money: true,
    }),
  );
}

/** Every appraisal fact, in the order a memo reads them. */
export function appraisalFacts(computed: AppraisalComputed, locale: ReportLocale): AppraisalFact[] {
  return [
    ...headlineFacts(computed, locale),
    ...irrFacts(computed, locale),
    ...periodFacts(computed, locale),
    ...sensitivityFacts(computed, locale),
    ...hurdleFacts(computed, locale),
  ];
}

/** The facts as the prompt block the runner hands the model, one line per figure. */
export function appraisalPromptFacts(computed: AppraisalComputed, locale: ReportLocale): string {
  const missing = MISSING[locale] ?? MISSING.en;
  const lines = appraisalFacts(computed, locale).map((entry) =>
    `- ${entry.key} | ${entry.label} | ${entry.value === null ? missing : entry.display} | ${entry.period} | ${entry.formula}`,
  );
  return `${HEADING[locale] ?? HEADING.en}\n${lines.join("\n")}`;
}

/**
 * Every figure the narrative may quote: the rows the owner confirmed, every computed figure, the
 * rates and shifts the grid was asked for, and the millions-and-billions readings of the money
 * figures — because "Rp 139,9 miliar" is the same fact as 139939434, written the way people speak.
 */
export function appraisalAllowedNumbers(
  items: readonly LineItem[],
  computed: AppraisalComputed,
): readonly number[] {
  const facts = appraisalFacts(computed, "en");
  const values = facts.flatMap((entry) => {
    if (entry.value === null || !Number.isFinite(entry.value)) {
      return [];
    }
    return entry.money ? magnitudeReadings(entry.value) : [entry.value];
  });
  const inputs = items.flatMap((item) => magnitudeReadings(item.amount));
  const axes = [...computed.ratePercents, ...computed.shiftPercents, computed.periods.length];
  return [...new Set([...inputs, ...values, ...axes].filter((value) => Number.isFinite(value)))];
}
