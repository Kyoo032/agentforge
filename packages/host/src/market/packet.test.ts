import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import {
  DEFAULT_MARKET_SPECIALIST,
  MACRO_SYMBOLS,
  harnessFor,
  swingPoints,
  type MarketWatchRequest,
} from "@agentforge/core/market";
import { ensureSchema } from "@agentforge/db/ensure-schema";
import chartFixture from "./__fixtures__/yahoo-chart-mu.json";
import quotesFixture from "./__fixtures__/yahoo-quotes.json";
import searchFixture from "./__fixtures__/yahoo-search-mu.json";
import summaryFixture from "./__fixtures__/yahoo-quote-summary-mu.json";
import streamFixture from "./__fixtures__/stocktwits-mu.json";
import { REDDIT_SEARCH_MU } from "./__fixtures__/reddit-search-mu";
import tvFixture from "./__fixtures__/tradingview-scan.json";
import { computedRef, history as historyFixture, technical as technicalFixture } from "./__fixtures__/watch";
import { buildMarketWatchPacket, mergeTechnical, type PacketPhase } from "./packet";
import { MACRO_CACHE_KEY, historyCacheKey, readCached } from "./repo";
import type { TradingViewIndicators } from "./tradingview";
import type { YahooClient } from "./yahoo";

const NOW = new Date("2026-09-09T12:30:00.000Z");
const now = () => NOW;
/** Reddit is read one subreddit at a time with a real gap; no test pays for it. */
const noDelay = async () => {};
const SAHAM_MONTHS = harnessFor(DEFAULT_MARKET_SPECIALIST).historyMonths;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type Fault = { quote?: Error; chart?: Error; search?: Error; quoteSummary?: Error; tradingview?: number };

function yahooClient(fault: Fault, log: string[]): YahooClient {
  return {
    async quote(symbols) {
      log.push(`quote:${symbols.join(",")}`);
      if (fault.quote) {
        throw fault.quote;
      }
      return clone(quotesFixture.rows).filter((row) => symbols.includes(row.symbol));
    },
    async chart(symbol) {
      log.push(`chart:${symbol}`);
      if (fault.chart) {
        throw fault.chart;
      }
      return { ...clone(chartFixture), meta: { ...chartFixture.meta, symbol } };
    },
    async search(query) {
      log.push(`search:${query}`);
      if (fault.search) {
        throw fault.search;
      }
      return query === "MU" ? clone(searchFixture) : { news: [] };
    },
    async quoteSummary(symbol) {
      log.push(`quoteSummary:${symbol}`);
      if (fault.quoteSummary) {
        throw fault.quoteSummary;
      }
      return clone(summaryFixture);
    },
  };
}

function fetchImpl(fault: Fault, log: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { hostname, pathname } = new URL(url);
    // The saham desk reads the crowd too; those venues answer from fixtures like every other one.
    if (hostname === "api.stocktwits.com") {
      log.push("stocktwits");
      return new Response(JSON.stringify(streamFixture), { status: 200 });
    }
    if (hostname === "www.reddit.com") {
      log.push("reddit");
      return new Response(REDDIT_SEARCH_MU, { status: 200 });
    }
    const market = pathname.split("/")[1] as "america" | "indonesia";
    log.push(`tv:${market}`);
    if (fault.tradingview) {
      return new Response("{}", { status: fault.tradingview });
    }
    return new Response(JSON.stringify(tvFixture[market]), { status: 200 });
  }) as typeof fetch;
}

function request(overrides: Partial<MarketWatchRequest> = {}): MarketWatchRequest {
  return {
    prompt: "Pre-market briefing",
    tickers: ["mu", "BBCA"],
    positionContext: "",
    language: "id",
    maxChars: 6000,
    specialist: DEFAULT_MARKET_SPECIALIST,
    depth: "quick",
    ...overrides,
  };
}

