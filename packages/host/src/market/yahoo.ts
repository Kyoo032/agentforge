/**
 * Yahoo Finance adapter over `yahoo-finance2` (MIT) for Market Watch v2: batch
 * quotes for any symbol Yahoo knows (equities, futures, indices, FX), daily
 * bars for a chart and computed technicals, and headlines through `search`.
 *
 * - Every row carries a WatchRef (source, URL, observed time).
 * - Missing keys a row depends on throw AdapterSchemaError; nothing is guessed.
 * - Every call runs under ADAPTER_TIMEOUT_MS merged with the caller's signal.
 * - The client is injectable so tests run on recorded fixtures, never sockets.
 * - Unknown symbols are failure strings from `resolveSymbols`, never a throw.
 */
import YahooFinance from "yahoo-finance2";
import {
  HISTORY_BARS_MAX,
  NEWS_PER_TICKER_MAX,
  isHttpUrl,
  normalizeTickerInput,
  priceHistorySchema,
  quoteSchema,
  resolvedSymbolSchema,
  toTradingViewSymbol,
  toYahooSymbol,
  watchNewsItemSchema,
  type MarketState,
  type PriceHistory,
  type Quote,
  type ResolvedSymbol,
  type WatchNewsItem,
  type WatchRef,
} from "@agentforge/core/market";
import { errorMessage, withTimeout } from "./abort";
import { AdapterSchemaError } from "./errors";
import { sanitizeExternalText } from "./sanitize";

/**
 * 36 months, not 24. The 2Y chart window is 504 bars and SMA200 needs 199
 * bars of lead-in before the first plotted point, so a 24-month fetch (~500
 * bars) leaves the 2Y window without its moving averages. 36 months is ~756
 * bars, inside HISTORY_BARS_MAX (800), and covers 504 + 199 with room to spare.
 */
export const HISTORY_MONTHS_DEFAULT = 36;
export const HISTORY_MONTHS_MAX = 36;
export const NEWS_COUNT_DEFAULT = NEWS_PER_TICKER_MAX;

const ADAPTER_QUOTE = "yahoo.quote";
const ADAPTER_CHART = "yahoo.chart";
const ADAPTER_SEARCH = "yahoo.search";

export type YahooChartRange = { period1: Date; period2: Date };

export type YahooClient = {
  quote(symbols: readonly string[], signal: AbortSignal): Promise<unknown>;
  chart(symbol: string, range: YahooChartRange, signal: AbortSignal): Promise<unknown>;
  search(query: string, newsCount: number, signal: AbortSignal): Promise<unknown>;
  /** Company profile, valuation, margins and insider filings; see `fundamentals.ts` for the modules. */
  quoteSummary(symbol: string, modules: readonly string[], signal: AbortSignal): Promise<unknown>;
};

export type YahooFetchOptions = {
  client?: YahooClient;
  signal?: AbortSignal;
  now?: () => Date;
  timeoutMs?: number;
};

export type ResolveSymbolsResult = {
  symbols: ResolvedSymbol[];
  /** The quotes read while validating, so the caller need not fetch the batch twice. */
  quotes: Quote[];
  /** "input: reason" per input that did not resolve. */
  failures: string[];
};

export function yahooQuoteUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

type YahooFinanceInstance = InstanceType<typeof YahooFinance>;
let shared: YahooFinanceInstance | null = null;

function instance(): YahooFinanceInstance {
  if (!shared) {
    shared = new YahooFinance({
      suppressNotices: ["yahooSurvey", "ripHistorical"],
      versionCheck: false,
      validation: { logErrors: false, logOptionsErrors: false },
    });
  }
  return shared;
}

