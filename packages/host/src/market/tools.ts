/**
 * Market tools for the drafting model: `market_quotes`, `market_history`,
 * `market_technical`, `market_news`, `market_macro`.
 *
 * Host-side because they read and refresh the local `market_cache` through
 * the same loaders the packet builder uses, so a tool call during drafting
 * serves the rows the packet was built from. Every output is scanned by
 * `assertNoAdvice` before it is returned, and all five keys are in core's
 * NETWORK_SOURCED_TOOLS so the runtime injection-scans them like web_search.
 * Bad input (an unknown symbol) is a visible `{ success: false, error }`,
 * never a throw.
 */
import type Database from "better-sqlite3";
import { z } from "zod";
import { defineTool, maskPii } from "@agentforge/core";
import {
  ADVICE_PATTERN,
  WATCHLIST_MAX,
  assertNoAdvice,
  computeTechnical,
  type Technical,
  type WatchNewsItem,
  type WatchRef,
} from "@agentforge/core/market";
import { mapLimit } from "./map-limit";
import {
  loadHistory,
  loadMacro,
  loadNews,
  loadQuotes,
  loadTechnicals,
  packetContext,
  type PacketClients,
  type PacketContext,
} from "./packet";
import { searchNews } from "./repo";
import { HISTORY_MONTHS_DEFAULT, HISTORY_MONTHS_MAX, symbolCandidates, yahooQuoteUrl } from "./yahoo";

export const MARKET_TOOL_KEYS = [
  "market_quotes",
  "market_history",
  "market_technical",
  "market_news",
  "market_macro",
] as const;
export type MarketToolKey = (typeof MARKET_TOOL_KEYS)[number];

export const MARKET_TOOL_DISCLAIMER =
  "Returns attributed market data from third-party sources. Does not provide recommendations.";
export const MARKET_NEWS_DEFAULT_LIMIT = 8;
export const MARKET_NEWS_LIMIT_MAX = 10;

const PII_MASK_TOKEN = /\[(?:email|phone|id|card)\]/g;

export type MarketToolDeps = {
  /** The SQLite handle that owns `market_cache`; lazy so importing the tools never opens a database. */
  db: () => Database.Database | Promise<Database.Database>;
  now?: () => Date;
  clients?: PacketClients;
  search?: typeof searchNews;
};

type Failure = { success: false; error: string };

const symbolArg = z
  .string()
  .min(1)
  .max(20)
  .describe("Ticker as the market knows it: MU, NVDA, BBCA, BBCA.JK, ES=F, ^VIX");
const symbolsArg = z.array(symbolArg).min(1).max(WATCHLIST_MAX).describe(`1 to ${WATCHLIST_MAX} tickers`);
const limitArg = z.number().int().min(1).max(MARKET_NEWS_LIMIT_MAX).optional();

function failure(error: string): Failure {
  return { success: false, error };
}

function guarded<T>(output: T): T {
  assertNoAdvice(output);
  return output;
}

/** FTS-safe query: PII masked, mask placeholders and quotes dropped. */
export function searchQueryFor(raw: string): string {
  return maskPii(raw).replace(PII_MASK_TOKEN, " ").replace(/\s+/g, " ").trim();
}

function carriesAdvice(item: Pick<WatchNewsItem, "title" | "summary">): boolean {
  return ADVICE_PATTERN.test(item.title) || ADVICE_PATTERN.test(item.summary);
}

function headline(item: WatchNewsItem) {
  return {
    title: item.title,
    publisher: item.publisher,
    link: item.link,
    publishedAt: item.publishedAt,
    source: item.ref.source,
    observedAt: item.ref.observedAt,
  };
}

/** The single Yahoo symbol an input maps to, or null when it is not a ticker. */
function yahooKeyFor(input: string): string | null {
  return symbolCandidates([input]).wanted[0]?.yahoo ?? null;
}

