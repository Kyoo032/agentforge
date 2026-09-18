/**
 * Per-specialist source gating: which fetchers a desk's harness lets run, at
 * what bar depth and headline cap. Every response is a fixture; nothing here
 * opens a socket.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  globalNewsQueries,
  harnessFor,
  type MarketSpecialist,
  type MarketWatchRequest,
} from "@agentforge/core/market";
import { ensureSchema } from "@agentforge/db/ensure-schema";
import fundingFixture from "./__fixtures__/binance-funding.json";
import globalFixture from "./__fixtures__/coingecko-global.json";
import marketsFixture from "./__fixtures__/coingecko-markets.json";
import chartFixture from "./__fixtures__/yahoo-chart-mu.json";
import quotesFixture from "./__fixtures__/yahoo-quotes.json";
import searchFixture from "./__fixtures__/yahoo-search-mu.json";
import summaryFixture from "./__fixtures__/yahoo-quote-summary-mu.json";
import streamFixture from "./__fixtures__/stocktwits-mu.json";
import { REDDIT_SEARCH_MU } from "./__fixtures__/reddit-search-mu";
import tvFixture from "./__fixtures__/tradingview-scan.json";
import { buildMarketWatchPacket } from "./packet";
import { globalNewsCacheKey, historyCacheKey, readCached } from "./repo";
import type { YahooClient } from "./yahoo";

const NOW = new Date("2026-09-17T12:30:00.000Z");
const now = () => NOW;
/** Reddit is read one subreddit at a time with a real gap; no test pays for it. */
const noDelay = async () => {};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Rows the shared quote fixture does not carry: the coins and the metals complex. */
const EXTRA_QUOTES: ReadonlyArray<Record<string, unknown>> = [
  { symbol: "BTC-USD", shortName: "Bitcoin USD", currency: "USD", exchange: "CCC", regularMarketPrice: 104231.5 },
  { symbol: "ETH-USD", shortName: "Ethereum USD", currency: "USD", exchange: "CCC", regularMarketPrice: 4210.77 },
  { symbol: "GC=F", shortName: "Gold Dec 26", currency: "USD", exchange: "CMX", regularMarketPrice: 4040 },
  { symbol: "SI=F", shortName: "Silver Dec 26", currency: "USD", exchange: "CMX", regularMarketPrice: 50.5 },
  { symbol: "XAUUSD=X", shortName: "Gold spot", currency: "USD", exchange: "CCY", regularMarketPrice: 4000 },
  { symbol: "GLD", shortName: "SPDR Gold Shares", currency: "USD", exchange: "PCX", regularMarketPrice: 376 },
].map((row) => ({ quoteType: "CRYPTOCURRENCY", marketState: "REGULAR", regularMarketChangePercent: 0.4, ...row }));

/** The fixed macro queries, in both phrasings, so the global-news fetcher gets an answer. */
const MACRO_QUERIES = new Set([...globalNewsQueries("id"), ...globalNewsQueries("en")]);
const MACRO_AT = "2026-09-17T06:00:00.000Z";

type Call = { kind: string; detail: string };

function yahooClient(calls: Call[]): YahooClient {
  const rows = [...clone(quotesFixture.rows as Record<string, unknown>[]), ...clone(EXTRA_QUOTES)];
  return {
    async quote(symbols) {
      calls.push({ kind: "quote", detail: symbols.join(",") });
      return rows.filter((row) => symbols.includes(row.symbol as string));
    },
    async chart(symbol, range) {
      const months = Math.round((range.period2.getTime() - range.period1.getTime()) / (30.44 * 24 * 3600 * 1000));
      calls.push({ kind: "chart", detail: `${symbol}@${months}m` });
      return { ...clone(chartFixture), meta: { ...chartFixture.meta, symbol } };
    },
    async search(query, newsCount) {
      calls.push({ kind: "search", detail: `${query}#${newsCount}` });
      if (MACRO_QUERIES.has(query)) {
        return { news: [{ title: `Macro: ${query}`, publisher: "Fixture", providerPublishTime: MACRO_AT }] };
      }
      return query === "MU" ? clone(searchFixture) : { news: [] };
    },
    async quoteSummary(symbol) {
      calls.push({ kind: "quoteSummary", detail: symbol });
      return clone(summaryFixture);
    },
  };
}

