/**
 * Test fixtures for Market Watch v2. Not exported from the package barrel.
 */
import type {
  CryptoGlobal,
  GlobalNewsItem,
  MarketSession,
  MarketSignal,
  MarketWatchPacket,
  MetalsContext,
  RotationRow,
  PriceBar,
  PriceHistory,
  Quote,
  Technical,
  TickerPacket,
  TickerCrypto,
  TickerFundamentals,
  TickerInsiders,
  TickerSentiment,
  WatchNewsItem,
  WatchRef,
} from "./watch-schemas";

export const FIXTURE_NOW = "2026-09-09T13:25:00.000Z";

export function makeRef(source: WatchRef["source"] = "yahoo", url = "https://finance.yahoo.com/quote/MU"): WatchRef {
  return { source, sourceUrl: url, observedAt: FIXTURE_NOW };
}

const DAY_MS = 86_400_000;

/** `count` daily bars ending 2026-09-09, closes = start + index (a ramp) unless a `close` function is given. */
export function makeBars(count: number, close: (index: number) => number = (index) => 100 + index): PriceBar[] {
  const end = Date.parse("2026-09-09T00:00:00Z");
  return Array.from({ length: count }, (_, index) => {
    const value = close(index);
    const date = new Date(end - (count - 1 - index) * DAY_MS).toISOString().slice(0, 10);
    return { date, open: value, high: value + 1, low: value - 1, close: value, volume: 1000 + index };
  });
}

export function makeHistory(symbol: string, count: number, close?: (index: number) => number): PriceHistory {
  return { symbol, interval: "1d", bars: makeBars(count, close), ref: makeRef("yahoo") };
}

export function makeQuote(symbol: string, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    name: `${symbol} Inc`,
    price: 886.26,
    changePercent: -1.2,
    previousClose: 897.02,
    preMarketPrice: 890.5,
    preMarketChangePercent: 0.48,
    postMarketPrice: null,
    postMarketChangePercent: null,
    volume: 12_345_678,
    marketCap: 9.9e11,
    marketState: "PRE",
    currency: "USD",
    exchange: "NMS",
    ref: makeRef("yahoo"),
    ...overrides,
  };
}

export function makeTechnical(symbol: string, overrides: Partial<Technical> = {}): Technical {
  return {
    symbol,
    tradingview: { summary: 0.56, movingAverages: 0.8, oscillators: 0.2, label: "STRONG_BUY" },
    rsi14: 71.3,
    sma50: 800.12,
    sma200: 650.4,
    ema200: 660.7,
    macd: 12.3,
    macdSignal: 10.1,
    change1dPercent: -1.2,
    change5dPercent: 3.05,
    change1mPercent: 8.4,
    high52w: 905.5,
    low52w: 401.2,
    ref: makeRef("computed"),
    ...overrides,
  };
}

export function makeNews(title: string, publisher = "Reuters", link = "https://example.test/news/1"): WatchNewsItem {
  return {
    title,
    summary: "",
    link,
    publisher,
    publishedAt: "2026-09-09T10:00:00.000Z",
    ref: makeRef("rss", link),
    injectionSuspect: false,
  };
}

export function makeTickerPacket(yahoo: string, overrides: Partial<TickerPacket> = {}): TickerPacket {
  const base = yahoo.replace(/\.JK$/, "");
  return {
    symbol: {
      input: base,
      yahoo,
      tradingview: yahoo.endsWith(".JK") ? `IDX:${base}` : `NASDAQ:${base}`,
      name: `${base} Inc`,
      exchange: yahoo.endsWith(".JK") ? "JKT" : "NMS",
      currency: yahoo.endsWith(".JK") ? "IDR" : "USD",
    },
    quote: makeQuote(yahoo),
    technical: makeTechnical(yahoo),
    history: makeHistory(yahoo, 60),
    chart: {
      type: "line",
      title: `${yahoo} close`,
      x: { label: "date", values: ["2026-09-08", "2026-09-09"] },
      series: [{ name: "close", values: [897.02, 886.26] }],
    },
    news: [makeNews(`${base} beats estimates`, "Reuters", `https://example.test/${base}/1`)],
    failures: [],
    ...overrides,
  };
}

export function makePacket(overrides: Partial<MarketWatchPacket> = {}): MarketWatchPacket {
  return {
    tickers: [
      makeTickerPacket("MU"),
      makeTickerPacket("INTC", {
        news: [makeNews("INTC foundry update", "Bloomberg", "https://example.test/INTC/1")],
      }),
      makeTickerPacket("BBCA.JK", { technical: null, news: [] }),
    ],
    macro: {
      quotes: [
        {
          ...makeQuote("ES=F", { price: 6501.25, changePercent: 0.31, marketState: "REGULAR" }),
          label: "S&P 500 futures",
        },
        { ...makeQuote("^VIX", { price: 14.85, changePercent: -2.1, marketState: "CLOSED" }), label: "VIX" },
      ],
      failures: [],
    },
    clock: { runAt: FIXTURE_NOW, usSession: "pre", note: "Run at 20:25 WIB = 09:25 ET, U.S. pre-market." },
    positionContext: "MU: avg cost $886.26, target $1,000. INTC: 200 shares at 31.5.",
    ...overrides,
  };
}

