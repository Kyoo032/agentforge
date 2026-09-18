/**
 * Market Watch packet: everything the model may see for one request.
 *
 * resolve symbols (one quote batch) -> histories, headlines, macro in parallel
 * (four in flight per kind) -> technicals (computed from bars, TradingView
 * values winning where present) -> a chart per ticker -> the clock.
 *
 * Every section goes through the cache (fresh row, else fetch, else stale row
 * plus a failure). A ticker that loses a section keeps the rest and records
 * why in `TickerPacket.failures`; nothing aborts the whole packet except the
 * caller's own abort signal. The building blocks are exported so the market
 * tools serve the same cached rows.
 */
import type Database from "better-sqlite3";
import {
  GLOBAL_NEWS_MAX,
  NEWS_PER_TICKER_MAX,
  SENTIMENT_SAMPLES_MAX,
  buildPriceChart,
  computeRotation,
  computeSessions,
  computeSignals,
  computeTechnical,
  globalNewsQueries,
  harnessFor,
  marketClock,
  marketWatchPacketSchema,
  swingPoints,
  technicalSchema,
  tickerSentimentSchema,
  tradingViewMarket,
  type GlobalNewsItem,
  type GlobalNewsLanguage,
  type MacroSnapshot,
  type MarketHarnessSpec,
  type MarketSource,
  type MarketSpecialist,
  type MarketWatchPacket,
  type MarketWatchRequest,
  type PriceHistory,
  type Quote,
  type ResolvedSymbol,
  type Technical,
  type TickerCrypto,
  type TickerFundamentals,
  type TickerInsiders,
  type TickerPacket,
  type TickerSentiment,
  type WatchNewsItem,
  type WatchRef,
} from "@agentforge/core/market";
import { throwIfJobAborted } from "../job-stream";
import {
  coingeckoId,
  cryptoGlobalUrl,
  cryptoMarketsUrl,
  fetchCryptoGlobal,
  fetchCryptoMarkets,
  fetchFundingRate,
  fundingRateUrl,
  type CryptoGlobal,
  type CryptoMarket,
} from "./coingecko";
import { fetchFundamentals } from "./fundamentals";
import { GLOBAL_NEWS_PER_QUERY, fetchGlobalNews } from "./global-news";
import { fetchMacro } from "./macro";
import { MAP_LIMIT_DEFAULT, mapLimit } from "./map-limit";
import { deriveMetals } from "./metals";
import { fetchReddit, redditPlanFor, redditSearchUrl } from "./reddit";
import {
  CRYPTO_GLOBAL_CACHE_KEY,
  MACRO_CACHE_KEY,
  globalNewsCacheKey,
  historyCacheKey,
  readCached,
  readFresh,
  resolveCached,
  writeCached,
  type CachedRow,
} from "./repo";
import { fetchStocktwits, stocktwitsStreamUrl, stocktwitsSymbol } from "./stocktwits";
import { fetchTradingViewRatings, type TradingViewIndicators } from "./tradingview";
import {
  HISTORY_MONTHS_DEFAULT,
  NEWS_COUNT_DEFAULT,
  fetchHistory,
  fetchNewsFor,
  resolveSymbols,
  resolvedFromQuote,
  symbolCandidates,
  yahooQuoteUrl,
  type Candidate,
  type YahooClient,
  type YahooFetchOptions,
} from "./yahoo";

export const PACKET_PHASES = ["resolving", "quotes", "technicals", "charts", "news", "macro"] as const;
export type PacketPhase = (typeof PACKET_PHASES)[number];
export type PacketProgress = (phase: PacketPhase, label: string) => void;

/** Which optional sections a packet fetches. The watch board skips headlines and macro. */
export type PacketSections = { news: boolean; macro: boolean };
export const ALL_SECTIONS: PacketSections = { news: true, macro: true };

/**
 * What a packet fetches when the caller names no specialist (the watch board
 * and the market tools). Exactly the sections that existed before the harness,
 * so those two routes are byte-for-byte what they were; the harness sections
 * (`crypto`, `metals`, `signals`, `rotation`, `sessions`) are opt-in only.
 */
export const LEGACY_SOURCES: readonly MarketSource[] = [
  "quotes",
  "history",
  "technicals",
  "macro",
  "headlines",
  "swings",
];

const NO_NEWS: LoadedNews = { news: [], failure: null };
const NO_MACRO: LoadedMacro = { macro: { quotes: [], failures: [] }, failure: null };
const NO_HISTORY: LoadedHistory = { history: null, failure: null };
const NO_CRYPTO: LoadedCrypto = { markets: new Map(), funding: new Map(), failures: [] };
const NO_FUNDAMENTALS: LoadedFundamentals = { failures: [] };
const NO_SENTIMENT: LoadedSentiment = { failures: [] };
const NO_GLOBAL_NEWS: LoadedGlobalNews = { items: [], failures: [] };

function skipped<T>(value: T): PromiseSettledResult<T> {
  return { status: "fulfilled", value };
}

export type PacketClients = {
  yahoo?: YahooClient;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * The politeness gap Reddit is read with, injected so a test does not sit
   * through `REDDIT_DELAY_MS` per subreddit. Production leaves it alone.
   */
  delay?: (ms: number) => Promise<void>;
};