function fetchImpl(calls: Call[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { hostname, pathname } = new URL(url);
    if (hostname === "scanner.tradingview.com") {
      const market = pathname.split("/")[1] as "america" | "indonesia";
      calls.push({ kind: "tradingview", detail: market });
      return new Response(JSON.stringify(tvFixture[market] ?? { data: [] }), { status: 200 });
    }
    if (hostname === "api.coingecko.com") {
      const global = pathname.endsWith("/global");
      calls.push({ kind: global ? "crypto-global" : "crypto-markets", detail: url });
      return new Response(JSON.stringify(global ? globalFixture : marketsFixture), { status: 200 });
    }
    if (hostname === "fapi.binance.com") {
      calls.push({ kind: "crypto-funding", detail: url });
      return new Response(JSON.stringify(fundingFixture), { status: 200 });
    }
    if (hostname === "api.stocktwits.com") {
      calls.push({ kind: "stocktwits", detail: pathname });
      return new Response(JSON.stringify(streamFixture), { status: 200 });
    }
    if (hostname === "www.reddit.com") {
      calls.push({ kind: "reddit", detail: pathname });
      return new Response(REDDIT_SEARCH_MU, { status: 200 });
    }
    throw new Error(`unexpected host ${hostname}`);
  }) as typeof fetch;
}

function request(specialist: MarketSpecialist, tickers: string[]): MarketWatchRequest {
  return {
    prompt: "Briefing",
    tickers,
    positionContext: "",
    language: "id",
    maxChars: 6000,
    specialist,
    depth: "quick",
    model: undefined,
  } as MarketWatchRequest;
}

