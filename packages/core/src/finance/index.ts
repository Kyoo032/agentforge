export { LINE_ITEM_CATEGORIES, lineItemSchema, lineItemsSchema, registerCellSchema } from "./types";
export type { CashFlow, LineItem, LineItemCategory, Metric, RegisterCell } from "./types";
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
export type { ComputedFinance, FinanceComputeOptions, FinanceParams, StatedCheck } from "./metrics";
export { LINE_ITEMS_MAX, guessCategory, lineItemsFromTable, parseLineItems } from "./line-items";
export {
  COUNT_ROW_MAX_AMOUNT,
  COUNT_WORDS,
  dropCountRows,
  hasCountWord,
  hasUnitMarker,
  isCountAmount,
  isCountRow,
} from "./count-rows";
export {
  DERIVED_ROW_ABSOLUTE_TOLERANCE,
  DERIVED_ROW_RELATIVE_TOLERANCE,
  dropDerivedLineItems,
  isDerivedName,
  isResultName,
  isTotalName,
  markDerivedLineItems,
  splitDerivedLineItems,
  withDerivedFlags,
} from "./derived-rows";
export type { DerivedMarkOptions } from "./derived-rows";
// `formatPercent` / `formatRatio` / `formatMonths` are not re-exported here: the appraisal task
// already owns those names on this barrel. Import them from `./format-number` directly.
export {
  DEFAULT_COMPACT_DECIMALS,
  DEFAULT_PERCENT_DECIMALS,
  formatCompactCurrency,
  formatCurrency,
  formatMetricValue,
  formatNumber,
} from "./format-number";
export type { FormattableMetric } from "./format-number";
export { SUBTOTAL_TAG, readFiguresText } from "./figures-text";
export { factSentences, statedFactValues, statedFactsFromProse, withFactLabels } from "./stated-facts";
export type { StatedFact, StatedFactUnit } from "./stated-facts";
export type { FigureRow, FiguresTextRead, StatedFigure } from "./figures-text";
export { isNonMonetary, labelId, lineItemsFromRows, readCategory } from "./figures-rows";
export type { FigureRowsOptions, FigureRowsRead, UnclassifiedLabel } from "./figures-rows";
export {
  categoriseRows,
  categoryFor,
  conventionTotal,
  costMagnitude,
  isNonOperatingRole,
  roleOf,
} from "./line-item-normalise";
export type { CategorisedRow, LineItemRole } from "./line-item-normalise";
export {
  FISCAL_YEAR_PREFIX,
  fiscalYearGroups,
  isSubYearPeriod,
  monthsInGroup,
  monthsInPeriod,
  parsePeriod,
} from "./fiscal-periods";
export type { FiscalYearGroup, PeriodParts } from "./fiscal-periods";
export { aggregateBases, figuresForPeriod, figuresFrom, periodBase } from "./period-figures";
export type { PeriodBase, PeriodFigures } from "./period-figures";
export { periodLadderMetrics, suffixed } from "./period-metrics";
export { breakevenPeriodMetric, burnBasisMonths, burnMetrics, burnReadings, trendMetrics } from "./trend-metrics";
export type { BurnReading, TrendOptions } from "./trend-metrics";
export { MAGNITUDE_EXPONENTS, expandMagnitudes, looksScaled, magnitudeValues } from "./magnitude";
export { FINANCE_NAME_PSEUDONYM_PREFIX, classifyFinanceHeader, pseudonymAllocator } from "./pii-columns";
export type { FinanceColumnKind } from "./pii-columns";
export { FINANCE_PII_PREVIEW_MAX, financeIdentifierCells, scanFinanceTablePii } from "./pii-scan";
export type { FinancePiiHit, FinancePiiInput, FinancePiiScan } from "./pii-scan";

