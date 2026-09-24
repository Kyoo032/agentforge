/**
 * Market Watch v2 contract: any tickers from any market, several at once, a
 * chart per ticker, quotes + technical ratings + news + macro, and a briefing
 * the model writes over that packet in the language the user asks for.
 *
 * Rules that still hold: every number the model may use comes from this packet
 * or from the user's own position context; every packet row is attributed;
 * the disclaimer is stamped by code; the model may rank and read sentiment but
 * may not issue an imperative directive (see advice-guard).
 */
import { z } from "zod";
import { dataChartSchema } from "../artifacts/data-analysis";
import { httpUrlSchema } from "./schemas";
import { DEFAULT_MARKET_SPECIALIST, MARKET_SPECIALISTS } from "./specialist-ids";
import { DEFAULT_MARKET_DEPTH, MARKET_DEPTHS } from "./team";
import { attribution, watchRefSchema } from "./watch-refs";
import {
  GLOBAL_NEWS_MAX,
  globalNewsItemSchema,
  tickerFundamentalsSchema,
  tickerInsidersSchema,
  tickerSentimentSchema,
} from "./team-source-schemas";

/* The attribution primitives and the analyst-team sections keep their own
 * files; this module stays the one import path for the whole packet. */
export * from "./watch-refs";
export * from "./team-source-schemas";

export const WATCHLIST_MAX = 15;
export const NEWS_PER_TICKER_MAX = 8;
export const HISTORY_BARS_MAX = 800;
export const BRIEFING_SECTIONS_MAX = 12;
export const BRIEFING_SOURCES_MAX = 200;
/** Pivot highs/lows kept per ticker for the Elliott Wave agent to cite. */
export const SWING_POINTS_MAX = 12;
/** Signal groups one ticker can land in at once (RSI, MACD, SMA50, SMA200, 52-week, unusual move). */
export const SIGNAL_KINDS_MAX = 6;
/** Hard cap on the computed signals table: every watchlist entry in every group. */
export const SIGNALS_MAX = WATCHLIST_MAX * SIGNAL_KINDS_MAX;
/** The note beside a signal is a phrase, not a paragraph. */
export const SIGNAL_NOTE_MAX = 120;
/** One rotation row per watchlist entry. */
export const ROTATION_MAX = WATCHLIST_MAX;

export const MARKET_STATES = ["PRE", "REGULAR", "POST", "CLOSED", "UNKNOWN"] as const;
export type MarketState = (typeof MARKET_STATES)[number];

/** One resolved watchlist entry. `yahoo` is canonical; `tradingview` is "EXCHANGE:SYMBOL" or null. */
export const resolvedSymbolSchema = z.object({
  input: z.string().min(1),
  yahoo: z.string().min(1),
  tradingview: z.string().nullable().default(null),
  name: z.string().default(""),
  exchange: z.string().default(""),
  currency: z.string().default(""),
});
export type ResolvedSymbol = z.infer<typeof resolvedSymbolSchema>;

export const quoteSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().default(""),
  price: z.number().nullable().default(null),
  changePercent: z.number().nullable().default(null),
  previousClose: z.number().nullable().default(null),
  preMarketPrice: z.number().nullable().default(null),
  preMarketChangePercent: z.number().nullable().default(null),
  postMarketPrice: z.number().nullable().default(null),
  postMarketChangePercent: z.number().nullable().default(null),
  volume: z.number().nullable().default(null),
  marketCap: z.number().nullable().default(null),
  marketState: z.enum(MARKET_STATES).default("UNKNOWN"),
  currency: z.string().default(""),
  exchange: z.string().default(""),
  ref: watchRefSchema,
});
export type Quote = z.infer<typeof quoteSchema>;

/** Quoted TradingView technical rating. Labels are the vendor's own words (STRONG_BUY … STRONG_SELL). */
export const tradingViewRatingSchema = z.object({
  summary: z.number().min(-1).max(1).nullable().default(null),
  movingAverages: z.number().min(-1).max(1).nullable().default(null),
  oscillators: z.number().min(-1).max(1).nullable().default(null),
  label: z.string().default(""),
});
export type TradingViewRating = z.infer<typeof tradingViewRatingSchema>;

