import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { MACRO_SYMBOLS, type Quote, type Technical } from "@agentforge/core/market";
import { ensureSchema } from "@agentforge/db/ensure-schema";
import chartFixture from "./__fixtures__/yahoo-chart-mu.json";
import quotesFixture from "./__fixtures__/yahoo-quotes.json";
import searchFixture from "./__fixtures__/yahoo-search-mu.json";
import tvFixture from "./__fixtures__/tradingview-scan.json";
import { newsItem, yahooRef } from "./__fixtures__/watch";
import { writeCached } from "./repo";
import { MARKET_TOOL_DISCLAIMER, MARKET_TOOL_KEYS, createMarketTools, searchQueryFor } from "./tools";
import type { YahooClient } from "./yahoo";

const NOW = new Date("2026-09-09T12:30:00.000Z");
const now = () => NOW;
const tenant: TenantContext = { tenantId: "local-tenant", organizationId: "org", workspaceId: "ws-1", userId: "local", role: "owner" };

type Output = { success: boolean; error?: string; data?: unknown; failures?: string[] };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function yahooClient(log: string[]): YahooClient {
  return {
    async quote(symbols) {
      log.push(`quote:${symbols.join(",")}`);
      return clone(quotesFixture.rows).filter((row) => symbols.includes(row.symbol));
    },
    async chart(symbol) {
      log.push(`chart:${symbol}`);
      return { ...clone(chartFixture), meta: { ...chartFixture.meta, symbol } };
    },
    async search(query) {
      log.push(`search:${query}`);
      return query === "MU" ? clone(searchFixture) : { news: [] };
    },
    async quoteSummary(symbol) {
      log.push(`quoteSummary:${symbol}`);
      return {};
    },
  };
}

const fetchImpl = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const market = new URL(url).pathname.split("/")[1] as "america" | "indonesia";
  return new Response(JSON.stringify(tvFixture[market]), { status: 200 });
}) as typeof fetch;