export type BuildPacketOptions = {
  now?: () => Date;
  clients?: PacketClients;
  signal?: AbortSignal;
  onProgress?: PacketProgress;
  /** Fetches in flight per kind. */
  concurrency?: number;
  /** Sections to fetch; defaults to all. An explicit flag still wins over the harness. */
  include?: Partial<PacketSections>;
  /**
   * Which desk is asking. Given one, the packet fetches and computes only what
   * `harnessFor(specialist).sources` lists, at that desk's bar depth and
   * headline cap. Omitted (watch board, market tools), the legacy set is used.
   */
  specialist?: MarketSpecialist;
  /**
   * Which phrasing of the fixed macro queries `globalNews` is fetched with, and
   * which cache row it lands in. Defaults to Indonesian, like the request.
   */
  language?: GlobalNewsLanguage;
};

export type PacketBuild = {
  packet: MarketWatchPacket;
  /** Packet-wide failures (resolution, macro). Per-ticker ones are on each TickerPacket. */
  failures: string[];
};

/** Everything the loaders need; built once per request. */
export type PacketContext = {
  db: Database.Database;
  now: () => Date;
  nowIso: string;
  yahoo: YahooFetchOptions;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  concurrency: number;
  include: PacketSections;
  /** The asking desk's harness, or null when no specialist was named. */
  harness: MarketHarnessSpec | null;
  /** The language the fixed macro queries are phrased in. */
  language: GlobalNewsLanguage;
  /** Passed to the Reddit adapter as its inter-subreddit wait; undefined means the real one. */
  delay?: (ms: number) => Promise<void>;
};

/** Whether this packet fetches or computes one section. No harness means the legacy set. */
export function hasSource(ctx: Pick<PacketContext, "harness">, source: MarketSource): boolean {
  return ctx.harness ? ctx.harness.sources.includes(source) : LEGACY_SOURCES.includes(source);
}

/** Bars the history fetcher is asked for. The desk's depth, or the 36-month default. */
export function historyMonthsFor(ctx: Pick<PacketContext, "harness">): number {
  return ctx.harness?.historyMonths ?? HISTORY_MONTHS_DEFAULT;
}

/** Headlines kept per ticker, never above what a TickerPacket may hold. */
export function headlineCapFor(ctx: Pick<PacketContext, "harness">): number {
  return Math.min(ctx.harness?.headlineCap ?? NEWS_COUNT_DEFAULT, NEWS_PER_TICKER_MAX);
}

export function packetContext(db: Database.Database, opts: BuildPacketOptions = {}): PacketContext {
  const now = opts.now ?? (() => new Date());
  const harness = opts.specialist ? harnessFor(opts.specialist) : null;
  const wants = (source: MarketSource) => hasSource({ harness }, source);
  return {
    db,
    now,
    nowIso: now().toISOString(),
    yahoo: { client: opts.clients?.yahoo, signal: opts.signal, now, timeoutMs: opts.clients?.timeoutMs },
    fetchImpl: opts.clients?.fetchImpl ?? fetch,
    signal: opts.signal,
    concurrency: opts.concurrency ?? MAP_LIMIT_DEFAULT,
    include: {
      // A desk that lists headlines but caps them at zero gets none; an explicit flag still wins.
      news: opts.include?.news ?? (wants("headlines") && (harness?.headlineCap ?? 1) > 0),
      macro: opts.include?.macro ?? wants("macro"),
    },
    harness,
    language: opts.language ?? "id",
    delay: opts.clients?.delay,
  };
}

/* Quotes + resolution */

export type LoadedQuotes = {
  symbols: ResolvedSymbol[];
  quotes: Map<string, Quote>;
  /** Yahoo symbol -> failure note when the quote served is a stale cache row. */
  stale: Map<string, string>;
  /** Inputs that resolved to nothing, one string each. */
  failures: string[];
};

type Entry = Candidate;

function entriesFor(inputs: readonly string[]): { entries: Entry[]; failures: string[] } {
  const { wanted, failures } = symbolCandidates(inputs);
  return { entries: wanted, failures };
}

function failureFor(input: string, failures: readonly string[]): string {
  return failures.find((entry) => entry.startsWith(`${input}:`)) ?? `${input}: unknown symbol`;
}

/**
 * Fresh cached quotes are served as-is; the rest go through one `quote()`
 * batch that also validates the symbols. An input the batch could not resolve
 * falls back to its stale cache row (noted) or becomes a failure.
 */
export async function loadQuotes(inputs: readonly string[], ctx: PacketContext): Promise<LoadedQuotes> {
  const { entries, failures } = entriesFor(inputs);
  const quotes = new Map<string, Quote>();
  const stale = new Map<string, string>();
  const resolved = new Map<string, ResolvedSymbol>();
  const pending: Entry[] = [];
  for (const entry of entries) {
    const row = readFresh(ctx.db, entry.yahoo, "quote", ctx.nowIso);
    if (row) {
      quotes.set(entry.yahoo, row.payload);
      resolved.set(entry.yahoo, resolvedFromQuote(entry.input, row.payload));
    } else {
      pending.push(entry);
    }
  }
  if (pending.length > 0) {
    const batch = await resolveSymbols(
      pending.map((entry) => entry.input),
      ctx.yahoo,
    );
    for (const quote of batch.quotes) {
      writeCached(ctx.db, quote.symbol, "quote", quote, quote.ref, quote.ref.observedAt);
    }
    for (const symbol of batch.symbols) {
      resolved.set(symbol.yahoo, symbol);
      const quote = batch.quotes.find((row) => row.symbol === symbol.yahoo);
      if (quote) {
        quotes.set(symbol.yahoo, quote);
      }
    }
    for (const entry of pending) {
      if (resolved.has(entry.yahoo)) {
        continue;
      }
      const reason = failureFor(entry.input, batch.failures);
      const cached = readCached(ctx.db, entry.yahoo, "quote");
      if (cached) {
        quotes.set(entry.yahoo, cached.payload);
        resolved.set(entry.yahoo, resolvedFromQuote(entry.input, cached.payload));
        stale.set(entry.yahoo, `quote: stale (${reason.slice(entry.input.length + 2)})`);
      } else {
        failures.push(reason);
      }
    }
  }
  const symbols = entries.flatMap((entry) => {
    const symbol = resolved.get(entry.yahoo);
    return symbol ? [symbol] : [];
  });
  return { symbols, quotes, stale, failures };
}

