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
export { US_MARKET_TIMEZONE, WEEKEND_NOTE, WIB_TIMEZONE, marketClock } from "./market-clock";
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
