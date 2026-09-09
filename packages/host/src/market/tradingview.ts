/**
 * TradingView scanner client: technical rating (Recommend.All / MA / Other)
 * plus RSI, moving averages, MACD, and 52-week range per symbol.
 *
 * Vendor client in the shape of the Tavily one in core's web-search: bare
 * `fetch` to one fixed HTTPS host, JSON in and out, ADAPTER_TIMEOUT_MS merged
 * with the caller's signal. `fetchImpl` is injectable so tests use fixtures.
 *
 * Terms risk: `scanner.tradingview.com/{market}/scan` is the endpoint the
 * TradingView screener page calls; it answers unauthenticated today but is not
 * a documented API and may change or be gated at any time. Callers must treat
 * it as best-effort and fall back to `computeTechnical` over Yahoo bars when
 * it fails; nothing in the product depends on it being available.
 *
 * Schema drift (no `data` array, a row without `s`, or a `d` vector that is not
 * one value per requested column) throws AdapterSchemaError instead of reading
 * a value from the wrong column.
 */
import {
  tradingViewLabel,
  tradingViewMarket,
  tradingViewRatingSchema,
  type TradingViewRating,
  type WatchRef,
} from "@agentforge/core/market";
import { errorMessage, withTimeout } from "./abort";
import { AdapterSchemaError } from "./errors";

export const TRADINGVIEW_SCANNER_ORIGIN = "https://scanner.tradingview.com";
export const TRADINGVIEW_USER_AGENT = "Mozilla/5.0";

/** Column order is the contract with `parseScanResponse`; the `d` vector is read by index. */
export const TRADINGVIEW_COLUMNS = [
  "Recommend.All",
  "Recommend.MA",
  "Recommend.Other",
  "RSI",
  "close",
  "change",
  "volume",
  "EMA200",
  "SMA50",
  "SMA200",
  "MACD.macd",
  "MACD.signal",
  "price_52_week_high",
  "price_52_week_low",
] as const;

const ADAPTER = "tradingview.scan";

export type TradingViewIndicators = TradingViewRating & {
  symbol: string;
  rsi: number | null;
  close: number | null;
  changePercent: number | null;
  volume: number | null;
  ema200: number | null;
  sma50: number | null;
  sma200: number | null;
  macd: number | null;
  macdSignal: number | null;
  high52w: number | null;
  low52w: number | null;
  ref: WatchRef;
};

export type FetchTradingViewOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  now?: () => Date;
  timeoutMs?: number;
};

export type TradingViewRatingsResult = {
  ratings: Map<string, TradingViewIndicators>;
  /** "SYMBOL: reason" or "market: reason" per symbol or market that produced nothing. */
  failures: string[];
};

/** "NASDAQ:MU" -> https://www.tradingview.com/symbols/NASDAQ-MU/technicals/ */
export function tradingViewTechnicalsUrl(tvSymbol: string): string {
  return `https://www.tradingview.com/symbols/${encodeURIComponent(tvSymbol.replace(":", "-"))}/technicals/`;
}

export function scanUrl(market: string): string {
  return `${TRADINGVIEW_SCANNER_ORIGIN}/${encodeURIComponent(market)}/scan`;
}

