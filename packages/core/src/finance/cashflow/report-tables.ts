/**
 * The sheets a cash-flow report ships with, and the live formulas behind the Calc sheet.
 *
 * The Inputs sheet is the rows the reader confirmed, in the five-column shape the workbook's formula
 * addressing assumes (Label, Period, Category, Amount, Currency). Every formula below is a SUMIFS over
 * *that* sheet, so a reader who corrects one row in Excel watches the cash in, the cash out and the
 * net move with it. The only literals in a formula are our own side names; a period the reader typed
 * is referenced as the Calc row's own Period cell and never inlined.
 */
import {
  CALC_TABLE_ID,
  INPUTS_TABLE_ID,
  REPORT_TABLE_FIRST_DATA_ROW,
  type ReportCell,
  type ReportLocale,
  type ReportTable,
} from "../report";
import { CALC_COLUMNS, CALC_VALUE_COLUMN } from "../report-formulas";
import type { CashflowComputed } from "./compute";
import { cashflowFigures, type CashflowFigure } from "./figures";
import { formatCashflowValue } from "./format";
import { cashflowRowKind } from "./periods";
import type { CashflowItem } from "./types";

type Text = Readonly<Record<ReportLocale, string>>;

const TITLES = Object.freeze({
  inputs: { id: "Baris yang dikonfirmasi", en: "Confirmed rows" },
  calc: { id: "Perhitungan", en: "Calculations" },
  periods: { id: "Arus kas per periode", en: "Cash flow by period" },
  burn: { id: "Burn dan runway per basis", en: "Burn and runway by basis" },
  breakeven: { id: "Titik impas", en: "Breakeven" },
  scenario: { id: "Skenario what-if", en: "What-if scenario" },
  classification: { id: "Klasifikasi biaya", en: "Cost classification" },
});

const COLUMNS = Object.freeze({
  period: { id: "Periode", en: "Period" },
  cashIn: { id: "Kas masuk", en: "Cash in" },
  cashOut: { id: "Kas keluar", en: "Cash out" },
  financing: { id: "Pendanaan", en: "Financing" },
  net: { id: "Arus kas bersih", en: "Net operating" },
  closing: { id: "Saldo akhir", en: "Closing cash" },
  basis: { id: "Basis", en: "Basis" },
  periodsUsed: { id: "Periode dipakai", en: "Periods used" },
  grossBurn: { id: "Burn kotor", en: "Gross burn" },
  netBurn: { id: "Burn bersih", en: "Net burn" },
  runway: { id: "Runway (bulan)", en: "Runway (months)" },
  figure: { id: "Angka", en: "Figure" },
  value: { id: "Nilai", en: "Value" },
  category: { id: "Kategori", en: "Category" },
  side: { id: "Sisi", en: "Side" },
  behaviour: { id: "Perilaku biaya", en: "Cost behaviour" },
  confidence: { id: "Keyakinan", en: "Confidence" },
  label: { id: "Label", en: "Label" },
  amount: { id: "Jumlah", en: "Amount" },
  currency: { id: "Mata uang", en: "Currency" },
});

function say(text: Text, locale: ReportLocale): string {
  return text[locale] ?? text.en;
}

/**
 * One confirmed row as the report read it: on the side `cashflowRowKind` put it, at the amount that
 * side summed — a magnitude for cash in and cash out, the signed figure for financing and the
 * opening balance — under the period the book grouped it by. Writing the raw category or a bank
 * export's negative outflow here would make every SUMIFS below add up a different book.
 */
function inputsRow(row: CashflowItem): ReportCell[] {
  const side = cashflowRowKind(row) ?? null;
  const amount = side === "inflow" || side === "outflow" ? Math.abs(row.amount) : row.amount;
  return [row.label, row.period.trim(), side, amount, row.currency];
}

/** The five-column Inputs sheet the Calc formulas address. Column names stay English by contract. */
export function inputsTable(computed: CashflowComputed, locale: ReportLocale): ReportTable {
  return {
    id: INPUTS_TABLE_ID,
    title: say(TITLES.inputs, locale),
    columns: ["Label", "Period", "Category", "Amount", "Currency"],
    rows: computed.rows.map(inputsRow),
  };
}