/** Production client: hard-coded HTTPS host inside the library, abort signal per request. */
export function createYahooClient(): YahooClient {
  return {
    quote: (symbols, signal) => instance().quote([...symbols], {}, { fetchOptions: { signal } }),
    chart: (symbol, range, signal) =>
      instance().chart(
        symbol,
        { period1: range.period1, period2: range.period2, interval: "1d" },
        { fetchOptions: { signal } },
      ),
    search: (query, newsCount, signal) => instance().search(query, { newsCount }, { fetchOptions: { signal } }),
    quoteSummary: (symbol, modules, signal) =>
      instance().quoteSummary(symbol, { modules: [...modules] as never }, { fetchOptions: { signal } }),
  };
}

/* Loose readers over the vendor payload: validated results give plain numbers and Dates, raw ones give {raw, fmt}. */

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const cell = rec(value);
  return cell && typeof cell.raw === "number" && Number.isFinite(cell.raw) ? cell.raw : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  const cell = rec(value);
  return cell ? toDate(cell.raw ?? cell.fmt) : null;
}

function resolveOptions(opts: YahooFetchOptions) {
  return {
    client: opts.client ?? createYahooClient(),
    now: opts.now ?? (() => new Date()),
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
  };
}

function refFor(symbol: string, observedAt: string): WatchRef {
  return { source: "yahoo", sourceUrl: yahooQuoteUrl(symbol), observedAt };
}

/* Quotes */

/** Yahoo's six states onto the schema's five: the extended-hours "outer" states are closed. */
export function marketStateOf(raw: unknown): MarketState {
  switch (raw) {
    case "PRE":
    case "REGULAR":
    case "POST":
    case "CLOSED":
      return raw;
    case "PREPRE":
    case "POSTPOST":
      return "CLOSED";
    default:
      return "UNKNOWN";
  }
}

export function parseQuote(row: unknown, observedAt: string): Quote {
  const record = rec(row) ?? {};
  const symbol = str(record.symbol);
  if (!symbol) {
    throw new AdapterSchemaError(ADAPTER_QUOTE, "?", ["symbol"]);
  }
  return quoteSchema.parse({
    symbol,
    name: str(record.shortName) || str(record.longName),
    price: num(record.regularMarketPrice),
    changePercent: num(record.regularMarketChangePercent),
    previousClose: num(record.regularMarketPreviousClose),
    preMarketPrice: num(record.preMarketPrice),
    preMarketChangePercent: num(record.preMarketChangePercent),
    postMarketPrice: num(record.postMarketPrice),
    postMarketChangePercent: num(record.postMarketChangePercent),
    volume: num(record.regularMarketVolume),
    marketCap: num(record.marketCap),
    marketState: marketStateOf(record.marketState),
    currency: str(record.currency),
    exchange: str(record.exchange),
    ref: refFor(symbol, observedAt),
  });
}

/** Rows in the order the symbols were asked for; symbols Yahoo did not return are absent. */
export function parseQuotes(payload: unknown, symbols: readonly string[], observedAt: string): Quote[] {
  if (!Array.isArray(payload)) {
    throw new AdapterSchemaError(ADAPTER_QUOTE, symbols.join(","), ["array"]);
  }
  const bySymbol = new Map(
    payload.map((row) => parseQuote(row, observedAt)).map((quote) => [quote.symbol.toUpperCase(), quote]),
  );
  return symbols.flatMap((symbol) => {
    const quote = bySymbol.get(symbol.toUpperCase());
    return quote ? [quote] : [];
  });
}

function unique(symbols: readonly string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))];
}

/** One `quote()` batch. Empty input is an empty result without a network call. */
export async function fetchQuotes(symbols: readonly string[], opts: YahooFetchOptions = {}): Promise<Quote[]> {
  const wanted = unique(symbols);
  if (wanted.length === 0) {
    return [];
  }
  const { client, now, timeoutMs } = resolveOptions(opts);
  const { signal, dispose } = withTimeout(opts.signal, timeoutMs);
  try {
    const payload = await client.quote(wanted, signal);
    return parseQuotes(payload, wanted, now().toISOString());
  } finally {
    dispose();
  }
}

/* History */

