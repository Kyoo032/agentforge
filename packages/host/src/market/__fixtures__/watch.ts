/**
 * Handcrafted Market Watch v2 rows for host tests: a two-ticker packet (MU on
 * NASDAQ, BBCA on IDX) with quotes, technicals, six bars of history, a chart,
 * headlines, and a three-row macro snapshot. Values are plausible, not live.
 */
import type { DataChart } from "@agentforge/core/artifacts";
import type {
  MacroSnapshot,
  MarketClock,
  MarketWatchPacket,
  PriceHistory,
  Quote,
  ResolvedSymbol,
  Technical,
  TickerPacket,
  WatchNewsItem,
  WatchRef,
} from "@agentforge/core/market";

export const FIXTURE_NOW = new Date("2026-09-09T12:30:00.000Z");
export const FIXTURE_OBSERVED_AT = "2026-09-09T12:00:00.000Z";
export const FIXTURE_HEADLINE = "Micron raises fiscal Q1 guidance as HBM demand outpaces supply";
export const FIXTURE_NEWS_URL = "https://finance.yahoo.com/news/micron-raises-guidance-hbm-demand-120000123.html";

export function yahooRef(symbol: string, observedAt = FIXTURE_OBSERVED_AT): WatchRef {
  return { source: "yahoo", sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`, observedAt };
}

export function tradingViewRef(tvSymbol: string, observedAt = FIXTURE_OBSERVED_AT): WatchRef {
  return {
    source: "tradingview",
    sourceUrl: `https://www.tradingview.com/symbols/${tvSymbol.replace(":", "-")}/technicals/`,
    observedAt,
  };
}

