/**
 * Every computed figure, once, as one list.
 *
 * The Calc sheet, the prompt the model is given and the numbers the guard will accept all read this
 * list and nothing else. That is the whole point: a figure the model is shown but not allowed comes
 * back as "[unverified figure]", and the only way to be sure the two agree is for them to be the same
 * array. Adding a figure here adds it to the workbook, to the prompt and to the guard at once.
 */
import type { ReportLocale } from "../report";
import type { CashflowBurn, CashflowBurnBasisId } from "./burn";
import type { CashflowComputed } from "./compute";
import type { CashflowScenarioBasisId, CashflowScenarioOutcome } from "./scenario";
import type { CashflowUnit } from "./format";

export type CashflowFigure = {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly unit: CashflowUnit;
  readonly period: string;
  /** How it was worked out, in words a reader can check against the Inputs sheet. */
  readonly formula: string;
};

type Text = Readonly<Record<ReportLocale, string>>;

const BURN_BASIS_NAME: Readonly<Record<CashflowBurnBasisId, Text>> = Object.freeze({
  last3: { id: "periode terakhir", en: "recent periods" },
  negative: { id: "periode minus", en: "loss-making periods" },
  all: { id: "seluruh periode", en: "all periods" },
});

const SCENARIO_BASIS_NAME: Readonly<Record<CashflowScenarioBasisId, Text>> = Object.freeze({
  lastPeriod: { id: "basis periode terakhir", en: "last period basis" },
  recentAverage: { id: "basis rata-rata periode terakhir", en: "recent average basis" },
});

const WORDS = Object.freeze({
  cashIn: { id: "Kas masuk", en: "Operating cash in" },
  cashOut: { id: "Kas keluar", en: "Operating cash out" },
  netCash: { id: "Arus kas bersih", en: "Net operating cash flow" },
  closingCash: { id: "Saldo akhir", en: "Closing cash" },
  openingCash: { id: "Saldo awal", en: "Opening cash" },
  financing: { id: "Pendanaan masuk", en: "Financing inflow" },
  totalIn: { id: "Total kas masuk", en: "Operating cash in, all periods" },
  totalOut: { id: "Total kas keluar", en: "Operating cash out, all periods" },
  totalFinancing: { id: "Total pendanaan masuk", en: "Financing inflow, all periods" },
  grossBurn: { id: "Burn kotor", en: "Gross burn" },
  netBurn: { id: "Burn bersih", en: "Net burn" },
  runway: { id: "Runway", en: "Runway" },
  monthsToZero: { id: "Bulan sampai kas habis", en: "Months until cash runs out" },
  contributionMargin: { id: "Margin kontribusi", en: "Contribution margin" },
  breakevenPerPeriod: { id: "Pendapatan BEP per periode", en: "Breakeven revenue per period" },
  breakevenTotal: { id: "Pendapatan BEP seluruh periode", en: "Breakeven revenue, all periods" },
  variableBase: { id: "Biaya variabel", en: "Variable cost" },
  fixedBase: { id: "Biaya tetap", en: "Fixed cost" },
  oneOffBase: { id: "Biaya sekali jalan", en: "One-off cost" },
  scenarioCashIn: { id: "Kas masuk setelah skenario", en: "Cash in after the scenario" },
  scenarioCashOut: { id: "Kas keluar setelah skenario", en: "Cash out after the scenario" },
  scenarioNet: { id: "Arus kas bersih setelah skenario", en: "Net cash flow after the scenario" },
  scenarioGrossBurn: { id: "Burn kotor setelah skenario", en: "Gross burn after the scenario" },
  scenarioNetBurn: { id: "Burn bersih setelah skenario", en: "Net burn after the scenario" },
  scenarioRunway: { id: "Runway setelah skenario", en: "Runway after the scenario" },
  scenarioDeltaIn: { id: "Tambahan kas masuk skenario", en: "Cash in added by the scenario" },
  scenarioDeltaOut: { id: "Tambahan kas keluar skenario", en: "Cash out added by the scenario" },
  scenarioOneOff: { id: "Pengeluaran sekali jalan skenario", en: "One-off spend in the scenario" },
});