export const technicalSchema = z.object({
  symbol: z.string().min(1),
  tradingview: tradingViewRatingSchema.nullable().default(null),
  rsi14: z.number().nullable().default(null),
  sma50: z.number().nullable().default(null),
  sma200: z.number().nullable().default(null),
  ema200: z.number().nullable().default(null),
  macd: z.number().nullable().default(null),
  macdSignal: z.number().nullable().default(null),
  change1dPercent: z.number().nullable().default(null),
  change5dPercent: z.number().nullable().default(null),
  change1mPercent: z.number().nullable().default(null),
  high52w: z.number().nullable().default(null),
  low52w: z.number().nullable().default(null),
  ref: watchRefSchema,
});
export type Technical = z.infer<typeof technicalSchema>;

export const watchNewsItemSchema = z.object({
  title: z.string().min(1),
  summary: z.string().max(400).default(""),
  link: httpUrlSchema,
  publisher: z.string().default(""),
  publishedAt: z.string().datetime({ offset: true }).nullable().default(null),
  ref: watchRefSchema,
  injectionSuspect: z.boolean().default(false),
});
export type WatchNewsItem = z.infer<typeof watchNewsItemSchema>;

export const priceHistorySchema = z.object({
  symbol: z.string().min(1),
  interval: z.enum(["1d", "1wk"]).default("1d"),
  bars: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        open: z.number(),
        high: z.number(),
        low: z.number(),
        close: z.number(),
        volume: z.number().nonnegative(),
      }),
    )
    .max(HISTORY_BARS_MAX),
  ref: watchRefSchema,
});
export type PriceHistory = z.infer<typeof priceHistorySchema>;
/** One daily/weekly bar of a PriceHistory (YYYY-MM-DD in exchange local time). */
export type PriceBar = PriceHistory["bars"][number];

/**
 * One pivot high or low computed from the daily bars (see `swings.ts`). It
 * exists so the Elliott Wave agent has dated, citable levels instead of
 * eyeballing a chart; `price` is the bar's own high (or low), never a guess.
 */
export const swingPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  price: z.number(),
  kind: z.enum(["high", "low"]),
});
export type SwingPoint = z.infer<typeof swingPointSchema>;

/**
 * Crypto-native figures for one coin, fetched by the host (CoinGecko, plus a
 * public perp funding rate when the venue answers). Every figure is optional:
 * a missing field is a field the provider did not give, never a guess.
 */
export const tickerCryptoSchema = z.object({
  marketCapUsd: z.number().optional(),
  volume24hUsd: z.number().optional(),
  change7dPct: z.number().optional(),
  /** Share of total crypto market cap. Only meaningful for BTC and ETH. */
  dominancePct: z.number().optional(),
  /** Perpetual funding rate in percent, when a keyless venue reports one. */
  fundingRatePct: z.number().optional(),
  ...attribution,
});
export type TickerCrypto = z.infer<typeof tickerCryptoSchema>;

/** Everything fetched for one watchlist entry. Null sections mean "not available"; `failures` says why. */
export const tickerPacketSchema = z.object({
  symbol: resolvedSymbolSchema,
  quote: quoteSchema.nullable().default(null),
  technical: technicalSchema.nullable().default(null),
  history: priceHistorySchema.nullable().default(null),
  chart: dataChartSchema.nullable().default(null),
  news: z.array(watchNewsItemSchema).max(NEWS_PER_TICKER_MAX).default([]),
  /** Pivot highs/lows from the daily bars. Absent when the host did not compute them. */
  swings: z.array(swingPointSchema).max(SWING_POINTS_MAX).optional(),
  /** Crypto-native figures. Absent for anything that is not a coin. */
  crypto: tickerCryptoSchema.optional(),
  /** Reported company figures. Absent unless the desk's harness asks for them. */
  fundamentals: tickerFundamentalsSchema.optional(),
  /** Insider transaction counts over the fixed window. Absent where the venue files none. */
  insiders: tickerInsidersSchema.optional(),
  /** The crowd read from the public social venues. */
  sentiment: tickerSentimentSchema.optional(),
  failures: z.array(z.string()).default([]),
});
export type TickerPacket = z.infer<typeof tickerPacketSchema>;