/* History */

export type LoadedHistory = { history: PriceHistory | null; failure: string | null };

export async function loadHistory(
  symbol: string,
  ctx: PacketContext,
  months: number = HISTORY_MONTHS_DEFAULT,
): Promise<LoadedHistory> {
  const result = await resolveCached(ctx.db, historyCacheKey(symbol, months), "history", ctx.nowIso, async () => {
    const history = await fetchHistory(symbol, { ...ctx.yahoo, months });
    return history.bars.length > 0 ? { payload: history, ref: history.ref } : null;
  });
  const note = result.failure && result.row ? `${result.failure} (serving cached bars)` : result.failure;
  return { history: result.row?.payload ?? null, failure: note };
}

/* Technicals */

export type LoadedTechnical = { technical: Technical | null; failures: string[] };

function emptyTechnical(symbol: string, ref: WatchRef): Technical {
  return technicalSchema.parse({ symbol, ref });
}

/** TradingView values win where present; the computed ones fill the rest. Pure. */
export function mergeTechnical(
  symbol: string,
  computed: Technical | null,
  tv: TradingViewIndicators | null,
): Technical | null {
  if (!computed && !tv) {
    return null;
  }
  const base = computed ?? emptyTechnical(symbol, (tv as TradingViewIndicators).ref);
  return technicalSchema.parse({
    ...base,
    tradingview: tv
      ? { summary: tv.summary, movingAverages: tv.movingAverages, oscillators: tv.oscillators, label: tv.label }
      : null,
    rsi14: tv?.rsi ?? base.rsi14,
    sma50: tv?.sma50 ?? base.sma50,
    sma200: tv?.sma200 ?? base.sma200,
    ema200: tv?.ema200 ?? base.ema200,
    macd: tv?.macd ?? base.macd,
    macdSignal: tv?.macdSignal ?? base.macdSignal,
    high52w: tv?.high52w ?? base.high52w,
    low52w: tv?.low52w ?? base.low52w,
    change1dPercent: base.change1dPercent ?? tv?.changePercent ?? null,
    ref: tv ? tv.ref : base.ref,
  });
}

function computedTechnical(symbol: ResolvedSymbol, history: PriceHistory | null, ctx: PacketContext): Technical | null {
  if (!history || history.bars.length === 0) {
    return null;
  }
  const ref: WatchRef = { source: "computed", sourceUrl: yahooQuoteUrl(symbol.yahoo), observedAt: ctx.nowIso };
  return computeTechnical(history, ref);
}

/**
 * One Technical per symbol: the fresh cached row when there is one, else
 * computed from the bars merged with one TradingView scan per market. The
 * merged row is cached; a ticker without bars and without a rating gets null.
 */
export async function loadTechnicals(
  symbols: readonly ResolvedSymbol[],
  histories: ReadonlyMap<string, PriceHistory | null>,
  ctx: PacketContext,
): Promise<Map<string, LoadedTechnical>> {
  const out = new Map<string, LoadedTechnical>();
  const pending = symbols.filter((symbol) => {
    const row = readFresh(ctx.db, symbol.yahoo, "technical", ctx.nowIso);
    if (row) {
      out.set(symbol.yahoo, { technical: row.payload, failures: [] });
    }
    return !row;
  });
  const tvSymbols = pending.flatMap((symbol) => (symbol.tradingview ? [symbol.tradingview] : []));
  const scan =
    tvSymbols.length > 0
      ? await fetchTradingViewRatings(tvSymbols, {
          fetchImpl: ctx.fetchImpl,
          signal: ctx.signal,
          now: ctx.now,
          timeoutMs: ctx.yahoo.timeoutMs,
        })
      : { ratings: new Map<string, TradingViewIndicators>(), failures: [] };
  for (const symbol of pending) {
    const tv = symbol.tradingview ? (scan.ratings.get(symbol.tradingview) ?? null) : null;
    const failures = tradingViewFailures(symbol, tv, scan.failures);
    const merged = mergeTechnical(
      symbol.yahoo,
      computedTechnical(symbol, histories.get(symbol.yahoo) ?? null, ctx),
      tv,
    );
    if (merged) {
      writeCached(ctx.db, symbol.yahoo, "technical", merged, merged.ref, ctx.nowIso);
    } else {
      failures.push("technical: no bars to compute from and no TradingView rating");
    }
    out.set(symbol.yahoo, { technical: merged, failures });
  }
  return out;
}

