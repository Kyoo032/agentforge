/**
 * Test fixtures for Market Watch v2. Not exported from the package barrel.
 */
import type {
  MarketWatchPacket,
  PriceBar,
  PriceHistory,
  Quote,
  Technical,
  TickerPacket,
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