describe("buildMarketWatchPacket harness gating", () => {
  let db: Database.Database;
  let calls: Call[];

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    calls = [];
  });

  afterEach(() => {
    db.close();
  });

  function build(specialist: MarketSpecialist, tickers: string[] = ["MU", "BBCA"]) {
    return buildMarketWatchPacket(db, request(specialist, tickers), {
      now,
      clients: { yahoo: yahooClient(calls), fetchImpl: fetchImpl(calls), delay: noDelay },
    });
  }

  const kinds = () => [...new Set(calls.map((call) => call.kind))].sort();
  /** The macro batch is the one quote call that asks for the macro symbols. */
  const macroFetched = () => calls.some((call) => call.kind === "quote" && call.detail.includes("^VIX"));

  it("saham reads fundamentals, insiders and the crowd; scanner reads none of them", async () => {
    const saham = await build("saham", ["MU"]);

    expect(kinds()).toContain("quoteSummary");
    expect(kinds()).toContain("stocktwits");
    expect(kinds()).toContain("reddit");
    const mu = saham.packet.tickers[0];
    expect(mu?.fundamentals?.sector).toBe("Technology");
    expect(mu?.fundamentals?.trailingPe).toBe(22.41);
    expect(mu?.insiders).toMatchObject({ window: "90d", buys: 1, sells: 2 });
    expect(mu?.sentiment?.stocktwits).toEqual({ total: 6, bullish: 3, bearish: 2, sampled: 3 });
    expect(mu?.sentiment?.reddit?.subreddits).toEqual(["wallstreetbets", "stocks", "investing"]);
    // Both venues' samples land in one list, capped by core.
    expect(mu?.sentiment?.samples.length).toBeGreaterThan(0);
    expect(mu?.sentiment?.samples.some((sample) => sample.source === "stocktwits")).toBe(true);
    expect(mu?.sentiment?.samples.some((sample) => sample.source === "reddit")).toBe(true);
    // The saham desk is not a macro-news desk, so the fixed global queries are not run.
    expect(saham.packet.globalNews).toBeUndefined();

    calls = [];
    const scanner = await build("scanner", ["MU"]);
    expect(kinds()).not.toContain("quoteSummary");
    expect(kinds()).not.toContain("stocktwits");
    expect(kinds()).not.toContain("reddit");
    expect(scanner.packet.tickers[0]?.fundamentals).toBeUndefined();
    expect(scanner.packet.tickers[0]?.insiders).toBeUndefined();
    expect(scanner.packet.tickers[0]?.sentiment).toBeUndefined();
  });

  it("the news desk runs the fixed macro queries in the request's language and caches the row", async () => {
    const { packet } = await build("news", ["MU"]);

    expect(packet.globalNews?.length).toBeGreaterThan(0);
    expect(packet.globalNews?.[0]?.query).toBe(globalNewsQueries("id")[0]);
    expect(readCached(db, globalNewsCacheKey("id"), "global-news")).not.toBeNull();

    // Second run inside the TTL: the queries are not searched again.
    const before = calls.filter((call) => call.kind === "search").length;
    await build("news", ["MU"]);
    expect(calls.filter((call) => call.kind === "search").length).toBe(before);
  });

  it("scanner takes quotes and technicals only: no bars, no headlines, no macro", async () => {
    const { packet } = await build("scanner");

    expect(harnessFor("scanner").sources).toEqual(["quotes", "technicals", "signals"]);
    expect(kinds()).toEqual(["quote", "tradingview"]);
    expect(macroFetched()).toBe(false);
    expect(packet.tickers[0]?.history).toBeNull();
    expect(packet.tickers[0]?.chart).toBeNull();
    expect(packet.tickers[0]?.news).toEqual([]);
    expect(packet.tickers[0]?.technical).not.toBeNull();
    expect(packet.macro.quotes).toEqual([]);
    expect(packet.signals).toBeDefined();
    expect(packet.rotation).toBeUndefined();
    expect(packet.sessions).toBeUndefined();
  });

  it("elliott-wave asks the history fetcher for 24 months and nothing else", async () => {
    const { packet } = await build("elliott-wave");

    expect(harnessFor("elliott-wave").historyMonths).toBe(24);
    expect(
      calls
        .filter((call) => call.kind === "chart")
        .map((call) => call.detail)
        .sort(),
    ).toEqual(["BBCA.JK@24m", "MU@24m"]);
    expect(readCached(db, historyCacheKey("MU", 24), "history")).not.toBeNull();
    expect(readCached(db, historyCacheKey("MU", 36), "history")).toBeNull();
    expect(kinds()).toEqual(["chart", "quote"]);
    expect(packet.tickers[0]?.swings).toBeInstanceOf(Array);
    expect(packet.tickers[0]?.technical).toBeNull();
  });

  it("news asks for the desk's headline cap, clamped to what a TickerPacket may hold", async () => {
    await build("news");

    expect(harnessFor("news").headlineCap).toBe(10);
    // NEWS_PER_TICKER_MAX is 8, so a cap of 10 is clamped rather than overflowing the packet.
    expect(calls.filter((call) => call.kind === "search").map((call) => call.detail)).toContain("MU#8");
    // The news desk also reads the crowd and the fixed macro queries; `search` carries both.
    expect(kinds()).toEqual(["quote", "reddit", "search", "stocktwits"]);
    expect(macroFetched()).toBe(false);
  });

  // Twelve months, not six: `computeTechnical` needs ~200 bars for sma200 and 252 for the
  // 52-week range, and saham lists `technicals`.
  it("saham asks for five headlines and twelve months of bars", async () => {
    const { packet } = await build("saham");

    expect(calls.filter((call) => call.kind === "search").map((call) => call.detail)).toContain("MU#5");
    expect(calls.filter((call) => call.kind === "chart").map((call) => call.detail)).toContain("MU@12m");
    expect(macroFetched()).toBe(true);
    // One session row per exchange the watchlist touches; IDX is there because BBCA.JK is.
    expect(packet.sessions?.map((row) => row.exchange)).toContain("IDX");
    expect(packet.metals).toBeUndefined();
    expect(packet.rotation).toBeUndefined();
  });

  it("sector-rotation ranks trailing returns and skips technicals, headlines and macro", async () => {
    const { packet } = await build("sector-rotation");

    expect(kinds()).toEqual(["chart", "quote"]);
    expect(packet.rotation).toBeDefined();
    expect(packet.rotation?.length).toBe(packet.tickers.length);
    expect(packet.signals).toBeUndefined();
    expect(packet.tickers[0]?.technical).toBeNull();
  });

  it("gold derives the metals context from quotes it already fetched, with no extra network", async () => {
    const { packet } = await build("gold", ["GC=F", "SI=F", "XAUUSD=X"]);

    expect(kinds()).toEqual(["chart", "quote", "search"]);
    expect(packet.metals).toMatchObject({ source: "computed" });
    expect(packet.metals?.goldSilverRatio).toBeCloseTo(4040 / 50.5, 10);
    expect(packet.metals?.goldFuturesVsSpotPct).toBeCloseTo(1, 10);
    expect(packet.metals?.dxy).toBeUndefined();
    expect(packet.cryptoGlobal).toBeUndefined();
  });

  it("publishes the GLD proxy premium under its own name, never the spot field's", async () => {
    const { packet } = await build("gold", ["GC=F", "GLD"]);

    // No XAUUSD=X in the watchlist, so there is no real spot basis: the packet carries
    // the GLD proxy under `goldFuturesVsGldPct` and leaves the spot field empty.
    expect(packet.metals?.goldFuturesVsSpotPct).toBeUndefined();
    expect(packet.metals?.goldFuturesVsGldPct).toBeCloseTo(((4040 - 3760) / 3760) * 100, 10);
  });

  /**
   * The code-level proof for the crypto desk: the real `buildMarketWatchPacket`,
   * the real CoinGecko and Binance adapters, the real SQLite cache — only the
   * HTTP transport is a fixture. It stands in for driving the running host,
   * which serves code that predates this change until it is restarted.
   */
  it("crypto fetches CoinGecko and the funding rate, and no other desk does", async () => {
    const { packet } = await build("crypto", ["BTC-USD", "ETH-USD"]);

    // The coins carry no TradingView symbol, so the scanner is never called for them.
    expect(kinds()).toEqual([
      "chart",
      "crypto-funding",
      "crypto-global",
      "crypto-markets",
      "quote",
      "reddit",
      "search",
      "stocktwits",
    ]);
    expect(macroFetched()).toBe(false);
    expect(packet.cryptoGlobal).toEqual({
      totalMarketCapUsd: 3421987654321.2,
      btcDominancePct: 57.42,
      ethDominancePct: 12.08,
      source: "web",
      observedAt: NOW.toISOString(),
    });
    expect(packet.tickers[0]?.crypto).toMatchObject({
      marketCapUsd: 2067890123456,
      volume24hUsd: 48213456789,
      change7dPct: 3.87,
      dominancePct: 57.42,
      fundingRatePct: 0.0125,
      source: "web",
    });
    expect(packet.tickers[1]?.crypto?.dominancePct).toBe(12.08);
    expect(packet.metals).toBeUndefined();

    // A second run inside the 5-minute TTL serves the crypto rows from the cache.
    calls.length = 0;
    await build("crypto", ["BTC-USD", "ETH-USD"]);
    expect(calls.filter((call) => call.kind.startsWith("crypto"))).toEqual([]);
  });

  it("never fetches crypto or metals for a desk that did not ask for them", async () => {
    await build("saham", ["MU", "BTC-USD"]);
    expect(calls.some((call) => call.kind.startsWith("crypto"))).toBe(false);
  });
});