function say(text: Text, locale: ReportLocale): string {
  return text[locale] ?? text.en;
}

function figure(
  key: string,
  label: string,
  value: number | null,
  unit: CashflowUnit,
  period: string,
  formula: string,
): CashflowFigure {
  return { key, label, value, unit, period, formula };
}

/** One row per period per side, plus the running balance. Every value carries its own period. */
function periodFigures(computed: CashflowComputed, locale: ReportLocale): CashflowFigure[] {
  return computed.periods.flatMap((period) => [
    figure(`cashIn.${period.period}`, `${say(WORDS.cashIn, locale)} ${period.period}`, period.cashIn, "currency", period.period, "sum(inflow rows)"),
    figure(`cashOut.${period.period}`, `${say(WORDS.cashOut, locale)} ${period.period}`, period.cashOut, "currency", period.period, "sum(outflow rows)"),
    figure(`netCash.${period.period}`, `${say(WORDS.netCash, locale)} ${period.period}`, period.netOperating, "currency", period.period, "cash in - cash out"),
    figure(`closingCash.${period.period}`, `${say(WORDS.closingCash, locale)} ${period.period}`, period.closingCash, "currency", period.period, "previous closing + net + financing"),
  ]);
}

function financingFigures(computed: CashflowComputed, locale: ReportLocale): CashflowFigure[] {
  return computed.financing.map((entry) =>
    figure(
      `financingInflow.${entry.period}`,
      `${say(WORDS.financing, locale)} ${entry.period}`,
      entry.amount,
      "currency",
      entry.period,
      "financing rows only, outside operating cash",
    ),
  );
}

function totalFigures(computed: CashflowComputed, locale: ReportLocale): CashflowFigure[] {
  const { totals } = computed;
  return [
    figure("openingCash", say(WORDS.openingCash, locale), computed.openingCash, "currency", "", "stated opening balance"),
    figure("totalCashIn", say(WORDS.totalIn, locale), totals.cashIn, "currency", "", "sum of every period's cash in"),
    figure("totalCashOut", say(WORDS.totalOut, locale), totals.cashOut, "currency", "", "sum of every period's cash out"),
    ...(totals.financingIn === 0
      ? []
      : [figure("totalFinancing", say(WORDS.totalFinancing, locale), totals.financingIn, "currency", "", "sum of financing rows")]),
    figure("closingCash", `${say(WORDS.closingCash, locale)} ${computed.lastPeriod}`.trim(), computed.closingCash, "currency", computed.lastPeriod, "opening + every period's net + financing"),
  ];
}

function burnFigures(burn: CashflowBurn, locale: ReportLocale): CashflowFigure[] {
  const basis = say(BURN_BASIS_NAME[burn.id], locale);
  const window = burn.periods.length === 0 ? "-" : `${burn.periods.length} periods: ${burn.periods.join(", ")}`;
  return [
    figure(`grossBurn.${burn.id}`, `${say(WORDS.grossBurn, locale)} (${basis})`, burn.grossBurn, "currency", basis, `mean cash out over ${window}`),
    figure(`netBurn.${burn.id}`, `${say(WORDS.netBurn, locale)} (${basis})`, burn.netBurn, "currency", basis, `mean (cash out - cash in) over ${window}`),
    figure(`runwayMonths.${burn.id}`, `${say(WORDS.runway, locale)} (${basis})`, burn.runwayMonths, "months", basis, "closing cash / net burn"),
  ];
}