describe("buildMarketWatchPacket", () => {
  let db: Database.Database;
  let log: string[];
  let phases: Array<[PacketPhase, string]>;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    log = [];
    phases = [];
  });

  afterEach(() => {
    db.close();
  });

  function build(fault: Fault = {}, req: MarketWatchRequest = request(), signal?: AbortSignal) {
    return buildMarketWatchPacket(db, req, {
      now,
      signal,
      clients: { yahoo: yahooClient(fault, log), fetchImpl: fetchImpl(fault, log), delay: noDelay },
      onProgress: (phase, label) => {
        phases.push([phase, label]);
      },
    });
  }

  it("resolves, fetches every section once, merges TradingView over computed technicals, and charts each ticker", async () => {
    const { packet, failures } = await build();

    expect(phases.map(([phase]) => phase)).toEqual(["resolving", "quotes", "technicals", "charts", "news", "macro"]);
    expect(phases[0]?.[1]).toBe("Resolving tickers");
    expect(failures).toEqual([]);
    expect(packet.tickers.map((ticker) => ticker.symbol)).toEqual([
      {
        input: "mu",
        yahoo: "MU",
        tradingview: "NASDAQ:MU",
        name: "Micron Technology, Inc.",
        exchange: "NMS",
        currency: "USD",
      },
      {
        input: "BBCA",
        yahoo: "BBCA.JK",
        tradingview: "IDX:BBCA",
        name: "Bank Central Asia Tbk",
        exchange: "JKT",
        currency: "IDR",
      },
    ]);

    const mu = packet.tickers[0];
    expect(mu?.quote).toMatchObject({ symbol: "MU", price: 1000.26, marketState: "REGULAR" });
    expect(mu?.technical).toMatchObject({
      symbol: "MU",
      tradingview: { summary: 0.5575, movingAverages: 0.933, oscillators: 0.18 },
      rsi14: 57.66,
      sma50: 902.4,
      sma200: 618.9,
      ema200: 671.7,
      macd: 21.4,
      macdSignal: 18.2,
      high52w: 1042.5,
      low52w: 402.1,
      ref: { source: "tradingview" },
    });
    expect(mu?.technical?.tradingview?.label).not.toBe("");
    expect(mu?.history?.bars).toHaveLength(10);
    expect(mu?.chart).not.toBeNull();
    expect(mu?.chart?.x.values).toHaveLength(mu?.history?.bars.length ?? 0);
    expect(mu?.chart?.series[0]?.values.at(-1)).toBe(1000.26);
    expect(mu?.news.map((item) => item.title)).toContain(
      "Micron raises fiscal Q1 guidance as HBM demand outpaces supply",
    );
    expect(mu?.failures).toEqual([]);

    const bbca = packet.tickers[1];
    expect(bbca?.quote).toMatchObject({ symbol: "BBCA.JK", currency: "IDR", marketState: "CLOSED" });
    expect(bbca?.technical?.tradingview?.summary).toBe(-0.1212);
    expect(bbca?.news).toEqual([]);
    expect(bbca?.failures).toEqual([]);
    expect(readCached(db, "BBCA.JK", "news")?.payload).toEqual([]);

    expect(packet.macro.quotes.map((quote) => [quote.symbol, quote.label])).toEqual([
      ["ES=F", "S&P 500 futures"],
      ["^VIX", "VIX"],
      ["IDR=X", "USD/IDR"],
    ]);
    expect(packet.macro.failures).toHaveLength(MACRO_SYMBOLS.length - 3);
    expect(packet.clock.runAt).toBe(NOW.toISOString());
    expect(["pre", "regular", "post", "closed"]).toContain(packet.clock.usSession);
    expect(packet.positionContext).toBe("");

    expect(log.filter((entry) => entry.startsWith("quote:"))).toEqual([
      "quote:MU,BBCA.JK",
      `quote:${MACRO_SYMBOLS.map((entry) => entry.symbol).join(",")}`,
    ]);
    expect(log.filter((entry) => entry.startsWith("chart:")).sort()).toEqual(["chart:BBCA.JK", "chart:MU"]);
    expect(log.filter((entry) => entry.startsWith("tv:")).sort()).toEqual(["tv:america", "tv:indonesia"]);
    expect(log.filter((entry) => entry.startsWith("search:"))).toEqual(
      expect.arrayContaining(["search:MU", "search:BBCA.JK", "search:Bank Central Asia Tbk"]),
    );

    expect(readCached(db, "MU", "quote")?.payload.price).toBe(1000.26);
    expect(readCached(db, "MU", "technical")?.payload.rsi14).toBe(57.66);
    // The default desk (saham) asks the history fetcher for its own depth, not the adapter default.
    expect(readCached(db, historyCacheKey("MU", SAHAM_MONTHS), "history")?.payload.bars).toHaveLength(10);
    expect(readCached(db, "MU", "news")?.payload.length).toBeGreaterThan(0);
    expect(readCached(db, MACRO_CACHE_KEY, "macro")?.payload.quotes).toHaveLength(3);
  });

  it("serves the second run within the TTLs from the cache without touching the network", async () => {
    await build();
    log.length = 0;
    const { packet } = await build({
      quote: new Error("offline"),
      chart: new Error("offline"),
      search: new Error("offline"),
      tradingview: 500,
    });
    expect(log).toEqual([]);
    expect(packet.tickers[0]?.quote?.price).toBe(1000.26);
    expect(packet.tickers[0]?.technical?.tradingview?.summary).toBe(0.5575);
    expect(packet.tickers[0]?.failures).toEqual([]);
  });

  it("falls back to computed technicals with tradingview null when the scanner fails", async () => {
    const { packet } = await build({ tradingview: 429 });
    const mu = packet.tickers[0];
    expect(mu?.technical?.tradingview).toBeNull();
    expect(mu?.technical?.ref.source).toBe("computed");
    expect(mu?.technical?.change1dPercent).not.toBeNull();
    expect(mu?.failures).toEqual(["tradingview: america: TradingView returned HTTP 429"]);
    expect(mu?.chart).not.toBeNull();
  });

  it("keeps the TradingView rating and drops the chart when bars are unavailable", async () => {
    const { packet } = await build({ chart: new Error("socket hang up") });
    const mu = packet.tickers[0];
    expect(mu?.history).toBeNull();
    expect(mu?.chart).toBeNull();
    expect(mu?.technical?.tradingview?.summary).toBe(0.5575);
    expect(mu?.technical?.rsi14).toBe(57.66);
    expect(mu?.failures).toEqual(["history: socket hang up"]);
  });

  it("reports an unknown ticker and a failed macro batch as packet failures, never a throw", async () => {
    const { packet, failures } = await build({}, request({ tickers: ["MU", "ZZZZ"] }));
    expect(packet.tickers.map((ticker) => ticker.symbol.yahoo)).toEqual(["MU"]);
    expect(failures).toEqual(["ZZZZ: unknown symbol (Yahoo Finance returned no quote for ZZZZ)"]);
  });

  it("serves stale quotes and notes it when the batch is down", async () => {
    await build();
    db.prepare("UPDATE market_cache SET observed_at = ?").run("2026-09-09T00:00:00.000Z");
    log.length = 0;
    const { packet, failures } = await build({ quote: new Error("ECONNRESET") });
    expect(packet.tickers[0]?.quote?.price).toBe(1000.26);
    expect(packet.tickers[0]?.failures).toContain("quote: stale (ECONNRESET)");
    expect(failures).toEqual(["macro: ECONNRESET (serving cached levels)"]);
    expect(packet.macro.quotes).toHaveLength(3);
  });

  it("stops at the caller's abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await build({}, request(), controller.signal).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "aborted", status: 499 });
    expect(log).toEqual([]);
  });
});

