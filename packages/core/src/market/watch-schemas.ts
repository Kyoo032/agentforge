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

export const WATCH_SOURCES = ["yahoo", "tradingview", "computed", "rss", "web"] as const;
export type WatchSource = (typeof WATCH_SOURCES)[number];

export const WATCHLIST_MAX = 15;
export const NEWS_PER_TICKER_MAX = 8;
export const HISTORY_BARS_MAX = 800;
export const BRIEFING_SECTIONS_MAX = 12;
export const BRIEFING_SOURCES_MAX = 200;

export const watchRefSchema = z.object({
  source: z.enum(WATCH_SOURCES),
  sourceUrl: httpUrlSchema,
  observedAt: z.string().datetime({ offset: true }),
});
export type WatchRef = z.infer<typeof watchRefSchema>;

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

/** Everything fetched for one watchlist entry. Null sections mean "not available"; `failures` says why. */
export const tickerPacketSchema = z.object({
  symbol: resolvedSymbolSchema,
  quote: quoteSchema.nullable().default(null),
  technical: technicalSchema.nullable().default(null),
  history: priceHistorySchema.nullable().default(null),
  chart: dataChartSchema.nullable().default(null),
  news: z.array(watchNewsItemSchema).max(NEWS_PER_TICKER_MAX).default([]),
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

export const marketWatchPacketSchema = z.object({
  tickers: z.array(tickerPacketSchema).max(WATCHLIST_MAX),
  macro: macroSnapshotSchema,
  clock: marketClockSchema,
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
  model: z.string().optional(),
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