export const MACRO_SYMBOLS = [
  { symbol: "ES=F", label: "S&P 500 futures" },
  { symbol: "NQ=F", label: "Nasdaq 100 futures" },
  { symbol: "YM=F", label: "Dow futures" },
  { symbol: "RTY=F", label: "Russell 2000 futures" },
  { symbol: "^VIX", label: "VIX" },
  { symbol: "^TNX", label: "US 10Y yield" },
  { symbol: "CL=F", label: "WTI crude" },
  { symbol: "DX-Y.NYB", label: "US dollar index" },
  { symbol: "^JKSE", label: "IHSG" },
  { symbol: "IDR=X", label: "USD/IDR" },
] as const;

export const macroSnapshotSchema = z.object({
  quotes: z.array(quoteSchema.extend({ label: z.string().default("") })).default([]),
  failures: z.array(z.string()).default([]),
});
export type MacroSnapshot = z.infer<typeof macroSnapshotSchema>;

/** What the host knows about the clock when the briefing ran. Stops a late run posing as pre-market. */
export const marketClockSchema = z.object({
  runAt: z.string().datetime({ offset: true }),
  usSession: z.enum(["pre", "regular", "post", "closed"]),
  note: z.string().default(""),
});
export type MarketClock = z.infer<typeof marketClockSchema>;

/** Whole-market crypto context, so the crypto desk reads a coin against the asset class. */
export const cryptoGlobalSchema = z.object({
  totalMarketCapUsd: z.number(),
  btcDominancePct: z.number(),
  ethDominancePct: z.number(),
  ...attribution,
});
export type CryptoGlobal = z.infer<typeof cryptoGlobalSchema>;

/**
 * The metals desk's cross-market context, derived by the host from quotes it
 * already fetched (no extra network). Each figure is optional because the
 * derivation needs both legs and the packet may carry only one.
 */
export const metalsContextSchema = z.object({
  /** US dollar index level (DX-Y.NYB). */
  dxy: z.number().optional(),
  /** US 10-year yield (^TNX). */
  us10y: z.number().optional(),
  /** Gold divided by silver, both from the packet's own futures quotes. */
  goldSilverRatio: z.number().optional(),
  /** Futures premium or discount to spot gold (XAUUSD=X), in percent. */
  goldFuturesVsSpotPct: z.number().optional(),
  /**
   * Futures premium or discount to the GLD ETF proxy (ten shares ~ one ounce),
   * in percent. Named for what it actually is: GLD is an ETF share net of fees,
   * not spot, so this figure never stands in for `goldFuturesVsSpotPct`.
   */
  goldFuturesVsGldPct: z.number().optional(),
  ...attribution,
});
export type MetalsContext = z.infer<typeof metalsContextSchema>;

/**
 * The signal groups `signals.ts` computes. Named as observations of the chart
 * ("close crossed above its SMA50"), never as an instruction — the guard and
 * the C1 field lint both still apply, which is why the field below is `kind`.
 */
export const MARKET_SIGNAL_KINDS = [
  "rsi-oversold",
  "rsi-overbought",
  "macd-bull-cross",
  "macd-bear-cross",
  "sma50-break-up",
  "sma50-break-down",
  "sma200-break-up",
  "sma200-break-down",
  "52w-high",
  "52w-low",
  "unusual-move",
] as const;
export type MarketSignalKind = (typeof MARKET_SIGNAL_KINDS)[number];

/** One computed observation about one ticker. `value` is the packet figure behind it. */
export const marketSignalSchema = z.object({
  ticker: z.string().min(1),
  kind: z.enum(MARKET_SIGNAL_KINDS),
  value: z.number(),
  note: z.string().max(SIGNAL_NOTE_MAX).default(""),
});
export type MarketSignal = z.infer<typeof marketSignalSchema>;

/** Trailing returns for one ticker plus its 1-month rank. Null means the bars do not reach back that far. */
export const rotationRowSchema = z.object({
  ticker: z.string().min(1),
  ret1dPct: z.number().nullable().default(null),
  ret5dPct: z.number().nullable().default(null),
  ret1mPct: z.number().nullable().default(null),
  ret6mPct: z.number().nullable().default(null),
  /** 1-based, best 1-month return first. */
  rank1m: z.number().int().positive(),
});
export type RotationRow = z.infer<typeof rotationRowSchema>;

