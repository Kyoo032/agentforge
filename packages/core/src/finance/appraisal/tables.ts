/**
 * The appraisal's tables: the rows a reader edits, the rows they read, and the live Calc sheet.
 *
 * `inputs` is the flows sheet every formula addresses, so it carries ONE row per year — the net
 * flow — in the column order the workbook's addressing assumes (Label, Period, Category, Amount,
 * Currency). The component rows that make up each net stay visible in their own table beside it,
 * because a net flow nobody can take apart is a number the reader has to trust rather than check.
 */
import { CALC_TABLE_ID, INPUTS_TABLE_ID, type ReportCell, type ReportLocale, type ReportTable } from "../report";
import type { AppraisalComputed } from "./compute";
import { formatAmount, formatPercent, formatRatio, formatYears } from "./format";
import {
  CALC_NPV_ROW,
  CALC_RATE_ROW,
  flowRowFormulas,
  hurdleFormula,
  irrFormula,
  npvFormula,
  profitabilityIndexFormula,
  sensitivityFormula,
} from "./formulas";
import { appraisalText, rateLabel, shiftColumnLabel } from "./labels";

/** Table ids the renderers turn into sheets of their own. `inputs` and `calc` are the shared two. */
export const APPRAISAL_TABLE_IDS = Object.freeze({
  inputs: INPUTS_TABLE_ID,
  components: "components",
  flows: "flows",
  sensitivity: "sensitivity",
  calc: CALC_TABLE_ID,
});

/** The Calc column a live formula is written into — the Value column, as the shared layout says. */
const CALC_VALUE_COLUMN = 1;
const CALC_COLUMN_COUNT = 5;
const PERCENT_UNIT = "%";
const RATIO_UNIT = "x";
const COUNT_UNIT = "";

/** A number the report can carry. NaN and Infinity are absences, and are shown as such. */
function cell(value: number | null): ReportCell {
  return value !== null && Number.isFinite(value) ? value : null;
}

function inputsColumns(locale: ReportLocale): string[] {
  return [
    appraisalText("label", locale),
    appraisalText("period", locale),
    appraisalText("category", locale),
    appraisalText("amount", locale),
    appraisalText("currency", locale),
  ];
}

/** One row per year: the net flow, in the column order every Excel formula here addresses. */
export function inputsTable(computed: AppraisalComputed, locale: ReportLocale): ReportTable {
  const label = appraisalText("netCashFlow", locale);
  return {
    id: APPRAISAL_TABLE_IDS.inputs,
    title: appraisalText("netCashFlow", locale),
    columns: inputsColumns(locale),
    rows: computed.periods.map((period) => [label, period.period, "cash", cell(period.net), computed.currency]),
  };
}

/** The rows behind each net, kept so the reader can check the arithmetic rather than accept it. */
export function componentsTable(computed: AppraisalComputed, locale: ReportLocale): ReportTable {
  return {
    id: APPRAISAL_TABLE_IDS.components,
    title: appraisalText("components", locale),
    columns: inputsColumns(locale),
    rows: computed.periods.flatMap((period) =>
      period.components.map((part) => [
        part.label,
        period.period,
        part.category,
        cell(part.amount),
        computed.currency,
      ]),
    ),
  };
}

/** The year-by-year read: net, running total, discounted flow, running discounted total. */
export function flowsTable(computed: AppraisalComputed, locale: ReportLocale): ReportTable {
  const rows = computed.periods.map((period) => [
    period.period,
    cell(period.net),
    cell(period.cumulative),
    cell(period.discounted),
    cell(period.cumulativeDiscounted),
  ]);
  const formulas = computed.periods.map((_period, index) => {
    const live = flowRowFormulas(index);
    return [null, live.net, live.cumulative, live.discounted, live.cumulativeDiscounted];
  });
  return {
    id: APPRAISAL_TABLE_IDS.flows,
    title: appraisalText("flowsTable", locale),
    columns: [
      appraisalText("period", locale),
      appraisalText("netCashFlow", locale),
      appraisalText("cumulative", locale),
      appraisalText("discounted", locale),
      appraisalText("cumulativeDiscounted", locale),
    ],
    rows,
    formulas,
  };
}

/** One row per discount rate, one column per cash-flow shift. Negative cells stay signed. */
export function sensitivityTable(computed: AppraisalComputed, locale: ReportLocale): ReportTable {
  const count = computed.periods.length;
  return {
    id: APPRAISAL_TABLE_IDS.sensitivity,
    title: appraisalText("sensitivityTable", locale),
    columns: [
      appraisalText("discountRate", locale),
      ...computed.shiftPercents.map((shift) => shiftColumnLabel(shift, locale)),
    ],
    rows: computed.sensitivity.map((row, index) => [
      formatPercent(computed.ratePercents[index] ?? null, locale, 0),
      ...row.map((entry) => cell(entry.npv)),
    ]),
    formulas: computed.sensitivity.map((row) => [
      null,
      ...row.map((entry) => sensitivityFormula(count, entry.ratePercent, entry.shiftPercent)),
    ]),
  };
}

type CalcRow = {
  readonly label: string;
  readonly value: number | null;
  readonly unit: string;
  readonly display: string;
  readonly formula: string | null;
};

function currencyUnit(computed: AppraisalComputed): string {
  return computed.currency || COUNT_UNIT;
}