function tradingViewFailures(
  symbol: ResolvedSymbol,
  tv: TradingViewIndicators | null,
  scanFailures: readonly string[],
): string[] {
  if (tv || !symbol.tradingview) {
    return [];
  }
  const market = tradingViewMarket(symbol.tradingview);
  const own = scanFailures.filter(
    (entry) => entry.startsWith(`${symbol.tradingview}:`) || (market !== null && entry.startsWith(`${market}:`)),
  );
  return (own.length > 0 ? own : [`${symbol.tradingview}: no TradingView rating`]).map(
    (entry) => `tradingview: ${entry}`,
  );
}

/* News */

export type LoadedNews = { news: WatchNewsItem[]; failure: string | null };

export async function loadNews(symbol: ResolvedSymbol, ctx: PacketContext, count?: number): Promise<LoadedNews> {
  // An empty list is a valid answer ("no headlines") and is cached like any other, so it is not refetched every run.
  const result = await resolveCached(ctx.db, symbol.yahoo, "news", ctx.nowIso, async () => {
    const items = await fetchNewsFor(symbol.yahoo, symbol.name, { ...ctx.yahoo, count });
    const ref: WatchRef = items[0]?.ref ?? {
      source: "yahoo",
      sourceUrl: yahooQuoteUrl(symbol.yahoo),
      observedAt: ctx.nowIso,
    };
    return { payload: items, ref };
  });
  const note = result.failure && result.row ? `${result.failure} (serving cached headlines)` : result.failure;
  return { news: result.row?.payload ?? [], failure: note };
}

/* Macro */

export type LoadedMacro = { macro: MacroSnapshot; failure: string | null };

export async function loadMacro(ctx: PacketContext): Promise<LoadedMacro> {
  const result = await resolveCached(ctx.db, MACRO_CACHE_KEY, "macro", ctx.nowIso, async () => {
    const snapshot = await fetchMacro(ctx.yahoo);
    if (snapshot.quotes.length === 0) {
      // fetchMacro already prefixes a batch failure with "macro: "; resolveCached adds the kind again.
      throw new Error(
        snapshot.failures.map((entry) => entry.replace(/^macro: /, "")).join("; ") || "no macro quotes returned",
      );
    }
    return { payload: snapshot, ref: (snapshot.quotes[0] as Quote).ref };
  });
  const row: CachedRow<"macro"> | null = result.row;
  const failure = result.failure && row ? `${result.failure} (serving cached levels)` : result.failure;
  return { macro: row?.payload ?? { quotes: [], failures: [] }, failure };
}

/* Crypto */

export type LoadedCrypto = {
  /** Whole-market context; absent when the watchlist holds no coin this host can map. */
  global?: CryptoGlobal;
  /** Yahoo symbol -> CoinGecko row. */
  markets: Map<string, CryptoMarket>;
  /** Yahoo symbol -> perp funding rate in percent. Best effort; a missing venue is not a failure. */
  funding: Map<string, number>;
  failures: string[];
};

/** Cache rows for a keyless HTTP source. `web` is the WatchSource; the payload names the provider itself. */
function webRef(sourceUrl: string, observedAt: string): WatchRef {
  return { source: "web", sourceUrl, observedAt };
}

/** Fresh rows are served as-is; every remaining coin goes into one CoinGecko batch. */
async function loadCryptoMarkets(
  tickers: readonly string[],
  ctx: PacketContext,
): Promise<{ markets: Map<string, CryptoMarket>; failures: string[] }> {
  const markets = new Map<string, CryptoMarket>();
  const pending: string[] = [];
  for (const ticker of tickers) {
    const row = readFresh(ctx.db, ticker, "crypto-markets", ctx.nowIso);
    if (row) {
      markets.set(ticker, row.payload);
    } else {
      pending.push(ticker);
    }
  }
  if (pending.length === 0) {
    return { markets, failures: [] };
  }
  const batch = await fetchCryptoMarkets(pending, {
    fetchImpl: ctx.fetchImpl,
    signal: ctx.signal,
    now: ctx.now,
    timeoutMs: ctx.yahoo.timeoutMs,
  });
  const url = cryptoMarketsUrl(pending.flatMap((ticker) => coingeckoId(ticker) ?? []));
  const failures = [...batch.failures];
  for (const ticker of pending) {
    const row = batch.markets.get(ticker);
    if (row) {
      markets.set(ticker, row);
      writeCached(ctx.db, ticker, "crypto-markets", row, webRef(url, row.observedAt), row.observedAt);
      continue;
    }
    // The batch is down or omitted this coin: serve the stale row and say so.
    const cached = readCached(ctx.db, ticker, "crypto-markets");
    if (cached) {
      markets.set(ticker, cached.payload);
      failures.push(`crypto: ${ticker} serving cached market data`);
    }
  }
  return { markets, failures };
}

/** One funding row per coin, four in flight. A venue that blocks the region is silently absent. */
async function loadCryptoFunding(tickers: readonly string[], ctx: PacketContext): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const results = await mapLimit(tickers, ctx.concurrency, async (ticker) => {
    const resolved = await resolveCached(ctx.db, ticker, "crypto-funding", ctx.nowIso, async () => {
      const funding = await fetchFundingRate(ticker, {
        fetchImpl: ctx.fetchImpl,
        signal: ctx.signal,
        now: ctx.now,
        timeoutMs: ctx.yahoo.timeoutMs,
      });
      if (!funding) {
        return null;
      }
      const base = ticker.split("-")[0] ?? ticker;
      return { payload: funding, ref: webRef(fundingRateUrl(base.toUpperCase()), funding.observedAt) };
    });
    return { ticker, rate: resolved.row?.payload.fundingRatePct ?? null };
  });
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.rate !== null) {
      out.set(result.value.ticker, result.value.rate);
    }
  }
  return out;
}