const AMOUNT = "Inputs!$D:$D";
const SIDE = "Inputs!$C:$C";
const PERIOD = "Inputs!$B:$B";

function periodRef(rowIndex: number): string {
  return `$D${REPORT_TABLE_FIRST_DATA_ROW + rowIndex}`;
}

/** `SUMIFS(amount, side, "inflow", period, <this row's period>)` — the period is a cell, never a literal. */
function sideSum(side: string, rowIndex: number, hasPeriod: boolean): string {
  const base = `SUMIFS(${AMOUNT},${SIDE},"${side}"`;
  return hasPeriod ? `${base},${PERIOD},${periodRef(rowIndex)})` : `${base})`;
}

/** The live formula for one Calc row, or null when the figure cannot be expressed over the Inputs sheet. */
export function cashflowFormula(figure: CashflowFigure, rowIndex: number, hasOpeningRow: boolean): string | null {
  const base = figure.key.split(".")[0] ?? "";
  const periodic = figure.key.includes(".") && figure.period !== "";
  if (base === "cashIn") {
    return sideSum("inflow", rowIndex, periodic);
  }
  if (base === "cashOut") {
    return sideSum("outflow", rowIndex, periodic);
  }
  if (base === "netCash") {
    return `${sideSum("inflow", rowIndex, periodic)}-${sideSum("outflow", rowIndex, periodic)}`;
  }
  if (base === "financingInflow") {
    return sideSum("financing", rowIndex, periodic);
  }
  if (figure.key === "totalCashIn") {
    return sideSum("inflow", rowIndex, false);
  }
  if (figure.key === "totalCashOut") {
    return sideSum("outflow", rowIndex, false);
  }
  if (figure.key === "totalFinancing") {
    return sideSum("financing", rowIndex, false);
  }
  return figure.key === "openingCash" && hasOpeningRow ? sideSum("opening", rowIndex, false) : null;
}

/**
 * True when the opening rows on Inputs add up to the balance the book opened on. A typed opening
 * balance beats the sheet's own row, and only the first opening row is read, so otherwise a SUMIFS
 * over those rows would show a figure the report never used.
 */
function openingFromRows(computed: CashflowComputed): boolean {
  const opening = computed.rows.filter((row) => cashflowRowKind(row) === "opening");
  return opening.length > 0 && opening.reduce((total, row) => total + row.amount, 0) === computed.openingCash;
}

/** The Calc sheet: one row per computed figure, with a live formula wherever one exists. */
export function calcTable(computed: CashflowComputed, locale: ReportLocale): ReportTable {
  const figures = cashflowFigures(computed, locale);
  const hasOpeningRow = openingFromRows(computed);
  return {
    id: CALC_TABLE_ID,
    title: say(TITLES.calc, locale),
    columns: [...CALC_COLUMNS],
    rows: figures.map((figure) => [figure.label, figure.value, figure.unit, figure.period, figure.formula]),
    formulas: figures.map((figure, rowIndex) =>
      CALC_COLUMNS.map((_column, columnIndex) =>
        columnIndex === CALC_VALUE_COLUMN ? cashflowFormula(figure, rowIndex, hasOpeningRow) : null,
      ),
    ),
  };
}

/** The cash book itself: every period, both sides, the net and the running balance. */
export function periodsTable(computed: CashflowComputed, locale: ReportLocale): ReportTable {
  return {
    id: "periods",
    title: say(TITLES.periods, locale),
    columns: [
      say(COLUMNS.period, locale),
      say(COLUMNS.cashIn, locale),
      say(COLUMNS.cashOut, locale),
      say(COLUMNS.financing, locale),
      say(COLUMNS.net, locale),
      say(COLUMNS.closing, locale),
    ],
    rows: computed.periods.map((period) => [
      period.period,
      period.cashIn,
      period.cashOut,
      period.financingIn,
      period.netOperating,
      period.closingCash,
    ]),
  };
}