/** The rate first and the NPV second: the two Calc rows every other formula addresses by position. */
function headRows(computed: AppraisalComputed, locale: ReportLocale): CalcRow[] {
  const count = computed.periods.length;
  const money = currencyUnit(computed);
  return [
    {
      label: appraisalText("discountRate", locale),
      value: computed.discountRatePercent,
      unit: PERCENT_UNIT,
      display: formatPercent(computed.discountRatePercent, locale, 2),
      formula: null,
    },
    {
      label: rateLabel(computed.discountRatePercent, locale),
      value: computed.npv,
      unit: money,
      display: formatAmount(computed.npv, locale, computed.currency),
      formula: npvFormula(count),
    },
  ];
}

function metricRows(computed: AppraisalComputed, locale: ReportLocale): CalcRow[] {
  const count = computed.periods.length;
  const money = currencyUnit(computed);
  const years = appraisalText("years", locale);
  return [
    {
      label: appraisalText("irr", locale),
      value: computed.irr.irrPercent,
      unit: PERCENT_UNIT,
      display: formatPercent(computed.irr.irrPercent, locale),
      formula: computed.irr.unique ? irrFormula(count) : null,
    },
    {
      label: appraisalText("profitabilityIndex", locale),
      value: computed.profitabilityIndex,
      unit: RATIO_UNIT,
      display: formatRatio(computed.profitabilityIndex, locale),
      formula: profitabilityIndexFormula(count),
    },
    {
      label: appraisalText("payback", locale),
      value: computed.paybackYears,
      unit: years,
      display: formatYears(computed.paybackYears, locale),
      formula: null,
    },
    {
      label: appraisalText("discountedPayback", locale),
      value: computed.discountedPaybackYears,
      unit: years,
      display: formatYears(computed.discountedPaybackYears, locale),
      formula: null,
    },
    {
      label: appraisalText("breakevenRate", locale),
      value: computed.breakevenRatePercent,
      unit: PERCENT_UNIT,
      display: formatPercent(computed.breakevenRatePercent, locale),
      formula: null,
    },
    {
      label: appraisalText("outlay", locale),
      value: computed.outlay,
      unit: money,
      display: formatAmount(computed.outlay, locale, computed.currency),
      formula: null,
    },
  ];
}

/** The two counts the IRR rests on, always shown: a reader can check the uniqueness claim. */
function checkRows(computed: AppraisalComputed, locale: ReportLocale): CalcRow[] {
  const checks: CalcRow[] = [
    {
      label: appraisalText("signChanges", locale),
      value: computed.irr.signChanges,
      unit: COUNT_UNIT,
      display: String(computed.irr.signChanges),
      formula: null,
    },
    {
      label: appraisalText("zeroCrossings", locale),
      value: computed.irr.crossings,
      unit: COUNT_UNIT,
      display: String(computed.irr.crossings),
      formula: null,
    },
  ];
  if (computed.irr.unique) {
    return checks;
  }
  return [
    ...checks,
    {
      label: appraisalText("mirr", locale),
      value: computed.mirrPercent,
      unit: PERCENT_UNIT,
      display: formatPercent(computed.mirrPercent, locale),
      formula: null,
    },
    {
      label: appraisalText("financeRate", locale),
      value: computed.financeRatePercent,
      unit: PERCENT_UNIT,
      display: formatPercent(computed.financeRatePercent, locale, 2),
      formula: null,
    },
    {
      label: appraisalText("reinvestRate", locale),
      value: computed.reinvestRatePercent,
      unit: PERCENT_UNIT,
      display: formatPercent(computed.reinvestRatePercent, locale, 2),
      formula: null,
    },
  ];
}

function hurdleRows(computed: AppraisalComputed, locale: ReportLocale): CalcRow[] {
  const count = computed.periods.length;
  return computed.hurdles
    .filter((hurdle) => hurdle.ratePercent !== computed.discountRatePercent)
    .map((hurdle) => ({
      label: rateLabel(hurdle.ratePercent, locale),
      value: hurdle.npv,
      unit: currencyUnit(computed),
      display: formatAmount(hurdle.npv, locale, computed.currency),
      formula: hurdleFormula(count, hurdle.ratePercent),
    }));
}

/** Every calc row in the one order the formula addressing depends on: rate, NPV, then the rest. */
export function appraisalCalcRows(computed: AppraisalComputed, locale: ReportLocale): CalcRow[] {
  return [
    ...headRows(computed, locale),
    ...metricRows(computed, locale),
    ...checkRows(computed, locale),
    ...hurdleRows(computed, locale),
  ];
}

/** The live sheet: our own arithmetic restated as formulas over the rows above it. */
export function calcTable(computed: AppraisalComputed, locale: ReportLocale): ReportTable {
  const rows = appraisalCalcRows(computed, locale);
  return {
    id: APPRAISAL_TABLE_IDS.calc,
    title: appraisalText("metric", locale),
    columns: [
      appraisalText("metric", locale),
      appraisalText("value", locale),
      appraisalText("unit", locale),
      appraisalText("period", locale),
      appraisalText("formula", locale),
    ],
    rows: rows.map((row) => [row.label, cell(row.value), row.unit, "", row.display]),
    formulas: rows.map((row) =>
      Array.from({ length: CALC_COLUMN_COUNT }, (_unused, column) =>
        column === CALC_VALUE_COLUMN ? row.formula : null,
      ),
    ),
  };
}

/** Every table the appraisal report carries, in the order the workbook's sheets take them. */
export function appraisalTables(computed: AppraisalComputed, locale: ReportLocale): ReportTable[] {
  return [
    inputsTable(computed, locale),
    calcTable(computed, locale),
    flowsTable(computed, locale),
    sensitivityTable(computed, locale),
    componentsTable(computed, locale),
  ];
}

/** Sanity handles for the tests: the two Calc rows the formulas address by position. */
export const APPRAISAL_CALC_ROWS = Object.freeze({ rate: CALC_RATE_ROW, npv: CALC_NPV_ROW });