/**
 * Global dominance plus per-coin market cap, volume, 7d change and funding.
 * Only the watchlist entries this host has a CoinGecko id for are fetched;
 * anything else is simply not a coin. Every failure is a string, never a throw.
 */
export async function loadCrypto(symbols: readonly ResolvedSymbol[], ctx: PacketContext): Promise<LoadedCrypto> {
  const tickers = symbols.map((symbol) => symbol.yahoo).filter((ticker) => coingeckoId(ticker) !== null);
  if (tickers.length === 0) {
    return NO_CRYPTO;
  }
  const globalPending = resolveCached(ctx.db, CRYPTO_GLOBAL_CACHE_KEY, "crypto-global", ctx.nowIso, async () => {
    const result = await fetchCryptoGlobal({
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      now: ctx.now,
      timeoutMs: ctx.yahoo.timeoutMs,
    });
    if (!result.global) {
      throw new Error((result.failure ?? "crypto-global: no data").replace(/^crypto-global: /, ""));
    }
    return { payload: result.global, ref: webRef(cryptoGlobalUrl(), result.global.observedAt) };
  });
  const [globalResult, marketsResult, funding] = await Promise.all([
    globalPending,
    loadCryptoMarkets(tickers, ctx),
    loadCryptoFunding(tickers, ctx),
  ]);
  const globalFailure =
    globalResult.failure && globalResult.row ? `${globalResult.failure} (serving cached levels)` : globalResult.failure;
  return {
    global: globalResult.row?.payload,
    markets: marketsResult.markets,
    funding,
    failures: [...marketsResult.failures, ...(globalFailure ? [globalFailure] : [])],
  };
}

/* Fundamentals + insiders */

export type LoadedFundamentals = {
  fundamentals?: TickerFundamentals;
  insiders?: TickerInsiders;
  failures: string[];
};

/**
 * One `quoteSummary` call fills two cache rows, because they age at different
 * speeds (reported ratios twice a day, insider filings once). The fundamentals
 * row drives the refresh: when it is fresh, whatever insider row sits beside it
 * is served as-is, and an absent one means the venue files none (`.JK` names),
 * not that the tally is zero.
 */
export async function loadFundamentals(symbol: string, ctx: PacketContext): Promise<LoadedFundamentals> {
  const cachedInsiders = () => readCached(ctx.db, symbol, "insiders");
  const fresh = readFresh(ctx.db, symbol, "fundamentals", ctx.nowIso);
  if (fresh) {
    const insiders = readFresh(ctx.db, symbol, "insiders", ctx.nowIso);
    return { fundamentals: fresh.payload, ...(insiders ? { insiders: insiders.payload } : {}), failures: [] };
  }
  const result = await fetchFundamentals(symbol, ctx.yahoo);
  if (result.failure) {
    // The vendor is down: serve whatever is on disk and say so, exactly as the other sections do.
    const stale = readCached(ctx.db, symbol, "fundamentals");
    const staleInsiders = stale ? cachedInsiders() : null;
    return {
      ...(stale ? { fundamentals: stale.payload } : {}),
      ...(staleInsiders ? { insiders: staleInsiders.payload } : {}),
      failures: [stale ? `${result.failure} (serving cached figures)` : result.failure],
    };
  }
  const ref: WatchRef = { source: "yahoo", sourceUrl: yahooQuoteUrl(symbol), observedAt: ctx.nowIso };
  if (result.fundamentals) {
    writeCached(ctx.db, symbol, "fundamentals", result.fundamentals, ref, result.fundamentals.observedAt);
  }
  if (result.insiders) {
    writeCached(ctx.db, symbol, "insiders", result.insiders, ref, result.insiders.observedAt);
  }
  return {
    ...(result.fundamentals ? { fundamentals: result.fundamentals } : {}),
    ...(result.insiders ? { insiders: result.insiders } : {}),
    failures: [],
  };
}

/* Sentiment */

export type LoadedSentiment = { sentiment?: TickerSentiment; failures: string[] };

/**
 * StockTwits and Reddit for one ticker, merged into core's sentiment section.
 *
 * A venue this ticker is not listed on is never called and never noted — it was
 * not asked. A venue that was asked and refused leaves its sub-section absent
 * with a failure beside it, so "we could not look" never reads as "nobody is
 * talking".
 */
export async function loadSentiment(symbol: string, ctx: PacketContext): Promise<LoadedSentiment> {
  const [twits, reddit] = await Promise.all([loadStocktwits(symbol, ctx), loadReddit(symbol, ctx)]);
  const failures = [...twits.failures, ...reddit.failures];
  const crowd = twits.row;
  const threads = reddit.row && !reddit.row.unavailable ? reddit.row : null;
  const samples = [...(crowd?.samples ?? []), ...(reddit.row?.samples ?? [])].slice(0, SENTIMENT_SAMPLES_MAX);
  if (!crowd && !threads && samples.length === 0) {
    return { failures };
  }
  return {
    sentiment: tickerSentimentSchema.parse({
      ...(crowd
        ? { stocktwits: { total: crowd.total, bullish: crowd.bullish, bearish: crowd.bearish, sampled: crowd.sampled } }
        : {}),
      ...(threads ? { reddit: { posts: threads.posts, subreddits: threads.subreddits } } : {}),
      samples,
      observedAt: crowd?.observedAt ?? reddit.row?.observedAt ?? ctx.nowIso,
    }),
    failures,
  };
}