export function computedRef(symbol: string, observedAt = FIXTURE_OBSERVED_AT): WatchRef {
  return { source: "computed", sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`, observedAt };
}

export function resolvedMu(): ResolvedSymbol {
  return {
    input: "MU",
    yahoo: "MU",
    tradingview: "NASDAQ:MU",
    name: "Micron Technology, Inc.",
    exchange: "NMS",
    currency: "USD",
  };
}

export function resolvedBbca(): ResolvedSymbol {
  return {
    input: "BBCA",
    yahoo: "BBCA.JK",
    tradingview: "IDX:BBCA",
    name: "Bank Central Asia Tbk",
    exchange: "JKT",
    currency: "IDR",
  };
}

export function quote(symbol: string, overrides: Partial<Quote> = {}): Quote {
  return {
    symbol,
    name: symbol === "MU" ? "Micron Technology, Inc." : symbol,
    price: 1000.26,
    changePercent: -1.6,
    previousClose: 1016.52,
    preMarketPrice: 1004.1,
    preMarketChangePercent: -1.22,
    postMarketPrice: null,
    postMarketChangePercent: null,
    volume: 26603800,
    marketCap: 1118000000000,
    marketState: "PRE",
    currency: "USD",
    exchange: "NMS",
    ref: yahooRef(symbol),
    ...overrides,
  };
}

export function history(
  symbol: string,
  closes: readonly number[] = [961.4, 968.2, 979.8, 985.3, 996.4, 1000.26],
): PriceHistory {
  return {
    symbol,
    interval: "1d",
    bars: closes.map((close, index) => ({
      date: new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10),
      open: close - 2,
      high: close + 3,
      low: close - 4,
      close,
      volume: 20_000_000 + index * 1_000_000,
    })),
    ref: yahooRef(symbol),
  };
}

export function technical(symbol: string, overrides: Partial<Technical> = {}): Technical {
  return {
    symbol,
    tradingview: { summary: 0.5575, movingAverages: 0.933, oscillators: 0.18, label: "Buy" },
    rsi14: 57.66,
    sma50: 902.4,
    sma200: 618.9,
    ema200: 671.7,
    macd: 21.4,
    macdSignal: 18.2,
    change1dPercent: -1.6,
    change5dPercent: 4.04,
    change1mPercent: 12.3,
    high52w: 1042.5,
    low52w: 402.1,
    ref: tradingViewRef("NASDAQ:MU"),
    ...overrides,
  };
}

export function chart(symbol: string, series: PriceHistory = history(symbol)): DataChart {
  return {
    type: "line",
    title: `${symbol} close`,
    x: { label: "date", values: series.bars.map((bar) => bar.date) },
    series: [{ name: "close", values: series.bars.map((bar) => bar.close) }],
  };
}

export function newsItem(overrides: Partial<WatchNewsItem> = {}): WatchNewsItem {
  return {
    title: FIXTURE_HEADLINE,
    summary: "",
    link: FIXTURE_NEWS_URL,
    publisher: "Reuters",
    publishedAt: "2026-09-09T01:15:00.000Z",
    ref: yahooRef("MU"),
    injectionSuspect: false,
    ...overrides,
  };
}

export function macroSnapshot(): MacroSnapshot {
  return {
    quotes: [
      {
        ...quote("ES=F", {
          name: "E-Mini S&P 500",
          price: 6612.25,
          changePercent: 0.31,
          previousClose: 6591.75,
          preMarketPrice: null,
          preMarketChangePercent: null,
          marketCap: null,
          exchange: "CME",
          marketState: "REGULAR",
        }),
        label: "S&P 500 futures",
      },
      {
        ...quote("^VIX", {
          name: "CBOE Volatility Index",
          price: 15.12,
          changePercent: -2.14,
          previousClose: 15.45,
          preMarketPrice: null,
          preMarketChangePercent: null,
          volume: null,
          marketCap: null,
          exchange: "CGI",
          marketState: "CLOSED",
        }),
        label: "VIX",
      },
      {
        ...quote("IDR=X", {
          name: "USD/IDR",
          price: 16420,
          changePercent: 0.12,
          previousClose: 16400,
          preMarketPrice: null,
          preMarketChangePercent: null,
          volume: null,
          marketCap: null,
          currency: "IDR",
          exchange: "CCY",
          marketState: "CLOSED",
        }),
        label: "USD/IDR",
      },
    ],
    failures: [],
  };
}

export function clock(overrides: Partial<MarketClock> = {}): MarketClock {
  return {
    runAt: FIXTURE_NOW.toISOString(),
    usSession: "pre",
    note: "US pre-market; regular session opens 13:30 UTC.",
    ...overrides,
  };
}

export function tickerMu(overrides: Partial<TickerPacket> = {}): TickerPacket {
  return {
    symbol: resolvedMu(),
    quote: quote("MU"),
    technical: technical("MU"),
    history: history("MU"),
    chart: chart("MU"),
    news: [newsItem()],
    failures: [],
    ...overrides,
  };
}

export function tickerBbca(overrides: Partial<TickerPacket> = {}): TickerPacket {
  const bars = history("BBCA.JK", [9500, 9550, 9525, 9600, 9580, 9650]);
  return {
    symbol: resolvedBbca(),
    quote: quote("BBCA.JK", {
      name: "Bank Central Asia Tbk",
      price: 9650,
      changePercent: 0.52,
      previousClose: 9600,
      preMarketPrice: null,
      preMarketChangePercent: null,
      volume: 84210500,
      marketCap: 1189000000000000,
      marketState: "CLOSED",
      currency: "IDR",
      exchange: "JKT",
    }),
    technical: technical("BBCA.JK", {
      tradingview: { summary: -0.1212, movingAverages: -0.2667, oscillators: 0.0714, label: "Neutral" },
      rsi14: 46.3,
      sma50: 9588.1,
      sma200: 9740.6,
      ema200: 9712.4,
      macd: -12.1,
      macdSignal: -8.4,
      change1dPercent: 0.52,
      change5dPercent: 1.58,
      change1mPercent: -2.1,
      high52w: 10725,
      low52w: 8200,
      ref: tradingViewRef("IDX:BBCA"),
    }),
    history: bars,
    chart: chart("BBCA.JK", bars),
    news: [],
    failures: ["news: no headlines returned"],
    ...overrides,
  };
}

export function packet(overrides: Partial<MarketWatchPacket> = {}): MarketWatchPacket {
  return {
    tickers: [tickerMu(), tickerBbca()],
    macro: macroSnapshot(),
    clock: clock(),
    positionContext: "",
    ...overrides,
  };
}