function localDate(date: Date, gmtOffsetSeconds: number): string {
  return new Date(date.getTime() + gmtOffsetSeconds * 1000).toISOString().slice(0, 10);
}

type Bar = PriceHistory["bars"][number];

function parseBar(symbol: string, raw: unknown, index: number, offset: number): Bar | null {
  const row = rec(raw) ?? {};
  const date = toDate(row.date);
  if (!date) {
    throw new AdapterSchemaError(ADAPTER_CHART, symbol, [`quotes[${index}].date`]);
  }
  const open = num(row.open);
  const high = num(row.high);
  const low = num(row.low);
  const close = num(row.close);
  if (open === null || high === null || low === null || close === null) {
    return null;
  }
  return { date: localDate(date, offset), open, high, low, close, volume: Math.max(0, num(row.volume) ?? 0) };
}

/**
 * Daily bars in exchange-local dates, ascending, one per date (the later row
 * wins), capped to the newest HISTORY_BARS_MAX. Rows with a null OHLC
 * (holidays, half-days without a print) are skipped, never zero-filled.
 */
export function parseHistory(symbol: string, chart: unknown, observedAt: string): PriceHistory {
  const root = rec(chart) ?? {};
  const quotes = Array.isArray(root.quotes) ? root.quotes : null;
  if (!quotes) {
    throw new AdapterSchemaError(ADAPTER_CHART, symbol, ["quotes"]);
  }
  const offset = num(rec(root.meta)?.gmtoffset) ?? 0;
  const byDate = new Map<string, Bar>();
  quotes.forEach((raw, index) => {
    const bar = parseBar(symbol, raw, index, offset);
    if (bar) {
      byDate.set(bar.date, bar);
    }
  });
  const bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_BARS_MAX);
  return priceHistorySchema.parse({ symbol, interval: "1d", bars, ref: refFor(symbol, observedAt) });
}

export function historyRange(now: Date, months: number): YahooChartRange {
  const period1 = new Date(now.getTime());
  period1.setUTCMonth(period1.getUTCMonth() - months);
  return { period1, period2: now };
}

export type FetchHistoryOptions = YahooFetchOptions & { months?: number };

export async function fetchHistory(symbol: string, opts: FetchHistoryOptions = {}): Promise<PriceHistory> {
  const months = Math.max(1, Math.min(HISTORY_MONTHS_MAX, Math.floor(opts.months ?? HISTORY_MONTHS_DEFAULT) || 1));
  const { client, now, timeoutMs } = resolveOptions(opts);
  const { signal, dispose } = withTimeout(opts.signal, timeoutMs);
  try {
    const at = now();
    const payload = await client.chart(symbol, historyRange(at, months), signal);
    return parseHistory(symbol, payload, at.toISOString());
  } finally {
    dispose();
  }
}

/* News */

function parseNewsItem(raw: unknown, ref: WatchRef): WatchNewsItem | null {
  const row = rec(raw) ?? {};
  const title = sanitizeExternalText(str(row.title));
  const link = str(row.link);
  if (!title.text || !isHttpUrl(link)) {
    return null;
  }
  const publishedAt = toDate(row.providerPublishTime)?.toISOString() ?? null;
  return watchNewsItemSchema.parse({
    title: title.text,
    summary: "",
    link,
    publisher: sanitizeExternalText(str(row.publisher)).text,
    publishedAt,
    ref,
    injectionSuspect: title.injectionSuspect,
  });
}

/** Headlines from a `search` result. Items without a usable title or HTTP link are dropped. */
export function parseNews(symbol: string, payload: unknown, observedAt: string, count: number): WatchNewsItem[] {
  const root = rec(payload) ?? {};
  const news = Array.isArray(root.news) ? root.news : null;
  if (!news) {
    throw new AdapterSchemaError(ADAPTER_SEARCH, symbol, ["news"]);
  }
  const ref = refFor(symbol, observedAt);
  return news
    .map((raw) => parseNewsItem(raw, ref))
    .filter((item): item is WatchNewsItem => item !== null)
    .slice(0, count);
}