async function loadStocktwits(symbol: string, ctx: PacketContext) {
  const venue = stocktwitsSymbol(symbol);
  if (!venue) {
    return { row: null, failures: [] as string[] };
  }
  const result = await resolveCached(ctx.db, symbol, "stocktwits", ctx.nowIso, async () => {
    const fetched = await fetchStocktwits(symbol, {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      now: ctx.now,
      timeoutMs: ctx.yahoo.timeoutMs,
    });
    if (!fetched.sentiment) {
      throw new Error((fetched.failure ?? "stocktwits: no data").replace(/^stocktwits: /, ""));
    }
    return {
      payload: fetched.sentiment,
      ref: webRef(stocktwitsStreamUrl(venue), fetched.sentiment.observedAt),
    };
  });
  const failure = result.failure && result.row ? `${result.failure} (serving cached mood)` : result.failure;
  return { row: result.row?.payload ?? null, failures: failure ? [failure] : [] };
}

async function loadReddit(symbol: string, ctx: PacketContext) {
  const plan = redditPlanFor(symbol);
  if (!plan) {
    return { row: null, failures: [] as string[] };
  }
  const extra: string[] = [];
  const result = await resolveCached(ctx.db, symbol, "reddit", ctx.nowIso, async () => {
    const fetched = await fetchReddit(symbol, {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      now: ctx.now,
      timeoutMs: ctx.yahoo.timeoutMs,
      ...(ctx.delay ? { delay: ctx.delay } : {}),
    });
    if (!fetched.sentiment) {
      throw new Error("no data returned");
    }
    extra.push(...fetched.failures);
    return {
      payload: fetched.sentiment,
      // The row spans several subreddits; the first one named is a stable, honest URL for it.
      ref: webRef(redditSearchUrl(plan.subs[0] as string, plan.query), fetched.sentiment.observedAt),
    };
  });
  const failure = result.failure && result.row ? `${result.failure} (serving cached threads)` : result.failure;
  return { row: result.row?.payload ?? null, failures: [...extra, ...(failure ? [failure] : [])] };
}

/* Global news */

export type LoadedGlobalNews = { items: GlobalNewsItem[]; failures: string[] };

/** The macro headline set for the run's language: one cached row, shared by every ticker in the packet. */
export async function loadGlobalNews(ctx: PacketContext): Promise<LoadedGlobalNews> {
  const queries = globalNewsQueries(ctx.language);
  const extra: string[] = [];
  const result = await resolveCached(ctx.db, globalNewsCacheKey(ctx.language), "global-news", ctx.nowIso, async () => {
    const fetched = await fetchGlobalNews(queries, { ...ctx.yahoo, perQuery: GLOBAL_NEWS_PER_QUERY });
    if (fetched.news.items.length === 0) {
      throw new Error(fetched.failures.join("; ") || "no macro headlines returned");
    }
    extra.push(...fetched.failures);
    return {
      payload: fetched.news,
      ref: { source: "yahoo" as const, sourceUrl: "https://finance.yahoo.com/news/", observedAt: fetched.news.observedAt },
    };
  });
  const failure = result.failure && result.row ? `${result.failure} (serving cached headlines)` : result.failure;
  return {
    items: (result.row?.payload.items ?? []).slice(0, GLOBAL_NEWS_MAX),
    failures: [...extra, ...(failure ? [failure] : [])],
  };
}

function numberOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Dominance is a share of the whole market, so it only means anything for BTC and ETH. */
function dominanceFor(ticker: string, global: CryptoGlobal | undefined): number | undefined {
  const base = ticker.split("-")[0]?.toUpperCase();
  if (base === "BTC") {
    return global?.btcDominancePct;
  }
  return base === "ETH" ? global?.ethDominancePct : undefined;
}

/**
 * The crypto section for one ticker in core's shape. `web` is the WatchSource
 * for a keyless HTTP provider; a null the vendor gave is dropped rather than
 * written as zero. Returns undefined when nothing at all was fetched.
 */
export function tickerCryptoFor(ticker: string, loaded: LoadedCrypto, observedAt: string): TickerCrypto | undefined {
  const market = loaded.markets.get(ticker);
  const dominancePct = dominanceFor(ticker, loaded.global);
  const fundingRatePct = loaded.funding.get(ticker);
  if (!market && dominancePct === undefined && fundingRatePct === undefined) {
    return undefined;
  }
  const section: TickerCrypto = {
    source: "web",
    observedAt: market?.observedAt ?? observedAt,
    ...(numberOrUndefined(market?.marketCapUsd) !== undefined
      ? { marketCapUsd: numberOrUndefined(market?.marketCapUsd) }
      : {}),
    ...(numberOrUndefined(market?.volume24hUsd) !== undefined
      ? { volume24hUsd: numberOrUndefined(market?.volume24hUsd) }
      : {}),
    ...(numberOrUndefined(market?.change7dPct) !== undefined
      ? { change7dPct: numberOrUndefined(market?.change7dPct) }
      : {}),
    ...(dominancePct !== undefined ? { dominancePct } : {}),
    ...(fundingRatePct !== undefined ? { fundingRatePct } : {}),
  };
  return section;
}

