/**
 * The cash-flow maths, behind one import.
 *
 * Nine small modules rather than one big one, because each answers a different question and each is
 * tested on its own: what a row is (`types`, `classify`), what a period is (`periods`, `ledger`), how
 * fast the cash is going (`burn`), what it takes to stand still (`breakeven`), what a what-if does
 * (`scenario`), when the till empties (`calendar`), and how any of it is written down (`format`,
 * `figures`, `report*`).
 */
export {
  CASHFLOW_CONFIRM_BELOW,
  CASHFLOW_ROLES,
  CASHFLOW_ROW_KINDS,
  CASHFLOW_TARGETS,
  COST_BEHAVIOURS,
  cashflowAdjustmentSchema,
  cashflowBreakdownSchema,
  cashflowCategorySchema,
  cashflowItemSchema,
  cashflowScenarioSchema,
} from "./types";
export type {
  CashflowAdjustment,
  CashflowBreakdown,
  CashflowCategory,
  CashflowItem,
  CashflowRole,
  CashflowRowKind,
  CashflowScenario,
  CashflowTarget,
  CostBehaviour,
} from "./types";

export { addCalendarMonths, formatCalendarMonth, monthCashRunsOut, parseCalendarMonth } from "./calendar";
export type { CalendarMonth } from "./calendar";

export { classifyCashflowLabel, lowConfidenceCategories } from "./classify";
export type { CashflowClassifyHint } from "./classify";

export {
  CASHFLOW_ROW_NAMES,
  EMPTY_FOLD,
  cashflowRowsFromFolds,
  foldAmount,
  foldCategories,
  foldPeriodOrder,
  isSignedBook,
} from "./fold";
export type { CashflowFold, CashflowOpening, CashflowRowNames } from "./fold";

export { aggregateCashflowLedger, isFinancingCategory } from "./ledger";
export type { CashflowLedger, CashflowLedgerEntry, CashflowLedgerGroup, CashflowLedgerTotals } from "./ledger";

export {
  cashflowRowKind,
  classificationFromItems,
  openingCashFromItems,
  periodInputsFromItems,
  totalOver,
  walkPeriods,
} from "./periods";
export type { CashflowPeriod, CashflowPeriodInput } from "./periods";

export { CASHFLOW_BURN_BASES, CASHFLOW_RECENT_PERIODS, burnBases, burnBasisPeriods, burnOnBasis, negativePeriods } from "./burn";
export type { CashflowBurn, CashflowBurnBasisId } from "./burn";

export { cashflowBreakeven } from "./breakeven";
export type { CashflowBreakeven } from "./breakeven";

export { CASHFLOW_SCENARIO_BASES, runScenario, runScenarioOn, scenarioBaselines } from "./scenario";
export type { CashflowScenarioBaseline, CashflowScenarioBasisId, CashflowScenarioOutcome } from "./scenario";

export { CASHFLOW_UNITS, CASHFLOW_MISSING, allowedReadings, formatCashflowValue, magnitudeReadings } from "./format";
export type { CashflowUnit } from "./format";

export { cashflowInputSchema, cashflowParamsSchema, computeCashflow, scenarioFromParams } from "./compute";
export type { CashflowComputed, CashflowInput, CashflowParams, CashflowTotals } from "./compute";

export { cashflowFigures } from "./figures";
export type { CashflowFigure } from "./figures";

export { cashflowAllowedNumbers, cashflowPromptFacts } from "./facts";

export {
  CASHFLOW_RUNWAY_RISK_MONTHS,
  CASHFLOW_RUNWAY_WATCH_MONTHS,
  cashflowFlags,
  cashflowKpis,
  cashflowReport,
} from "./report";
export { cashflowCharts } from "./report-charts";
export { cashflowFormula, cashflowTables } from "./report-tables";