/** Every burn basis side by side, because they disagree and the reader deserves to see by how much. */
export function burnTable(computed: CashflowComputed, locale: ReportLocale): ReportTable {
  return {
    id: "burn",
    title: say(TITLES.burn, locale),
    columns: [
      say(COLUMNS.basis, locale),
      say(COLUMNS.periodsUsed, locale),
      say(COLUMNS.grossBurn, locale),
      say(COLUMNS.netBurn, locale),
      say(COLUMNS.runway, locale),
    ],
    rows: computed.burns.map((burn) => [
      burn.id,
      burn.periods.join(", "),
      burn.grossBurn,
      burn.netBurn,
      burn.runwayMonths,
    ]),
  };
}

/** The breakeven working, shown rather than asserted: the bases, the margin, then the answer. */
export function breakevenTable(computed: CashflowComputed, locale: ReportLocale): ReportTable {
  const keys = new Set([
    "totalCashIn",
    "variableCostBase",
    "fixedCostBase",
    "oneOffCostBase",
    "contributionMarginPct",
    "breakevenRevenue.perPeriod",
    "breakevenRevenue.total",
  ]);
  const figures = cashflowFigures(computed, locale).filter((figure) => keys.has(figure.key));
  return {
    id: "breakeven",
    title: say(TITLES.breakeven, locale),
    columns: [say(COLUMNS.figure, locale), say(COLUMNS.value, locale), "Formula"],
    rows: figures.map((figure) => [figure.label, figure.value, figure.formula]),
  };
}

/** The what-if on every baseline, with the baseline it started from beside it. */
export function scenarioTable(computed: CashflowComputed, locale: ReportLocale): ReportTable | null {
  if (computed.outcomes.length === 0) {
    return null;
  }
  return {
    id: "scenario",
    title: say(TITLES.scenario, locale),
    columns: [
      say(COLUMNS.basis, locale),
      say(COLUMNS.periodsUsed, locale),
      say(COLUMNS.net, locale),
      say(COLUMNS.cashIn, locale),
      say(COLUMNS.cashOut, locale),
      say(COLUMNS.netBurn, locale),
      say(COLUMNS.runway, locale),
    ],
    rows: computed.outcomes.flatMap((outcome) => [
      [
        `${outcome.basis} (baseline)`,
        outcome.periods.join(", "),
        outcome.baseline.netOperating,
        outcome.baseline.cashIn,
        outcome.baseline.cashOut,
        -outcome.baseline.netOperating,
        null,
      ],
      [
        `${outcome.basis} (what-if)`,
        outcome.periods.join(", "),
        outcome.netOperating,
        outcome.cashIn,
        outcome.cashOut,
        outcome.netBurn,
        outcome.runwayMonths,
      ],
    ]),
  };
}

/** Which source category was read as what, and how sure the rules were. Shown so it can be argued with. */
export function classificationTable(computed: CashflowComputed, locale: ReportLocale): ReportTable | null {
  if (computed.classification.length === 0) {
    return null;
  }
  return {
    id: "classification",
    title: say(TITLES.classification, locale),
    columns: [
      say(COLUMNS.category, locale),
      say(COLUMNS.side, locale),
      say(COLUMNS.behaviour, locale),
      say(COLUMNS.confidence, locale),
    ],
    rows: computed.classification.map((entry) => [
      entry.label,
      entry.kind,
      entry.behaviour ?? entry.role ?? "",
      formatCashflowValue(entry.confidence * 100, "percent", locale),
    ]),
  };
}

/** Every sheet the report carries, in the order the renderers write them. */
export function cashflowTables(computed: CashflowComputed, locale: ReportLocale): ReportTable[] {
  return [
    inputsTable(computed, locale),
    calcTable(computed, locale),
    periodsTable(computed, locale),
    burnTable(computed, locale),
    breakevenTable(computed, locale),
    scenarioTable(computed, locale),
    classificationTable(computed, locale),
  ].filter((table): table is ReportTable => table !== null);
}