/* Assembly */

function settledValue<T>(result: PromiseSettledResult<T> | undefined, fallback: T): T {
  return result?.status === "fulfilled" ? result.value : fallback;
}

function settledFailure(result: PromiseSettledResult<unknown> | undefined, kind: string): string | null {
  return result?.status === "rejected"
    ? `${kind}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
    : null;
}

function chartFor(symbol: ResolvedSymbol, history: PriceHistory | null): TickerPacket["chart"] {
  return history && history.bars.length > 0 ? buildPriceChart(history, { title: `${symbol.yahoo} close` }) : null;
}

/** Every per-ticker section plus macro, loaded for one resolved watchlist. */
export type LoadedSections = {
  historyResults: PromiseSettledResult<LoadedHistory>[];
  histories: Map<string, PriceHistory | null>;
  technicals: Map<string, LoadedTechnical>;
  charts: Map<string, TickerPacket["chart"]>;
  newsResults: PromiseSettledResult<LoadedNews>[];
  macro: LoadedMacro;
  crypto: LoadedCrypto;
  fundamentalsResults: PromiseSettledResult<LoadedFundamentals>[];
  sentimentResults: PromiseSettledResult<LoadedSentiment>[];
  globalNews: LoadedGlobalNews;
};

/** resolving -> quotes: one batch that also validates the symbols. */
async function resolveWatchlist(inputs: readonly string[], ctx: PacketContext, progress: PacketProgress) {
  throwIfJobAborted(ctx.signal);
  progress("resolving", "Resolving tickers");
  const loaded = await loadQuotes(inputs, ctx);
  const quoteCount = loaded.quotes.size;
  const symbolCount = loaded.symbols.length;
  progress(
    "quotes",
    `${quoteCount} quote${quoteCount === 1 ? "" : "s"} for ${symbolCount} ticker${symbolCount === 1 ? "" : "s"}`,
  );
  return loaded;
}

/** histories, headlines, macro in parallel -> technicals -> charts, in phase order. */
async function loadSections(
  symbols: readonly ResolvedSymbol[],
  ctx: PacketContext,
  progress: PacketProgress,
): Promise<LoadedSections> {
  throwIfJobAborted(ctx.signal);
  const months = historyMonthsFor(ctx);
  const cap = headlineCapFor(ctx);
  const historiesPending = hasSource(ctx, "history")
    ? mapLimit(symbols, ctx.concurrency, (symbol) => loadHistory(symbol.yahoo, ctx, months))
    : Promise.resolve(symbols.map(() => skipped(NO_HISTORY)));
  const newsPending = ctx.include.news
    ? mapLimit(symbols, ctx.concurrency, (symbol) => loadNews(symbol, ctx, cap))
    : Promise.resolve(symbols.map(() => skipped(NO_NEWS)));
  const macroPending = ctx.include.macro ? loadMacro(ctx) : Promise.resolve(NO_MACRO);
  const cryptoPending = hasSource(ctx, "crypto") ? loadCrypto(symbols, ctx) : Promise.resolve(NO_CRYPTO);
  // The analyst-team sources. Each is gated by the desk's harness, so a scanner never pays for any of them.
  const fundamentalsPending = hasSource(ctx, "fundamentals")
    ? mapLimit(symbols, ctx.concurrency, (symbol) => loadFundamentals(symbol.yahoo, ctx))
    : Promise.resolve(symbols.map(() => skipped(NO_FUNDAMENTALS)));
  const sentimentPending = hasSource(ctx, "sentiment")
    ? mapLimit(symbols, ctx.concurrency, (symbol) => loadSentiment(symbol.yahoo, ctx))
    : Promise.resolve(symbols.map(() => skipped(NO_SENTIMENT)));
  const globalNewsPending = hasSource(ctx, "globalNews") ? loadGlobalNews(ctx) : Promise.resolve(NO_GLOBAL_NEWS);

  const historyResults = await historiesPending;
  const histories = new Map(
    symbols.map((symbol, index) => [
      symbol.yahoo,
      settledValue(historyResults[index], { history: null, failure: null }).history,
    ]),
  );
  throwIfJobAborted(ctx.signal);
  const wantsTechnicals = hasSource(ctx, "technicals");
  if (wantsTechnicals) {
    progress("technicals", "Computing technicals and reading TradingView ratings");
  }
  const technicals = wantsTechnicals
    ? await loadTechnicals(symbols, histories, ctx)
    : new Map<string, LoadedTechnical>();

  progress("charts", "Building a chart per ticker");
  const charts = new Map(
    symbols.map((symbol) => [symbol.yahoo, chartFor(symbol, histories.get(symbol.yahoo) ?? null)]),
  );

  if (ctx.include.news) {
    progress("news", "Reading headlines");
  }
  const newsResults = await newsPending;

  if (ctx.include.macro) {
    progress("macro", "Reading macro levels");
  }
  const macro = await macroPending;
  const crypto = await cryptoPending;
  const fundamentalsResults = await fundamentalsPending;
  const sentimentResults = await sentimentPending;
  const globalNews = await globalNewsPending;
  return {
    historyResults,
    histories,
    technicals,
    charts,
    newsResults,
    macro,
    crypto,
    fundamentalsResults,
    sentimentResults,
    globalNews,
  };
}

function tickerPacketFor(
  symbol: ResolvedSymbol,
  index: number,
  loaded: LoadedQuotes,
  sections: LoadedSections,
  ctx: Pick<PacketContext, "harness" | "nowIso">,
) {
  const history = sections.historyResults[index];
  const news = sections.newsResults[index];
  const technical = sections.technicals.get(symbol.yahoo) ?? { technical: null, failures: [] };
  const failures = [
    loaded.stale.get(symbol.yahoo) ?? null,
    settledValue(history, { history: null, failure: null }).failure ?? settledFailure(history, "history"),
    ...technical.failures,
    settledValue(news, { news: [], failure: null }).failure ?? settledFailure(news, "news"),
  ].filter((entry): entry is string => entry !== null);
  const priceHistory = sections.histories.get(symbol.yahoo) ?? null;
  const crypto = hasSource(ctx, "crypto") ? tickerCryptoFor(symbol.yahoo, sections.crypto, ctx.nowIso) : undefined;
  const company = settledValue(sections.fundamentalsResults[index], NO_FUNDAMENTALS);
  const crowd = settledValue(sections.sentimentResults[index], NO_SENTIMENT);
  failures.push(
    ...company.failures,
    ...crowd.failures,
    ...[
      settledFailure(sections.fundamentalsResults[index], "fundamentals"),
      settledFailure(sections.sentimentResults[index], "sentiment"),
    ].filter((entry): entry is string => entry !== null),
  );
  return {
    symbol,
    quote: loaded.quotes.get(symbol.yahoo) ?? null,
    technical: technical.technical,
    history: priceHistory,
    chart: sections.charts.get(symbol.yahoo) ?? null,
    news: settledValue(news, { news: [], failure: null }).news,
    // Dated pivot levels for the Elliott Wave agent; computed here so the model never eyeballs a chart.
    ...(hasSource(ctx, "swings") ? { swings: swingPoints(priceHistory?.bars ?? []) } : {}),
    ...(crypto ? { crypto } : {}),
    ...(company.fundamentals ? { fundamentals: company.fundamentals } : {}),
    ...(company.insiders ? { insiders: company.insiders } : {}),
    ...(crowd.sentiment ? { sentiment: crowd.sentiment } : {}),
    failures,
  };
}

/** One TickerPacket per resolved symbol; a section that failed leaves a note in `failures`. Pure. */
export function assembleTickerPackets(
  loaded: LoadedQuotes,
  sections: LoadedSections,
  ctx: Pick<PacketContext, "harness" | "nowIso">,
): TickerPacket[] {
  return loaded.symbols.map((symbol, index) => tickerPacketFor(symbol, index, loaded, sections, ctx));
}

/**
 * The sections computed in code from what was already fetched. They run after
 * the base packet is parsed, so `computeSignals` / `computeRotation` see the
 * same validated rows the model will. Each is listed by the desk's harness;
 * a desk that does not list one simply does not carry it.
 */
function computedSections(base: MarketWatchPacket, ctx: PacketContext): Partial<MarketWatchPacket> {
  const tickers = base.tickers.map((ticker) => ticker.symbol.yahoo);
  const metals = hasSource(ctx, "metals") ? deriveMetals(base.tickers, base.macro, ctx.nowIso) : undefined;
  return {
    // `deriveMetals` may also produce a GLD-proxy premium. Core's metals schema now carries
    // it under its own name (`goldFuturesVsGldPct`), so it reaches the packet as itself and
    // is still never passed off as a spot basis.
    ...(metals ? { metals } : {}),
    ...(hasSource(ctx, "signals") ? { signals: computeSignals(base) } : {}),
    ...(hasSource(ctx, "rotation") ? { rotation: computeRotation(base) } : {}),
    ...(hasSource(ctx, "sessions") ? { sessions: computeSessions(ctx.now(), tickers) } : {}),
  };
}

export async function buildMarketWatchPacket(
  db: Database.Database,
  request: Pick<MarketWatchRequest, "tickers" | "positionContext"> &
    Partial<Pick<MarketWatchRequest, "specialist" | "language">>,
  opts: BuildPacketOptions = {},
): Promise<PacketBuild> {
  const ctx = packetContext(db, {
    ...opts,
    specialist: opts.specialist ?? request.specialist,
    language: opts.language ?? request.language,
  });
  const progress: PacketProgress = opts.onProgress ?? (() => {});

  const loaded = await resolveWatchlist(request.tickers, ctx, progress);
  const sections = await loadSections(loaded.symbols, ctx, progress);
  const tickers = assembleTickerPackets(loaded, sections, ctx);

  const base = marketWatchPacketSchema.parse({
    tickers,
    macro: sections.macro.macro,
    clock: marketClock(ctx.now()),
    ...(sections.crypto.global ? { cryptoGlobal: { ...sections.crypto.global, source: "web" as const } } : {}),
    ...(sections.globalNews.items.length > 0 ? { globalNews: sections.globalNews.items } : {}),
    positionContext: request.positionContext,
  });
  const packet = marketWatchPacketSchema.parse({ ...base, ...computedSections(base, ctx) });
  return {
    packet,
    failures: [
      ...loaded.failures,
      ...(sections.macro.failure ? [sections.macro.failure] : []),
      ...sections.crypto.failures,
      ...sections.globalNews.failures,
    ],
  };
}
