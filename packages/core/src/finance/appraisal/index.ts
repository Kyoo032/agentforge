/** The investment appraisal's pure maths, behind one import. Nothing here reaches a model or a file. */
export { APPRAISAL_MAX_PERIODS, allPeriodsOrdinal, periodOrdinal } from "./periods";
export {
  appraisalFlowsFromItems,
  componentLabel,
  dropSubtotalRows,
  isSubtotalLabel,
  isTaggedSubtotal,
  negativeYearsOf,
  netFlowsOf,
  outlayOf,
} from "./flows";
export type { AppraisalComponent, AppraisalYearFlow } from "./flows";
export { appraisalGridFromText, discountRateFromText, gridAmount } from "./grid";
export type { AppraisalGrid } from "./grid";
export {
  cumulative,
  cumulativeDiscounted,
  discountedFlows,
  discountedPaybackYears,
  paybackFrom,
  paybackYears,
  profitabilityIndex,
} from "./series";
export type { PaybackPoint } from "./series";
export {
  IRR_SCAN_MAX,
  IRR_SCAN_MIN,
  IRR_SCAN_STEPS,
  breakevenRatePercent,
  mirrPercent,
  npvZeroCrossings,
  rateAtZero,
  scanIrr,
  signChanges,
} from "./irr-scan";
export type { IrrScan, ZeroCrossing } from "./irr-scan";
export {
  DEFAULT_SHIFT_PERCENTS,
  defaultRatePercents,
  negativeCells,
  npvAtRates,
  scaleFlows,
  sensitivityGrid,
  sensitivityNpv,
} from "./sensitivity";
export type { HurdleNpv, SensitivityAxes, SensitivityCell } from "./sensitivity";
export { computeAppraisal } from "./compute";
export type { AppraisalComputed, AppraisalParams, AppraisalPeriod } from "./compute";
export { formatAmount, formatPercent, formatRatio, formatYears, magnitudeReadings } from "./format";
export { APPRAISAL_SECTIONS, APPRAISAL_TEXT, appraisalText, rateLabel, shiftColumnLabel } from "./labels";
export type { AppraisalTextKey, Localized } from "./labels";
export { appraisalAllowedNumbers, appraisalFacts, appraisalPromptFacts } from "./facts";
export type { AppraisalFact } from "./facts";
export { APPRAISAL_TABLE_IDS, appraisalCalcRows, appraisalTables } from "./tables";
export { appraisalCharts, appraisalFlags, appraisalReport, appraisalSummary } from "./report";