export {
  DEFAULT_FINANCE_TASK,
  FINANCE_PHASES,
  FINANCE_PHASE_KINDS,
  FINANCE_TASKS,
  FINANCE_TASK_META,
  availableFinanceTasks,
  defaultFinancePrompt,
  financeTaskAvailable,
  financeTaskMeta,
  financeTaskPhases,
  financeTaskSystemRules,
  isFinancePhase,
  isFinanceTask,
} from "./tasks";
export type { FinancePhaseId, FinancePhaseKind, FinanceTask, FinanceTaskMeta } from "./tasks";
export {
  CALC_TABLE_ID,
  INPUTS_TABLE_ID,
  REPORT_CHART_KINDS,
  REPORT_FLAG_LEVELS,
  REPORT_TABLE_FIRST_DATA_ROW,
  isReportChartKind,
  isReportFlagLevel,
  reportTable,
} from "./report";
export type {
  FinanceReport,
  ReportCell,
  ReportChart,
  ReportChartKind,
  ReportFlag,
  ReportFlagLevel,
  ReportKpi,
  ReportLocale,
  ReportNote,
  ReportSeries,
  ReportTable,
} from "./report";
export {
  ASSUMPTIONS_HEADING,
  KPI_MAX,
  REMOVED_SENTENCE_FLAG,
  financeReportFromBrief,
  financeReportFromMarkdown,
} from "./report-brief";
export type { FinanceReportOptions, GuardFlags, MarkdownReportOptions } from "./report-brief";

export {
  FINANCE_TASK_MODULES,
  getFinanceTaskModule,
  hasFinanceTaskModule,
  implementedFinanceTasks,
} from "./tasks/registry";
export { briefInputSchema, briefParamsSchema, briefTaskModule } from "./tasks/brief";
export type { BriefTaskInput } from "./tasks/brief";
export { cashflowTaskModule } from "./tasks/cashflow";
export * from "./cashflow/index";
export { budgetTaskModule } from "./tasks/budget";
export * from "./budget/index";
export { ratiosInputSchema, ratiosParamsSchema, ratiosTaskModule } from "./tasks/ratios";
export type { RatiosComputed, RatiosTaskInput } from "./tasks/ratios";
export {
  RATIO_BUCKETS,
  RATIO_BUCKET_MEMBERSHIP,
  RATIO_BUCKET_SIGN,
  RATIO_BUCKET_STATEMENT,
  bucketAggregates,
  bucketAmount,
  bucketsFeeding,
  isRatioBucket,
  ratioBucketSchema,
} from "./ratios/buckets";
export type { RatioAggregate, RatioBucket, RatioStatement } from "./ratios/buckets";
export {
  DEFAULT_RATIO_BANDS,
  RATIO_BAND_LEVELS,
  bandFor,
  bandForMetric,
  ratioBandOverrideSchema,
  ratioBandRule,
  ratioBandTable,
  reportFlagLevel,
  trendOf,
} from "./ratios/bands";
export type { RatioBandLevel, RatioBandOverride, RatioBandRule, RatioTrend } from "./ratios/bands";
export {
  classifyRatioRow,
  classifyRatioRows,
  normalizeRatioLabel,
  ratioBucketOverrideSchema,
  readImportedLabel,
  unplacedRatioRows,
} from "./ratios/classify";
export type {
  ClassifiedRatioRow,
  RatioBucketOverride,
  RatioClassification,
  RatioClassifySource,
  RatioRowInput,
} from "./ratios/classify";
export { DEFAULT_DAYS_PER_YEAR, computeRatios, ratioFigures, ratioValue } from "./ratios/compute";
export type { ComputedRatios, RatioParams, RatioPeriodFigures } from "./ratios/compute";
export { RATIO_STATED_TOLERANCE, ratioMismatches, repairRatioRows } from "./ratios/reconcile";
export type { RatioMismatch, RatioRepair } from "./ratios/reconcile";
export { RATIO_STATED_KEYS, ratioStatedKeyFor, ratioStatedRowSchema, statedTotalsFor } from "./ratios/stated";
export type { RatioStatedKey, RatioStatedRow, RatioStatedTotals } from "./ratios/stated";
export { formatRatioMagnitude, formatRatioValue, ratioUnitToken } from "./ratios/format";
export { readRatioAmount, readRatioCurrency, readRatioRows } from "./ratios/read-figures";
export type { ReadRatioRows } from "./ratios/read-figures";
export { RATIO_METRICS, RATIO_RATIO_METRICS, ratioMetricMeta } from "./ratios/keys";
export type { RatioMetricMeta, RatioUnit } from "./ratios/keys";
export {
  RATIO_GAUGE_KEYS,
  RATIO_HEADLINE_KEYS,
  headlineScorecard,
  ratioScorecard,
  ratioTotalsCard,
} from "./ratios/scorecard";
export type { RatioScorecardEntry } from "./ratios/scorecard";
export { RATIO_TEXT, bandWord, say as sayRatioText, trendWord } from "./ratios/text";
export {
  APPRAISAL_AXIS_MAX,
  DEFAULT_APPRAISAL_RATE_PERCENT,
  appraisalInputSchema,
  appraisalParamsFrom,
  appraisalParamsSchema,
  appraisalTaskModule,
} from "./tasks/appraisal";
export type { AppraisalTaskInput } from "./tasks/appraisal";
export {
  APPRAISAL_SECTIONS,
  APPRAISAL_TABLE_IDS,
  DEFAULT_SHIFT_PERCENTS,
  appraisalFlowsFromItems,
  appraisalGridFromText,
  appraisalText,
  computeAppraisal,
  discountRateFromText,
  defaultRatePercents,
  dropSubtotalRows,
  formatAmount as appraisalAmount,
  formatPercent as appraisalPercent,
  formatRatio as appraisalRatio,
  formatYears as appraisalYears,
  netFlowsOf,
  outlayOf,
  periodOrdinal,
  rateLabel,
  shiftColumnLabel,
} from "./appraisal";
export type {
  AppraisalComponent,
  AppraisalComputed,
  AppraisalGrid,
  AppraisalParams,
  AppraisalPeriod,
  AppraisalYearFlow,
  IrrScan,
  SensitivityCell,
} from "./appraisal";
export type {
  AnyFinanceTaskModule,
  FinanceTaskModule,
  FinanceTaskProse,
  FinanceTaskReportOptions,
  FinanceTaskSection,
} from "./tasks/types";

