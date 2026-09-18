/**
 * Budget versus actual: the pure half.
 *
 * Reading the two sides out of the confirmed rows, proposing the pairing, taking the variance, and
 * writing the report — all of it code, none of it a model, and nothing here opens a socket. The host
 * adds one optional stage on top (an embedding score for the pairing) and the studio adds the screen.
 */
export {
  GENERIC_TOKEN_WEIGHT,
  CONTENT_TOKEN_WEIGHT,
  TRIGRAM_DISCOUNT,
  budgetLabelSimilarity,
  budgetLabelTokens,
  normaliseBudgetLabel,
  tokenOverlapScore,
  trigramScore,
} from "./labels";
export type { BudgetLabelScore, BudgetMatchStage } from "./labels";

export { budgetKindOf, budgetLabelText, isBudgetDerivedLabel, readBudgetScenario } from "./scenario";
export type { BudgetKind, BudgetScenario, ReadScenario, ScenarioHints } from "./scenario";

export { amountIn, readBudgetSides, tagIn } from "./rows";
export type { BudgetAmount, BudgetExcludedRow, BudgetSideLine, BudgetSides } from "./rows";

export {
  BUDGET_CANDIDATE_MAX,
  BUDGET_EMBED_MAX_SCORE,
  BUDGET_EMBED_MIN_COSINE,
  BUDGET_MATCH_MIN_MARGIN,
  BUDGET_MATCH_MIN_SCORE,
  budgetKindsAgree,
  calibrateEmbedScore,
  rankBudgetCandidates,
  scoreBudgetPair,
} from "./candidates";
export type { BudgetCandidate, BudgetSimilarity } from "./candidates";

export { applyConfirmedPairs, proposeBudgetPairs } from "./match";
export type { BudgetPairProposal, BudgetPairing, BudgetProposeOptions } from "./match";

export {
  DEFAULT_BUDGET_THRESHOLDS,
  budgetAggregates,
  budgetFlagCounts,
  budgetSlug,
  budgetVarianceLines,
  varianceCell,
} from "./variance";
export type {
  BudgetAggregate,
  BudgetAggregateId,
  BudgetDirection,
  BudgetThresholds,
  BudgetVarianceCell,
  BudgetVarianceLine,
} from "./variance";

export {
  budgetAggregate,
  budgetCurrency,
  budgetInputSchema,
  budgetParamsSchema,
  computeBudget,
  flaggedBudgetLines,
} from "./compute";
export type { BudgetComputed, BudgetParams, BudgetTaskInput } from "./compute";

export {
  BUDGET_PERCENT_DECIMALS,
  formatBudgetAmount,
  formatBudgetMagnitude,
  formatBudgetPercent,
} from "./format";

export { budgetAggregateName, budgetDirectionWord, budgetStageWord, budgetThresholdSentence, budgetWord } from "./text";
export type { BudgetWord } from "./text";

export { BUDGET_CALC_COLUMNS, BUDGET_CHART_ROW_MAX, budgetTables } from "./tables";
export { budgetReport } from "./report";
export { BUDGET_FACT_LINE_MAX, budgetAllowedNumbers, budgetPromptFacts } from "./facts";