describe("mergeTechnical", () => {
  const tv: TradingViewIndicators = {
    symbol: "NASDAQ:MU",
    summary: 0.5,
    movingAverages: 0.9,
    oscillators: 0.1,
    label: "Buy",
    rsi: 60,
    close: 1000,
    changePercent: -1.5,
    volume: 1,
    ema200: 700,
    sma50: 900,
    sma200: 600,
    macd: 20,
    macdSignal: 18,
    high52w: 1040,
    low52w: 400,
    ref: {
      source: "tradingview",
      sourceUrl: "https://www.tradingview.com/symbols/NASDAQ-MU/technicals/",
      observedAt: NOW.toISOString(),
    },
  };
  const computed = technicalFixture("MU", {
    tradingview: null,
    rsi14: 55,
    sma50: 890,
    sma200: null,
    ref: computedRef("MU"),
  });

  it("returns null with nothing, TradingView alone, computed alone, and TV-wins when both exist", () => {
    expect(mergeTechnical("MU", null, null)).toBeNull();
    expect(mergeTechnical("MU", null, tv)).toMatchObject({
      symbol: "MU",
      rsi14: 60,
      sma200: 600,
      change1dPercent: -1.5,
      ref: tv.ref,
      tradingview: { label: "Buy" },
    });
    expect(mergeTechnical("MU", computed, null)).toEqual(computed);
    const both = mergeTechnical("MU", computed, tv);
    expect(both).toMatchObject({
      rsi14: 60,
      sma50: 900,
      sma200: 600,
      change1dPercent: computed.change1dPercent,
      change5dPercent: computed.change5dPercent,
      ref: tv.ref,
    });
    expect(computed.rsi14).toBe(55);
    expect(historyFixture("MU").bars).toHaveLength(6);
  });
});

describe("buildMarketWatchPacket swings", () => {
  // Only the wave desk lists `swings`; every other desk leaves the section off.
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("computes the citable pivot highs and lows from each ticker's bars", async () => {
    const log: string[] = [];
    const { packet } = await buildMarketWatchPacket(db, request({ specialist: "elliott-wave" }), {
      now,
      clients: { yahoo: yahooClient({}, log), fetchImpl: fetchImpl({}, log), delay: noDelay },
    });
    for (const ticker of packet.tickers) {
      expect(ticker.swings).toEqual(ticker.history ? swingPoints(ticker.history.bars) : []);
    }
  });
});
