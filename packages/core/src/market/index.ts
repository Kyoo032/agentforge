/* Market Watch v2 barrel. Host and web import from "@agentforge/core/market". */

export { FORBIDDEN_FIELD_NAMES, httpUrlSchema, isHttpUrl } from "./schemas";
export * from "./watch-schemas";
export {
  ADVICE_MARKER,
  ADVICE_PATTERN,
  AdviceLeakError,
  KEY_MARKER,
  NO_MASK,
  assertNoAdvice,
  formatPath,
  guardAdviceInText,
  iterStrings,
  scanForAdvice,
} from "./advice-guard";
export type { AdviceHit, GuardedText } from "./advice-guard";
export { isForbiddenFieldName, lintSchemaFields } from "./schema-lint";
export { INSUFFICIENT_AGE_MULTIPLIER, TTL_SECONDS, ageSeconds, computeStaleness, isInsufficient } from "./staleness";
export type { Staleness, TtlKind } from "./staleness";
export { MARKET_DISCLAIMER, MARKET_DISCLAIMER_EN, MARKET_DISCLAIMER_ID, withDisclaimer } from "./disclaimer";
export {
  MACD_FAST_PERIOD,
  MACD_SIGNAL_PERIOD,
  MACD_SLOW_PERIOD,
  RSI_DEFAULT_PERIOD,
  barsAscending,
  closesAscending,
  ema,
  emaSeries,
  latestClose,
  macd,
  rsi,
  sma,
  smaSeries,
} from "./indicators";
export type { MacdResult } from "./indicators";
export {
  CHANGE_1M_BARS,
  CHANGE_5D_BARS,
  EMA_LONG_PERIOD,
  MIN_52W_BARS,
  RSI_PERIOD,
  SMA_LONG_PERIOD,
  SMA_SHORT_PERIOD,
  WEEK_52_DAYS,
  computeTechnical,
} from "./technicals";
export {
  TICKER_PATTERN,
  TV_BUY_MIN,
  TV_NEUTRAL_MIN,
  TV_SELL_MIN,
  TV_STRONG_BUY_MIN,
  isNonEquitySymbol,
  isValidTicker,
  normalizeTickerInput,
  partitionTickerInput,
  toTradingViewSymbol,
  toYahooSymbol,
  tradingViewLabel,
  tradingViewMarket,
} from "./symbols";
export { US_MARKET_TIMEZONE, WEEKEND_NOTE, WIB_TIMEZONE, marketClock, zonedTime } from "./market-clock";
export type { ZonedTime } from "./market-clock";
export {
  HISTORY_MONTHS_ALLOWED,
  MARKET_HARNESS,
  MARKET_SOURCES,
  MARKET_TOOL_KEYS,
  harnessFor,
} from "./harness";
export type { HistoryMonths, MarketHarnessSpec, MarketSource, MarketToolKey } from "./harness";
export {
  ANALYST_KEY_POINTS_MAX,
  ANALYST_KEY_POINT_CHARS_MAX,
  ANALYST_SUMMARY_MAX,
  ANALYST_UNAVAILABLE,
  CONFIDENCE_LEVELS,
  DEBATE_POINTS_MAX,
  DEBATE_REBUTTALS_MAX,
  DEBATE_STANCES,
  DEBATE_THESIS_MAX,
  DEFAULT_MARKET_DEPTH,
  MARKET_ANALYSTS,
  MARKET_DEPTHS,
  RISK_KEY_RISKS_MAX,
  RISK_LENSES,
  RISK_NOTE_MAX,
  RISK_VIEW_MAX,
  TEAM_MAX_CALLS,
  TEAM_ROUNDS,
  analystNoteSchema,
  analystsFor,
  debateSideSchema,
  riskLensSchema,
  riskReadSchema,
  teamAvailable,
  teamNotesSchema,
  unavailableAnalystNote,
} from "./team";
export type {
  AnalystNote,
  ConfidenceLevel,
  DebateSide,
  DebateStance,
  MarketAnalyst,
  MarketDepth,
  RiskLens,
  RiskLensName,
  RiskRead,
  TeamNotes,
} from "./team";
export {
  TEAM_SECTION_KEYS,
  analystPacketOrder,
  analystSections,
  analystSystemPrompt,
  bearPrompt,
  bullPrompt,
  riskPrompt,
  synthesisPrompt,
  teamSectionHeadings,
} from "./team-prompts";
export type { TeamLanguage, TeamSectionKey } from "./team-prompts";
export {
  GLOBAL_NEWS_QUERIES,
  GLOBAL_NEWS_QUERY_COUNT,
  GLOBAL_NEWS_QUERY_KEYS,
  globalNewsQueries,
  globalNewsQuery,
} from "./global-news-queries";
export type { GlobalNewsLanguage, GlobalNewsQuery, GlobalNewsQueryKey } from "./global-news-queries";
export {
  CROSS_LOOKBACK_BARS,
  RANGE_PROXIMITY_PCT,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  UNUSUAL_MOVE_MULTIPLE,
  UNUSUAL_MOVE_WINDOW_BARS,
  computeSignals,
} from "./signals";
export {
  MIN_ROTATION_BARS,
  RET_1D_DAYS,
  RET_1M_DAYS,
  RET_5D_DAYS,
  RET_6M_DAYS,
  computeRotation,
} from "./rotation";
export { NEXT_CHANGE_HORIZON_DAYS, computeSessions, exchangeForTicker, sessionFor } from "./sessions";
export {
  CHART_BARS_DEFAULT,
  CHART_RANGE_DEFAULT,
  CHART_RANGES,
  CHART_SMA_PERIODS,
  buildPriceChart,
  buildRangeChart,
  chartRange,
} from "./chart-builder";
export type { ChartRange, ChartRangeId, PriceChartOptions } from "./chart-builder";
export {
  DEFAULT_WATCH_PROMPT_EN,
  DEFAULT_WATCH_PROMPT_ID,
  POSITION_CONTEXT_HEADING,
  PROMPT_HEADLINES_MAX,
  buildWatchSystemPrompt,
  packetNumbers,
  packetToPromptBlock,
} from "./briefing-prompt";
export type { WatchSystemPromptInput } from "./briefing-prompt";
export {
  DEFAULT_MARKET_SPECIALIST,
  MARKET_SPECIALISTS,
  MARKET_SPECIALIST_META,
  defaultWatchPrompt,
  isMarketSpecialist,
  specialistSystemRules,
} from "./specialists";
export type { LocalizedText, MarketFocus, MarketSpecialist, MarketSpecialistMeta } from "./specialists";
export { SWING_LOOKBACK_DEFAULT, swingPoints } from "./swings";
export {
  PERCENT_DECIMALS,
  PRICE_DECIMALS,
  RSI_DECIMALS,
  SCORE_DECIMALS,
  WHOLE_UNIT_CURRENCIES,
  WHOLE_UNIT_MIN,
  formatFixed,
  formatPercent,
  formatPrice,
  presentationValues,
  priceDecimals,
} from "./prompt-format";
export {
  LQ45_TICKERS,
  LQ45_UNIVERSE,
  findConstituent,
  isKnownTicker,
  universeConstituentSchema,
  universeSchema,
} from "./universe";
export type { Universe, UniverseConstituent } from "./universe";
export { canonicalWatchTicker, lookupWatchTicker, suggestWatchlistTickers } from "./watchlist-suggest";
export type { WatchlistSuggestion } from "./watchlist-suggest";
