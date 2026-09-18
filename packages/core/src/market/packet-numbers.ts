/**
 * The allowed-number set for the Market number guard.
 *
 * Every figure the model may write has to be traceable: a packet figure (with
 * its rounded presentations, so "886.26" and "886" both verify), a figure
 * quoted inside a headline the model actually saw, or a figure from the
 * reader's own position context. Anything else is replaced with the unverified
 * marker downstream.
 *
 * Whenever a harness section grows a numeric field, it must be listed here or
 * the model will be punished for repeating a number code handed it —
 * `briefing-prompt.test.ts` asserts that over a packet carrying every section.
 */
import { type NumberToken, extractNumbers } from "../finance/number-guard";
import { presentationValues } from "./prompt-format";
import { INSIDER_WINDOW_DAYS } from "./watch-schemas";
import type {
  MarketWatchPacket,
  Quote,
  Technical,
  TickerCrypto,
  TickerFundamentals,
  TickerInsiders,
  TickerSentiment,
} from "./watch-schemas";

const QUOTE_FIELDS = [
  "price",
  "changePercent",
  "previousClose",
  "preMarketPrice",
  "preMarketChangePercent",
  "postMarketPrice",
  "postMarketChangePercent",
  "volume",
  "marketCap",
] as const;

const TECHNICAL_FIELDS = [
  "rsi14",
  "sma50",
  "sma200",
  "ema200",
  "macd",
  "macdSignal",
  "change1dPercent",
  "change5dPercent",
  "change1mPercent",
  "high52w",
  "low52w",
] as const;

const RATING_FIELDS = ["summary", "movingAverages", "oscillators"] as const;

const CRYPTO_FIELDS = ["marketCapUsd", "volume24hUsd", "change7dPct", "dominancePct", "fundingRatePct"] as const;

const CRYPTO_GLOBAL_FIELDS = ["totalMarketCapUsd", "btcDominancePct", "ethDominancePct"] as const;

const METALS_FIELDS = ["dxy", "us10y", "goldSilverRatio", "goldFuturesVsSpotPct", "goldFuturesVsGldPct"] as const;

const ROTATION_FIELDS = ["ret1dPct", "ret5dPct", "ret1mPct", "ret6mPct", "rank1m"] as const;

/** Every numeric field of `tickerFundamentalsSchema`; `sector` and `industry` are the only text ones. */
const FUNDAMENTALS_FIELDS = [
  "marketCap",
  "trailingPe",
  "forwardPe",
  "peg",
  "priceToBook",
  "epsTrailing",
  "epsForward",
  "dividendYieldPct",
  "beta",
  "revenueTtm",
  "grossMarginPct",
  "operatingMarginPct",
  "profitMarginPct",
  "roePct",
  "roaPct",
  "debtToEquity",
  "currentRatio",
  "freeCashflow",
] as const;

const INSIDER_FIELDS = ["buys", "sells", "netShares"] as const;

const STOCKTWITS_FIELDS = ["total", "bullish", "bearish", "sampled"] as const;

type Figure = number | null | undefined;

function quoteNumbers(quote: Quote | null): Figure[] {
  return quote === null ? [] : QUOTE_FIELDS.map((field) => quote[field]);
}

function technicalNumbers(technical: Technical | null): Figure[] {
  if (technical === null) {
    return [];
  }
  const rating = technical.tradingview;
  return [
    ...TECHNICAL_FIELDS.map((field) => technical[field]),
    ...(rating === null ? [] : RATING_FIELDS.map((field) => rating[field])),
  ];
}

function cryptoNumbers(crypto: TickerCrypto | undefined): Figure[] {
  return crypto === undefined ? [] : CRYPTO_FIELDS.map((field) => crypto[field]);
}

function fundamentalsFigures(fundamentals: TickerFundamentals | undefined): Figure[] {
  return fundamentals === undefined ? [] : FUNDAMENTALS_FIELDS.map((field) => fundamentals[field]);
}

/** The counts plus the window they were counted over, so "the last 90 days" verifies. */
function insiderFigures(insiders: TickerInsiders | undefined): Figure[] {
  return insiders === undefined ? [] : [...INSIDER_FIELDS.map((field) => insiders[field]), INSIDER_WINDOW_DAYS];
}

/**
 * The crowd counts only. A figure shouted inside a sampled post is not packet
 * data — it is one anonymous poster's number — so it is deliberately left out
 * of the allowed set and the guard marks it if a desk repeats it as fact.
 */
function sentimentFigures(sentiment: TickerSentiment | undefined): Figure[] {
  if (sentiment === undefined) {
    return [];
  }
  const stocktwits = sentiment.stocktwits;
  return [
    ...(stocktwits === undefined ? [] : STOCKTWITS_FIELDS.map((field) => stocktwits[field])),
    ...(sentiment.reddit === undefined ? [] : [sentiment.reddit.posts]),
  ];
}

function isFigure(value: Figure): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Both readings of an ambiguous "1.000" in the user's own text (1,000 or 1.0). */
function contextReadings(token: NumberToken): number[] {
  return token.alternate === undefined ? [token.value] : [token.value, token.alternate];
}

/** Figures quoted inside the headlines the model saw (analyst targets, deal sizes). Attributed, so allowed. */
function headlineNumbers(packet: MarketWatchPacket): number[] {
  const text = [
    ...packet.tickers.flatMap((t) => t.news.filter((n) => !n.injectionSuspect).map((n) => `${n.title} ${n.summary}`)),
    ...(packet.globalNews ?? []).map((item) => item.title),
  ].join("\n");
  return extractNumbers(text).flatMap(contextReadings).filter(isFigure);
}

/** Every numeric field of the harness sections the host may have computed. */
function harnessNumbers(packet: MarketWatchPacket): Figure[] {
  const global = packet.cryptoGlobal;
  const metals = packet.metals;
  return [
    ...(global === undefined ? [] : CRYPTO_GLOBAL_FIELDS.map((field) => global[field])),
    ...(metals === undefined ? [] : METALS_FIELDS.map((field) => metals[field])),
    ...(packet.signals ?? []).map((signal) => signal.value),
    ...(packet.rotation ?? []).flatMap((rotation) => ROTATION_FIELDS.map((field) => rotation[field])),
  ];
}

/**
 * Every figure the model may write: packet quotes, technicals, swings, macro
 * and the computed harness sections (each with its rounded presentations, see
 * `presentationValues`), the figures inside the headlines it saw, and the
 * numbers in the reader's position context.
 */
export function packetNumbers(packet: MarketWatchPacket, positionContext: string): number[] {
  const raw = [
    ...packet.tickers.flatMap((t) => [
      ...quoteNumbers(t.quote),
      ...technicalNumbers(t.technical),
      ...cryptoNumbers(t.crypto),
      ...fundamentalsFigures(t.fundamentals),
      ...insiderFigures(t.insiders),
      ...sentimentFigures(t.sentiment),
      ...(t.swings ?? []).map((swing) => swing.price),
    ]),
    ...packet.macro.quotes.flatMap(quoteNumbers),
    ...harnessNumbers(packet),
  ].filter(isFigure);
  const context = extractNumbers(positionContext).flatMap(contextReadings).filter(isFigure);
  return [...new Set([...raw.flatMap(presentationValues), ...context, ...headlineNumbers(packet)])];
}