export const MARKET_EXCHANGES = ["IDX", "NYSE", "LSE", "TSE", "HKEX", "SGX", "CRYPTO"] as const;
export type MarketExchange = (typeof MARKET_EXCHANGES)[number];

export const SESSION_STATES = ["pre", "open", "post", "closed", "always"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** One row per exchange the watchlist touches. `nextChangeAt` is null for a market that never closes. */
export const marketSessionSchema = z.object({
  exchange: z.enum(MARKET_EXCHANGES),
  state: z.enum(SESSION_STATES),
  nextChangeAt: z.string().datetime({ offset: true }).nullable().default(null),
});
export type MarketSession = z.infer<typeof marketSessionSchema>;

export const marketWatchPacketSchema = z.object({
  tickers: z.array(tickerPacketSchema).max(WATCHLIST_MAX),
  macro: macroSnapshotSchema,
  clock: marketClockSchema,
  /** Whole-market crypto context. Absent unless the crypto desk asked for it. */
  cryptoGlobal: cryptoGlobalSchema.optional(),
  /** Dollar / yields / ratio context for the metals desk. */
  metals: metalsContextSchema.optional(),
  /** Code-computed chart observations (see `signals.ts`). */
  signals: z.array(marketSignalSchema).max(SIGNALS_MAX).optional(),
  /** Code-computed trailing-return ranking (see `rotation.ts`). */
  rotation: z.array(rotationRowSchema).max(ROTATION_MAX).optional(),
  /** Code-computed exchange clocks (see `sessions.ts`). */
  sessions: z.array(marketSessionSchema).max(MARKET_EXCHANGES.length).optional(),
  /** Macro headlines from the fixed global queries, deduped by the host. */
  globalNews: z.array(globalNewsItemSchema).max(GLOBAL_NEWS_MAX).optional(),
  /** Free text the user supplied (positions, targets, preferences). Its numbers are allowed in prose. */
  positionContext: z.string().max(4000).default(""),
});
export type MarketWatchPacket = z.infer<typeof marketWatchPacketSchema>;

/** Watchlist entries as typed in the studio, before resolution. */
export const tickerListSchema = z.array(z.string().min(1).max(20)).min(1).max(WATCHLIST_MAX);

/* Request from the studio. */
export const marketWatchRequestSchema = z.object({
  prompt: z.string().min(1).max(12_000),
  tickers: tickerListSchema,
  positionContext: z.string().max(4000).default(""),
  language: z.enum(["id", "en"]).default("id"),
  maxChars: z.number().int().min(1000).max(20_000).default(6000),
  /** Which named Market agent writes the briefing. Same pipeline, different rules. */
  specialist: z.enum(MARKET_SPECIALISTS).default(DEFAULT_MARKET_SPECIALIST),
  /**
   * How the briefing is written: `quick` is the single-pass narration that has
   * always shipped; `team` runs the analyst team (see `team.ts`) on the desks
   * whose harness names analysts. Quick stays the default.
   */
  depth: z.enum(MARKET_DEPTHS).default(DEFAULT_MARKET_DEPTH),
  model: z.string().optional(),
  /**
   * True only when the person picked `model` in the studio (`apps/web/lib/model-choice.ts`). The host
   * then never swaps it for a stand-in. Declared here because an undeclared key is stripped.
   */
  modelPinned: z.boolean().optional(),
});
export type MarketWatchRequest = z.infer<typeof marketWatchRequestSchema>;

/*
 * Watch board: the keyless view of a watchlist. Quotes, bars, technicals, and
 * a chart per ticker; no headlines, no macro, no model, no API key.
 */
export const marketBoardRequestSchema = z.object({ tickers: tickerListSchema });
export type MarketBoardRequest = z.infer<typeof marketBoardRequestSchema>;

export const marketBoardSchema = z.object({
  tickers: z.array(tickerPacketSchema).max(WATCHLIST_MAX),
  clock: marketClockSchema,
  /** Inputs that resolved to nothing, one note each. */
  failures: z.array(z.string()).default([]),
});
export type MarketBoard = z.infer<typeof marketBoardSchema>;
