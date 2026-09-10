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
  buildPriceChart,
  computeTechnical,
  marketClock,
  marketWatchPacketSchema,
  technicalSchema,
  tradingViewMarket,
  type MacroSnapshot,
  type MarketWatchPacket,
  type MarketWatchRequest,
  type PriceHistory,
  type Quote,
  type ResolvedSymbol,
  type Technical,
  type TickerPacket,
  type WatchNewsItem,
  type WatchRef,
} from "@agentforge/core/market";
import { throwIfJobAborted } from "../job-stream";
import { fetchMacro } from "./macro";
import { MAP_LIMIT_DEFAULT, mapLimit } from "./map-limit";
import {
  MACRO_CACHE_KEY,
  historyCacheKey,
  readCached,
  readFresh,
  resolveCached,
  writeCached,
  type CachedRow,
} from "./repo";
import { fetchTradingViewRatings, type TradingViewIndicators } from "./tradingview";
import {
  HISTORY_MONTHS_DEFAULT,
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

const NO_NEWS: LoadedNews = { news: [], failure: null };
const NO_MACRO: LoadedMacro = { macro: { quotes: [], failures: [] }, failure: null };

function skipped<T>(value: T): PromiseSettledResult<T> {
  return { status: "fulfilled", value };
}

export type PacketClients = {
  yahoo?: YahooClient;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type BuildPacketOptions = {
  now?: () => Date;
  clients?: PacketClients;
  signal?: AbortSignal;
  onProgress?: PacketProgress;
  /** Fetches in flight per kind. */
  concurrency?: number;
  /** Sections to fetch; defaults to all. */
  include?: Partial<PacketSections>;
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
};

export function packetContext(db: Database.Database, opts: BuildPacketOptions = {}): PacketContext {
  const now = opts.now ?? (() => new Date());
  return {
    db,
    now,
    nowIso: now().toISOString(),
    yahoo: { client: opts.clients?.yahoo, signal: opts.signal, now, timeoutMs: opts.clients?.timeoutMs },
    fetchImpl: opts.clients?.fetchImpl ?? fetch,
    signal: opts.signal,
    concurrency: opts.concurrency ?? MAP_LIMIT_DEFAULT,
    include: { news: opts.include?.news ?? ALL_SECTIONS.news, macro: opts.include?.macro ?? ALL_SECTIONS.macro },
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
  const historiesPending = mapLimit(symbols, ctx.concurrency, (symbol) => loadHistory(symbol.yahoo, ctx));
  const newsPending = ctx.include.news
    ? mapLimit(symbols, ctx.concurrency, (symbol) => loadNews(symbol, ctx))
    : Promise.resolve(symbols.map(() => skipped(NO_NEWS)));
  const macroPending = ctx.include.macro ? loadMacro(ctx) : Promise.resolve(NO_MACRO);

  const historyResults = await historiesPending;
  const histories = new Map(
    symbols.map((symbol, index) => [
      symbol.yahoo,
      settledValue(historyResults[index], { history: null, failure: null }).history,
    ]),
  );
  throwIfJobAborted(ctx.signal);
  progress("technicals", "Computing technicals and reading TradingView ratings");
  const technicals = await loadTechnicals(symbols, histories, ctx);

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
  return { historyResults, histories, technicals, charts, newsResults, macro };
}

function tickerPacketFor(symbol: ResolvedSymbol, index: number, loaded: LoadedQuotes, sections: LoadedSections) {
  const history = sections.historyResults[index];
  const news = sections.newsResults[index];
  const technical = sections.technicals.get(symbol.yahoo) ?? { technical: null, failures: [] };
  const failures = [
    loaded.stale.get(symbol.yahoo) ?? null,
    settledValue(history, { history: null, failure: null }).failure ?? settledFailure(history, "history"),
    ...technical.failures,
    settledValue(news, { news: [], failure: null }).failure ?? settledFailure(news, "news"),
  ].filter((entry): entry is string => entry !== null);
  return {
    symbol,
    quote: loaded.quotes.get(symbol.yahoo) ?? null,
    technical: technical.technical,
    history: sections.histories.get(symbol.yahoo) ?? null,
    chart: sections.charts.get(symbol.yahoo) ?? null,
    news: settledValue(news, { news: [], failure: null }).news,
    failures,
  };
}

/** One TickerPacket per resolved symbol; a section that failed leaves a note in `failures`. Pure. */
export function assembleTickerPackets(loaded: LoadedQuotes, sections: LoadedSections): TickerPacket[] {
  return loaded.symbols.map((symbol, index) => tickerPacketFor(symbol, index, loaded, sections));
}

export async function buildMarketWatchPacket(
  db: Database.Database,
  request: Pick<MarketWatchRequest, "tickers" | "positionContext">,
  opts: BuildPacketOptions = {},
): Promise<PacketBuild> {
  const ctx = packetContext(db, opts);
  const progress: PacketProgress = opts.onProgress ?? (() => {});

  const loaded = await resolveWatchlist(request.tickers, ctx, progress);
  const sections = await loadSections(loaded.symbols, ctx, progress);
  const tickers = assembleTickerPackets(loaded, sections);

  const packet = marketWatchPacketSchema.parse({
    tickers,
    macro: sections.macro.macro,
    clock: marketClock(ctx.now()),
    positionContext: request.positionContext,
  });
  return { packet, failures: [...loaded.failures, ...(sections.macro.failure ? [sections.macro.failure] : [])] };
}