export type FetchNewsOptions = YahooFetchOptions & { count?: number };

/**
 * Headlines for a symbol. The symbol is searched first (Yahoo tags news by
 * ticker); when that returns nothing and a company name is known, the name is
 * searched once more.
 */
export async function fetchNewsFor(
  symbol: string,
  name: string,
  opts: FetchNewsOptions = {},
): Promise<WatchNewsItem[]> {
  const count = Math.max(1, Math.min(NEWS_PER_TICKER_MAX, Math.floor(opts.count ?? NEWS_COUNT_DEFAULT) || 1));
  const { client, now, timeoutMs } = resolveOptions(opts);
  const { signal, dispose } = withTimeout(opts.signal, timeoutMs);
  try {
    const observedAt = now().toISOString();
    const bySymbol = parseNews(symbol, await client.search(symbol, count, signal), observedAt, count);
    if (bySymbol.length > 0 || !name.trim()) {
      return bySymbol;
    }
    return parseNews(symbol, await client.search(name.trim(), count, signal), observedAt, count);
  } finally {
    dispose();
  }
}

/* Resolution */

export type Candidate = { input: string; yahoo: string };

/**
 * Each input through core's normalizer (which splits free text such as
 * "MU, NVDA" into tokens) and the IDX alias map. An input that yields one
 * token keeps the user's spelling as `input`; a multi-token input contributes
 * one candidate per token. Duplicates collapse to the first.
 */
export function symbolCandidates(inputs: readonly string[]): { wanted: Candidate[]; failures: string[] } {
  const seen = new Set<string>();
  const wanted: Candidate[] = [];
  const failures: string[] = [];
  for (const input of inputs) {
    const tokens = normalizeTickerInput(input);
    if (tokens.length === 0) {
      failures.push(`${input.trim() || "(empty)"}: not a ticker`);
      continue;
    }
    for (const token of tokens) {
      const yahoo = toYahooSymbol(token);
      if (!seen.has(yahoo)) {
        seen.add(yahoo);
        wanted.push({ input: tokens.length === 1 ? input : token, yahoo });
      }
    }
  }
  return { wanted, failures };
}

export function resolvedFromQuote(input: string, quote: Quote): ResolvedSymbol {
  return resolvedSymbolSchema.parse({
    input,
    yahoo: quote.symbol,
    tradingview: toTradingViewSymbol(quote.symbol, quote.exchange),
    name: quote.name,
    exchange: quote.exchange,
    currency: quote.currency,
  });
}

/**
 * Normalize the user's inputs, map IDX aliases to Yahoo symbols, and validate
 * them with one `quote()` batch. Duplicates collapse to the first input. A
 * symbol Yahoo does not return is a failure string; a failed batch fails every
 * input with the same reason.
 */
export async function resolveSymbols(
  inputs: readonly string[],
  opts: YahooFetchOptions = {},
): Promise<ResolveSymbolsResult> {
  const { wanted, failures } = symbolCandidates(inputs);
  if (wanted.length === 0) {
    return { symbols: [], quotes: [], failures };
  }
  let quotes: Quote[];
  try {
    quotes = await fetchQuotes(
      wanted.map((entry) => entry.yahoo),
      opts,
    );
  } catch (error) {
    const reason = errorMessage(error);
    return { symbols: [], quotes: [], failures: [...failures, ...wanted.map((entry) => `${entry.input}: ${reason}`)] };
  }
  const bySymbol = new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote]));
  const symbols: ResolvedSymbol[] = [];
  for (const entry of wanted) {
    const quote = bySymbol.get(entry.yahoo.toUpperCase());
    if (quote) {
      symbols.push(resolvedFromQuote(entry.input, quote));
    } else {
      failures.push(`${entry.input}: unknown symbol (Yahoo Finance returned no quote for ${entry.yahoo})`);
    }
  }
  return { symbols, quotes, failures };
}