function breakevenFigures(computed: CashflowComputed, locale: ReportLocale): CashflowFigure[] {
  const { breakeven } = computed;
  return [
    figure("variableCostBase", say(WORDS.variableBase, locale), breakeven.variableBase, "currency", "", "sum of variable outflow rows"),
    figure("fixedCostBase", say(WORDS.fixedBase, locale), breakeven.fixedBase, "currency", "", "sum of fixed outflow rows, one-offs excluded"),
    figure("oneOffCostBase", say(WORDS.oneOffBase, locale), breakeven.oneOffBase, "currency", "", "sum of one-off outflow rows"),
    figure("contributionMarginPct", say(WORDS.contributionMargin, locale), breakeven.contributionMarginPct, "percent", "", "1 - variable cost / cash in"),
    figure("breakevenRevenue.perPeriod", say(WORDS.breakevenPerPeriod, locale), breakeven.revenuePerPeriod, "currency", "", "fixed cost per period / contribution margin"),
    figure("breakevenRevenue.total", say(WORDS.breakevenTotal, locale), breakeven.revenueTotal, "currency", "", "fixed cost / contribution margin"),
  ];
}

function scenarioFigures(outcome: CashflowScenarioOutcome, locale: ReportLocale): CashflowFigure[] {
  const basis = say(SCENARIO_BASIS_NAME[outcome.basis], locale);
  const at = `whatIf.${outcome.basis}`;
  const over = outcome.periods.join(", ");
  return [
    figure(`${at}.deltaCashIn`, `${say(WORDS.scenarioDeltaIn, locale)} (${basis})`, outcome.deltaCashIn, "currency", basis, "sum of the scenario's inflow adjustments"),
    figure(`${at}.deltaCashOut`, `${say(WORDS.scenarioDeltaOut, locale)} (${basis})`, outcome.deltaCashOut, "currency", basis, "sum of the scenario's outflow adjustments"),
    figure(`${at}.cashIn`, `${say(WORDS.scenarioCashIn, locale)} (${basis})`, outcome.cashIn, "currency", basis, `baseline cash in over ${over} + adjustments`),
    figure(`${at}.cashOut`, `${say(WORDS.scenarioCashOut, locale)} (${basis})`, outcome.cashOut, "currency", basis, `baseline cash out over ${over} + adjustments`),
    figure(`${at}.netCash`, `${say(WORDS.scenarioNet, locale)} (${basis})`, outcome.netOperating, "currency", basis, "new cash in - new cash out"),
    figure(`${at}.grossBurn`, `${say(WORDS.scenarioGrossBurn, locale)} (${basis})`, outcome.grossBurn, "currency", basis, "new cash out"),
    figure(`${at}.netBurn`, `${say(WORDS.scenarioNetBurn, locale)} (${basis})`, outcome.netBurn, "currency", basis, "new cash out - new cash in"),
    figure(`${at}.runwayMonths`, `${say(WORDS.scenarioRunway, locale)} (${basis})`, outcome.runwayMonths, "months", basis, "closing cash / new net burn"),
    ...(outcome.oneOffTotal === 0
      ? []
      : [figure(`${at}.oneOff`, `${say(WORDS.scenarioOneOff, locale)} (${basis})`, outcome.oneOffTotal, "currency", basis, "single events, taken off the balance once")]),
  ];
}

/** Every computed figure, in reading order: the book, then the burn, then breakeven, then the what-if. */
export function cashflowFigures(computed: CashflowComputed, locale: ReportLocale): CashflowFigure[] {
  return [
    ...totalFigures(computed, locale),
    ...periodFigures(computed, locale),
    ...financingFigures(computed, locale),
    ...computed.burns.flatMap((burn) => burnFigures(burn, locale)),
    figure("monthsToZeroCash", say(WORDS.monthsToZero, locale), computed.monthsToZeroCash, "months", "", "closing cash / net burn over the recent periods"),
    ...breakevenFigures(computed, locale),
    ...computed.outcomes.flatMap((outcome) => scenarioFigures(outcome, locale)),
  ];
}
