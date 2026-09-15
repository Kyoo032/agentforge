export { LINE_ITEM_CATEGORIES, lineItemSchema, lineItemsSchema } from "./types";
export type { CashFlow, LineItem, LineItemCategory, Metric } from "./types";
export {
  IRR_MAX_ITERATIONS,
  IRR_TOLERANCE,
  amortizationSchedule,
  breakevenRevenue,
  breakevenUnits,
  cagrPercent,
  growthRates,
  irr,
  marginPercent,
  npv,
  project,
  ratioSet,
  runwayMonths,
  scenarios,
  sumBy,
  totalsByPeriod,
} from "./engine";
export type { AmortizationRow, PeriodTotal, ProjectionPoint, RatioInputs, RatioSet, Scenario } from "./engine";
export {
  GUARD_ABSOLUTE_TOLERANCE,
  GUARD_RELATIVE_TOLERANCE,
  UNVERIFIED_MARKER,
  extractNumbers,
  guardNumbers,
  isFreeNumber,
  matchesAllowed,
} from "./number-guard";
export type { GuardResult, NumberToken } from "./number-guard";
export { computeFinance, formatMetricForPrompt } from "./metrics";
export type { ComputedFinance, FinanceParams } from "./metrics";
export { LINE_ITEMS_MAX, guessCategory, lineItemsFromTable, parseLineItems } from "./line-items";
export { COUNT_ROW_MAX_AMOUNT, COUNT_WORDS, dropCountRows, isCountRow } from "./count-rows";
export { MAGNITUDE_EXPONENTS, expandMagnitudes, looksScaled, magnitudeValues } from "./magnitude";