describe("market tools (v2)", () => {
  let db: Database.Database;
  let log: string[];
  let tools: ReturnType<typeof createMarketTools>;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    log = [];
    tools = createMarketTools({ db: () => db, now, clients: { yahoo: yahooClient(log), fetchImpl } });
  });

  afterEach(() => {
    db.close();
  });

  it("exposes the five keys, each described as attributed data without recommendations", () => {
    expect(tools.all.map((tool) => tool.key)).toEqual([...MARKET_TOOL_KEYS]);
    for (const tool of tools.all) {
      expect(tool.description.endsWith(MARKET_TOOL_DISCLAIMER)).toBe(true);
      expect(tool.description).toContain("Does not provide recommendations.");
    }
  });

  it("market_quotes resolves any market in one batch, reports unknown symbols, and serves the cache next time", async () => {
    const first = (await tools.quotes.execute({ symbols: ["mu", "BBCA", "ZZZZ"] }, tenant)) as Output & {
      data: { quotes: Array<Quote & { input: string; tradingview: string | null }> };
    };
    expect(first.success).toBe(true);
    expect(first.data.quotes.map((quote) => [quote.input, quote.symbol, quote.tradingview, quote.price])).toEqual([
      ["mu", "MU", "NASDAQ:MU", 1000.26],
      ["BBCA", "BBCA.JK", "IDX:BBCA", 9650],
    ]);
    expect(first.failures).toEqual(["ZZZZ: unknown symbol (Yahoo Finance returned no quote for ZZZZ)"]);
    expect(log).toEqual(["quote:MU,BBCA.JK,ZZZZ"]);

    log.length = 0;
    const second = (await tools.quotes.execute({ symbols: ["MU"] }, tenant)) as Output;
    expect(second.success).toBe(true);
    expect(log).toEqual([]);

    const none = (await tools.quotes.execute({ symbols: ["ZZZZ"] }, tenant)) as Output;
    expect(none).toEqual({ success: false, error: "ZZZZ: unknown symbol (Yahoo Finance returned no quote for ZZZZ)" });
  });

  it("market_history returns ascending bars plus the computed technical, and rejects a non-ticker", async () => {
    const out = (await tools.history.execute({ symbol: "MU", months: 3 }, tenant)) as Output & {
      data: { symbol: string; interval: string; bars: unknown[]; technical: Technical; ref: { source: string } };
    };
    expect(out.success).toBe(true);
    expect(out.data.symbol).toBe("MU");
    expect(out.data.interval).toBe("1d");
    expect(out.data.bars).toHaveLength(10);
    expect(out.data.technical).toMatchObject({ symbol: "MU", tradingview: null, ref: { source: "computed" } });
    expect(out.data.technical.change1dPercent).not.toBeNull();
    expect(out.data.ref.source).toBe("yahoo");
    expect(log).toEqual(["chart:MU"]);

    const bad = (await tools.history.execute({ symbol: "   " }, tenant)) as Output;
    expect(bad).toEqual({ success: false, error: "(empty) is not a ticker." });
  });

  it("market_technical merges the TradingView rating over the computed indicators", async () => {
    const out = (await tools.technical.execute({ symbols: ["MU", "BBCA"] }, tenant)) as Output & {
      data: {
        technicals: Array<{
          symbol: string;
          tradingviewSymbol: string | null;
          technical: Technical | null;
          failures: string[];
        }>;
      };
    };
    expect(out.success).toBe(true);
    expect(out.data.technicals.map((row) => row.symbol)).toEqual(["MU", "BBCA.JK"]);
    expect(out.data.technicals[0]?.technical).toMatchObject({
      tradingview: { summary: 0.5575, label: "STRONG_BUY" },
      rsi14: 57.66,
      sma50: 902.4,
      ref: { source: "tradingview" },
    });
    expect(out.data.technicals[1]?.technical?.tradingview?.summary).toBe(-0.1212);
    expect(out.data.technicals.every((row) => row.failures.length === 0)).toBe(true);
  });

  it("market_news by symbol hides instruction-like and directive headlines and counts them", async () => {
    const out = (await tools.news.execute({ symbol: "MU", limit: 10 }, tenant)) as Output & {
      data: { symbol: string; items: Array<{ title: string; link: string; source: string }>; omitted: number };
    };
    expect(out.success).toBe(true);
    expect(out.data.symbol).toBe("MU");
    expect(out.data.items.map((item) => item.title)).toEqual([
      "Micron raises fiscal Q1 guidance as HBM demand outpaces supply",
      "Chipmakers rally & Micron leads Nasdaq gainers",
      "Samsung and SK hynix expand HBM4 output ahead of 2027",
    ]);
    expect(out.data.items[0]?.source).toBe("yahoo");
    expect(out.data.omitted).toBe(1);
    expect(out.failures).toEqual([]);
  });

  it("market_news by query searches the cached headlines with PII masked and directives dropped", async () => {
    writeCached(
      db,
      "MU",
      "news",
      [newsItem(), newsItem({ title: "Analyst says buy now before HBM shortage", link: "https://example.com/advice" })],
      yahooRef("MU"),
      NOW.toISOString(),
    );
    const out = (await tools.news.execute({ query: "HBM shortage mail me at kyo@example.com" }, tenant)) as Output & {
      data: { hits: Array<{ key: string; title: string }> };
    };
    expect(out.success).toBe(true);
    expect(out.data.hits.map((hit) => hit.title)).toEqual([newsItem().title]);
    expect(searchQueryFor("HBM mail kyo@example.com")).toBe("HBM mail");
    expect(log).toEqual([]);
  });

  it("drops every mask placeholder from the search query, not just the first four", () => {
    // The kinds the finance scanner adds: a masked identifier must never become a search term.
    expect(searchQueryFor("HBM [nik] [npwp] [account] [name] [email] [phone] [id] [card] shortage")).toBe(
      "HBM shortage",
    );
    // The label survives, the identifier does not: `maskPii` turns the digits into `[nik]` and the
    // placeholder is then dropped, so nothing of the number reaches the index.
    expect(searchQueryFor("NIK 3273010101900001 chip demand")).toBe("NIK chip demand");
  });

  it("market_news requires a symbol or a query", () => {
    expect(tools.news.schema.safeParse({}).success).toBe(false);
    expect(tools.news.schema.safeParse({ query: "HBM" }).success).toBe(true);
    expect(tools.news.schema.safeParse({ symbol: "MU", limit: 11 }).success).toBe(false);
  });

  it("market_macro returns the labeled levels and the symbols that were missing", async () => {
    const out = (await tools.macro.execute({}, tenant)) as Output & {
      data: { quotes: Array<{ symbol: string; label: string; price: number }>; failures: string[] };
    };
    expect(out.success).toBe(true);
    expect(out.data.quotes.map((quote) => [quote.symbol, quote.label])).toEqual([
      ["ES=F", "S&P 500 futures"],
      ["^VIX", "VIX"],
      ["IDR=X", "USD/IDR"],
    ]);
    expect(out.data.failures).toHaveLength(MACRO_SYMBOLS.length - 3);
    expect(out.failures).toEqual([]);
  });
});