export {
  DERIVED_TAG,
  FINANCE_FIGURES_TEXT_MAX,
  FINANCE_IMPORT_EXTENSIONS,
  FINANCE_IMPORT_MAX_BYTES,
  FINANCE_IMPORT_MAX_CELL_CHARS,
  FINANCE_IMPORT_MAX_COLS,
  FINANCE_IMPORT_MAX_ROWS,
  FINANCE_IMPORT_MAX_SHEETS,
  FinanceImportError,
  cellValue,
  financeFiguresFromSheet,
  financeImportExtension,
  financePeriodColumns,
  financePeriodHeaders,
  financeWorkbookKind,
  isCountLabel,
  isCurrencyCode,
  isDerivedLabel,
  isMonthWord,
  isPeriodLabel,
  normalizeAmount,
  ordinalPeriod,
  readFinanceTable,
  registerShape,
  registerSheetPeriod,
  sheetNumberStyle,
  sheetPointStyle,
  tableToFiguresText,
} from "./import-table";
export { readRegister, registerMetrics, registerTable } from "./register-metrics";
export type { RegisterColumnStats, RegisterReading } from "./register-metrics";
export type {
  FinanceFiguresText,
  FinanceImportErrorCode,
  FinanceImportExtension,
  FinanceImportWarning,
  FinanceImportWarningCode,
  FinanceSheet,
  FinanceSheetFact,
  FinanceTableFile,
  NumberStyle,
  PeriodColumn,
  PointStyle,
  RegisterShape,
} from "./import-table";