export function scanBody(tickers: readonly string[]): string {
  return JSON.stringify({
    symbols: { tickers: [...tickers], query: { types: [] } },
    columns: [...TRADINGVIEW_COLUMNS],
  });
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function score(value: unknown): number | null {
  const parsed = finite(value);
  return parsed === null ? null : Math.max(-1, Math.min(1, parsed));
}

function rowToIndicators(symbol: string, values: readonly unknown[], observedAt: string): TradingViewIndicators {
  const at = (column: (typeof TRADINGVIEW_COLUMNS)[number]) => values[TRADINGVIEW_COLUMNS.indexOf(column)];
  const summary = score(at("Recommend.All"));
  const rating = tradingViewRatingSchema.parse({
    summary,
    movingAverages: score(at("Recommend.MA")),
    oscillators: score(at("Recommend.Other")),
    label: summary === null ? "" : tradingViewLabel(summary),
  });
  return {
    ...rating,
    symbol,
    rsi: finite(at("RSI")),
    close: finite(at("close")),
    changePercent: finite(at("change")),
    volume: finite(at("volume")),
    ema200: finite(at("EMA200")),
    sma50: finite(at("SMA50")),
    sma200: finite(at("SMA200")),
    macd: finite(at("MACD.macd")),
    macdSignal: finite(at("MACD.signal")),
    high52w: finite(at("price_52_week_high")),
    low52w: finite(at("price_52_week_low")),
    ref: { source: "tradingview", sourceUrl: tradingViewTechnicalsUrl(symbol), observedAt },
  };
}

/** One scan response for one market. Rows for symbols that were not asked for are ignored. */
export function parseScanResponse(
  market: string,
  payload: unknown,
  tickers: readonly string[],
  observedAt: string,
): Map<string, TradingViewIndicators> {
  const root = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (!Array.isArray(root.data)) {
    throw new AdapterSchemaError(ADAPTER, market, ["data"]);
  }
  const wanted = new Set(tickers);
  const out = new Map<string, TradingViewIndicators>();
  root.data.forEach((raw, index) => {
    const row = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const symbol = typeof row.s === "string" ? row.s : "";
    if (!symbol) {
      throw new AdapterSchemaError(ADAPTER, market, [`data[${index}].s`]);
    }
    if (!Array.isArray(row.d) || row.d.length !== TRADINGVIEW_COLUMNS.length) {
      throw new AdapterSchemaError(ADAPTER, symbol, [`data[${index}].d[${TRADINGVIEW_COLUMNS.length}]`]);
    }
    if (wanted.has(symbol)) {
      out.set(symbol, rowToIndicators(symbol, row.d, observedAt));
    }
  });
  return out;
}

async function scanMarket(
  market: string,
  tickers: readonly string[],
  observedAt: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Map<string, TradingViewIndicators>> {
  const response = await fetchImpl(scanUrl(market), {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": TRADINGVIEW_USER_AGENT, Accept: "application/json" },
    body: scanBody(tickers),
    signal,
  });
  if (!response.ok) {
    throw new Error(`TradingView returned HTTP ${response.status}`);
  }
  return parseScanResponse(market, await response.json(), tickers, observedAt);
}

function groupByMarket(tvSymbols: readonly string[]): { groups: Map<string, string[]>; failures: string[] } {
  const groups = new Map<string, string[]>();
  const failures: string[] = [];
  for (const symbol of new Set(tvSymbols)) {
    const market = tradingViewMarket(symbol);
    if (!market) {
      failures.push(`${symbol}: no TradingView market for this exchange`);
      continue;
    }
    groups.set(market, [...(groups.get(market) ?? []), symbol]);
  }
  return { groups, failures };
}

/**
 * Ratings for "EXCHANGE:SYMBOL" keys, one scan per TradingView market. A
 * market that fails (network, HTTP, schema drift) is one failure string; the
 * other markets still return. Symbols the scanner omitted are failures too.
 */
export async function fetchTradingViewRatings(
  tvSymbols: readonly string[],
  opts: FetchTradingViewOptions = {},
): Promise<TradingViewRatingsResult> {
  const { groups, failures } = groupByMarket(tvSymbols);
  const ratings = new Map<string, TradingViewIndicators>();
  if (groups.size === 0) {
    return { ratings, failures };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const observedAt = (opts.now ?? (() => new Date()))().toISOString();
  const { signal, dispose } = withTimeout(opts.signal, opts.timeoutMs);
  try {
    const settled = await Promise.allSettled(
      [...groups].map(async ([market, tickers]) => ({
        market,
        tickers,
        rows: await scanMarket(market, tickers, observedAt, fetchImpl, signal),
      })),
    );
    settled.forEach((result, index) => {
      const [market, tickers] = [...groups][index] as [string, string[]];
      if (result.status === "rejected") {
        failures.push(`${market}: ${errorMessage(result.reason)}`);
        return;
      }
      for (const [symbol, row] of result.value.rows) {
        ratings.set(symbol, row);
      }
      for (const symbol of tickers) {
        if (!result.value.rows.has(symbol)) {
          failures.push(`${symbol}: not in the TradingView scan`);
        }
      }
    });
    return { ratings, failures };
  } finally {
    dispose();
  }
}