export function makeCrypto(overrides: Partial<TickerCrypto> = {}): TickerCrypto {
  return {
    marketCapUsd: 1_284_000_000_000,
    volume24hUsd: 34_500_000_000,
    change7dPct: -4.25,
    dominancePct: 54.12,
    fundingRatePct: 0.0112,
    source: "web",
    observedAt: FIXTURE_NOW,
    ...overrides,
  };
}

export function makeFundamentals(overrides: Partial<TickerFundamentals> = {}): TickerFundamentals {
  return {
    sector: "Technology",
    industry: "Semiconductors",
    marketCap: 9.9e11,
    trailingPe: 24.53,
    forwardPe: 18.21,
    peg: 1.34,
    priceToBook: 3.47,
    epsTrailing: 8.11,
    epsForward: 12.44,
    dividendYieldPct: 0.45,
    beta: 1.32,
    revenueTtm: 37_100_000_000,
    grossMarginPct: 45.21,
    operatingMarginPct: 30.13,
    profitMarginPct: 25.37,
    roePct: 28.44,
    roaPct: 15.12,
    debtToEquity: 31.8,
    currentRatio: 2.41,
    freeCashflow: 4_260_000_000,
    source: "yahoo",
    observedAt: FIXTURE_NOW,
    ...overrides,
  };
}

export function makeInsiders(overrides: Partial<TickerInsiders> = {}): TickerInsiders {
  return {
    window: "90d",
    buys: 3,
    sells: 7,
    netShares: -128_400,
    source: "yahoo",
    observedAt: FIXTURE_NOW,
    ...overrides,
  };
}

export function makeSentiment(overrides: Partial<TickerSentiment> = {}): TickerSentiment {
  return {
    stocktwits: { total: 184, bullish: 121, bearish: 39, sampled: 3 },
    reddit: { posts: 17, subreddits: ["wallstreetbets", "stocks"] },
    samples: [
      { source: "stocktwits", title: "Volume looks heavy into the close", at: "2026-09-09T12:40:00.000Z" },
      { source: "reddit", title: "Foundry update thread", at: "2026-09-09T11:05:00.000Z" },
    ],
    observedAt: FIXTURE_NOW,
    ...overrides,
  };
}

export const FIXTURE_GLOBAL_NEWS: readonly GlobalNewsItem[] = [
  {
    title: "Fed holds its policy rate at 4.25% and points to a slower path",
    publisher: "Reuters",
    at: "2026-09-09T09:00:00.000Z",
    query: "Federal Reserve interest rate decision",
  },
  {
    title: "Oil steadies as supply talks drag on",
    publisher: "Bloomberg",
    at: "2026-09-09T08:10:00.000Z",
    query: "oil price energy markets",
  },
];

export const FIXTURE_CRYPTO_GLOBAL: CryptoGlobal = {
  totalMarketCapUsd: 3_912_000_000_000,
  btcDominancePct: 54.12,
  ethDominancePct: 13.24,
  source: "web",
  observedAt: FIXTURE_NOW,
};

export const FIXTURE_METALS: MetalsContext = {
  dxy: 97.41,
  us10y: 4.126,
  goldSilverRatio: 82.53,
  goldFuturesVsSpotPct: 0.34,
  source: "computed",
  observedAt: FIXTURE_NOW,
};

export const FIXTURE_SIGNALS: readonly MarketSignal[] = [
  { ticker: "MU", kind: "rsi-overbought", value: 71.3, note: "RSI14 sits in the overbought band" },
  { ticker: "INTC", kind: "52w-low", value: 401.2, note: "close sits within a hair of the 52-week low" },
];

export const FIXTURE_ROTATION: readonly RotationRow[] = [
  { ticker: "MU", ret1dPct: -1.2, ret5dPct: 3.05, ret1mPct: 8.42, ret6mPct: 41.7, rank1m: 1 },
  { ticker: "INTC", ret1dPct: 0.4, ret5dPct: -2.11, ret1mPct: -6.38, ret6mPct: null, rank1m: 2 },
];

export const FIXTURE_SESSIONS: readonly MarketSession[] = [
  { exchange: "IDX", state: "closed", nextChangeAt: "2026-09-10T02:00:00.000Z" },
  { exchange: "NYSE", state: "pre", nextChangeAt: "2026-09-09T13:30:00.000Z" },
  { exchange: "CRYPTO", state: "always", nextChangeAt: null },
];

/** A packet carrying every harness section at once. Used to prove no section is left out of the guard. */
export function makeFullPacket(overrides: Partial<MarketWatchPacket> = {}): MarketWatchPacket {
  const base = makePacket();
  return {
    ...base,
    tickers: base.tickers.map((ticker, index) =>
      index === 0
        ? {
            ...ticker,
            crypto: makeCrypto(),
            fundamentals: makeFundamentals(),
            insiders: makeInsiders(),
            sentiment: makeSentiment(),
            swings: [
              { date: "2026-08-01", price: 910.5, kind: "high" as const },
              { date: "2026-08-20", price: 700.25, kind: "low" as const },
            ],
          }
        : ticker,
    ),
    cryptoGlobal: FIXTURE_CRYPTO_GLOBAL,
    metals: FIXTURE_METALS,
    signals: [...FIXTURE_SIGNALS],
    rotation: [...FIXTURE_ROTATION],
    sessions: [...FIXTURE_SESSIONS],
    globalNews: [...FIXTURE_GLOBAL_NEWS],
    ...overrides,
  };
}