function computedRef(symbol: string, observedAt: string): WatchRef {
  return { source: "computed", sourceUrl: yahooQuoteUrl(symbol), observedAt };
}

function technicalRow(technical: Technical | null) {
  return technical;
}

/** Build the five tools over injected dependencies (tests) or the host defaults. */
export function createMarketTools(deps: MarketToolDeps) {
  const now = deps.now ?? (() => new Date());
  const search = deps.search ?? searchNews;
  const context = async (): Promise<PacketContext> => packetContext(await deps.db(), { now, clients: deps.clients });

  const quotes = defineTool({
    key: "market_quotes",
    name: "Market quotes",
    description: `Current quotes for up to ${WATCHLIST_MAX} tickers from any market (price, day change, previous close, pre- and post-market price and change, volume, market cap, market state, currency, exchange), from the local cache when fresh (5 min) or Yahoo Finance otherwise. ${MARKET_TOOL_DISCLAIMER}`,
    schema: z.object({ symbols: symbolsArg }),
    execute: async ({ symbols }) => {
      const ctx = await context();
      const loaded = await loadQuotes(symbols, ctx);
      if (loaded.symbols.length === 0) {
        return failure(loaded.failures.join("; ") || "No symbol resolved.");
      }
      const rows = loaded.symbols.flatMap((symbol) => {
        const quote = loaded.quotes.get(symbol.yahoo);
        return quote ? [{ ...quote, input: symbol.input, tradingview: symbol.tradingview }] : [];
      });
      const stale = [...loaded.stale].map(([symbol, note]) => `${symbol}: ${note}`);
      return guarded({ success: true, data: { quotes: rows }, failures: [...loaded.failures, ...stale] });
    },
  });

  const history = defineTool({
    key: "market_history",
    name: "Market price history",
    description: `Daily OHLCV bars for one ticker (default ${HISTORY_MONTHS_DEFAULT} months, up to ${HISTORY_MONTHS_MAX}) with the technical indicators computed from them (RSI14, SMA50/200, EMA200, MACD, 1d/5d/1m change, 52-week range when a year of bars is present). Cached for 6 hours. ${MARKET_TOOL_DISCLAIMER}`,
    schema: z.object({
      symbol: symbolArg,
      months: z
        .number()
        .int()
        .min(1)
        .max(HISTORY_MONTHS_MAX)
        .optional()
        .describe(`Months of bars, 1 to ${HISTORY_MONTHS_MAX}`),
    }),
    execute: async ({ symbol: input, months }) => {
      const symbol = yahooKeyFor(input);
      if (!symbol) {
        return failure(`${input.trim() || "(empty)"} is not a ticker.`);
      }
      const ctx = await context();
      const loaded = await loadHistory(symbol, ctx, months ?? HISTORY_MONTHS_DEFAULT);
      if (!loaded.history) {
        return failure(loaded.failure ?? `No bars returned for ${symbol}.`);
      }
      const technical = computeTechnical(loaded.history, computedRef(symbol, ctx.nowIso));
      return guarded({
        success: true,
        data: {
          symbol,
          interval: loaded.history.interval,
          bars: loaded.history.bars,
          technical: technicalRow(technical),
          ref: loaded.history.ref,
        },
        failures: loaded.failure ? [loaded.failure] : [],
      });
    },
  });

  const technical = defineTool({
    key: "market_technical",
    name: "Market technicals",
    description: `Technical picture for up to ${WATCHLIST_MAX} tickers: TradingView technical rating (summary, moving averages, oscillators, vendor label) where the exchange is covered, plus RSI14, SMA50/200, EMA200, MACD and signal, 1d/5d/1m change, and the 52-week range, computed from Yahoo Finance bars when the vendor value is missing. Cached for 15 minutes. ${MARKET_TOOL_DISCLAIMER}`,
    schema: z.object({ symbols: symbolsArg }),
    execute: async ({ symbols }) => {
      const ctx = await context();
      const loaded = await loadQuotes(symbols, ctx);
      if (loaded.symbols.length === 0) {
        return failure(loaded.failures.join("; ") || "No symbol resolved.");
      }
      const histories = await mapLimit(loaded.symbols, ctx.concurrency, (symbol) => loadHistory(symbol.yahoo, ctx));
      const bars = new Map(
        loaded.symbols.map((symbol, index) => {
          const entry = histories[index];
          return [symbol.yahoo, entry?.status === "fulfilled" ? entry.value.history : null];
        }),
      );
      const technicals = await loadTechnicals(loaded.symbols, bars, ctx);
      const rows = loaded.symbols.map((symbol) => {
        const row = technicals.get(symbol.yahoo);
        return {
          symbol: symbol.yahoo,
          tradingviewSymbol: symbol.tradingview,
          technical: technicalRow(row?.technical ?? null),
          failures: row?.failures ?? [],
        };
      });
      return guarded({ success: true, data: { technicals: rows }, failures: loaded.failures });
    },
  });

  const news = defineTool({
    key: "market_news",
    name: "Market news",
    description: `Recent headlines for one ticker (title, publisher, link, published time; never the article text) from the local cache (refreshed after 30 minutes) or Yahoo Finance, or a full-text search over every cached headline when a query is given instead of a symbol. ${MARKET_TOOL_DISCLAIMER}`,
    schema: z
      .object({
        symbol: symbolArg.optional(),
        query: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Words to look for in cached headlines (used when no symbol is given)"),
        limit: limitArg.describe(`Max headlines, 1 to ${MARKET_NEWS_LIMIT_MAX} (default ${MARKET_NEWS_DEFAULT_LIMIT})`),
      })
      .refine((value) => Boolean(value.symbol?.trim() || value.query?.trim()), {
        message: "symbol or query is required",
      }),
    execute: async ({ symbol: input, query, limit }) => {
      const cap = limit ?? MARKET_NEWS_DEFAULT_LIMIT;
      const ctx = await context();
      if (input?.trim()) {
        const loaded = await loadQuotes([input], ctx);
        const resolved = loaded.symbols[0];
        if (!resolved) {
          return failure(loaded.failures.join("; ") || `${input.trim()} is not a ticker.`);
        }
        const { news: items, failure: note } = await loadNews(resolved, ctx);
        const eligible = items.filter((item) => !item.injectionSuspect && !carriesAdvice(item));
        return guarded({
          success: true,
          data: {
            symbol: resolved.yahoo,
            items: eligible.slice(0, cap).map(headline),
            omitted: items.length - eligible.length,
          },
          failures: note ? [note] : [],
        });
      }
      const hits = search(ctx.db, searchQueryFor(query ?? ""), undefined, cap).filter((hit) => !carriesAdvice(hit));
      return guarded({ success: true, data: { hits } });
    },
  });

  const macro = defineTool({
    key: "market_macro",
    name: "Market macro levels",
    description: `Macro snapshot: S&P 500 / Nasdaq 100 / Dow / Russell 2000 futures, VIX, US 10Y yield, WTI crude, US dollar index, IHSG, and USD/IDR with level and day change. Cached for 5 minutes. ${MARKET_TOOL_DISCLAIMER}`,
    schema: z.object({}),
    execute: async () => {
      const ctx = await context();
      const loaded = await loadMacro(ctx);
      if (loaded.macro.quotes.length === 0) {
        return failure(loaded.failure ?? "No macro quotes returned.");
      }
      return guarded({ success: true, data: loaded.macro, failures: loaded.failure ? [loaded.failure] : [] });
    },
  });

  return { quotes, history, technical, news, macro, all: [quotes, history, technical, news, macro] };
}

export type MarketTools = ReturnType<typeof createMarketTools>;

/** Host defaults: the app database, opened on first call, and the real Yahoo / TradingView clients. */
export const marketTools: MarketTools = createMarketTools({
  db: async () => (await import("@agentforge/db")).sql,
});
