"use client";

import { MarketPriceChart } from "@/components/market-price-chart";
import {
  formatNumber,
  formatObservedAt,
  formatPercent,
  humanRating,
  sessionLabel,
  type MarketBoard as Board,
  type Quote,
  type Technical,
  type TickerPacket,
} from "@/lib/market-client";

type Props = {
  board: Board | null;
  loading: boolean;
  error: string | null;
  tickers: ReadonlyArray<string>;
  onRefresh: () => void;
  testIdPrefix?: string;
};

const CARD = "rounded-xl border border-mist bg-paper p-4";
const NOTE = "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900";

function changeTone(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "text-ink/60";
  }
  return value >= 0 ? "text-emerald-700" : "text-red-700";
}

/** "Pre-market 101.20 (+1.10%)" or "After hours ..." when the quote carries an extended-session print. */
function extendedSession(quote: Quote | null): string {
  if (!quote) {
    return "";
  }
  if (quote.preMarketPrice !== null) {
    return `Pre-market ${formatNumber(quote.preMarketPrice)} (${formatPercent(quote.preMarketChangePercent) || "n/a"})`;
  }
  if (quote.postMarketPrice !== null) {
    return `After hours ${formatNumber(quote.postMarketPrice)} (${formatPercent(quote.postMarketChangePercent) || "n/a"})`;
  }
  return "";
}

function trendWord(price: number | null | undefined, average: number | null | undefined, days: number): string {
  if (price === null || price === undefined || average === null || average === undefined) {
    return "";
  }
  return `${price >= average ? "Above" : "Below"} ${days}-day average`;
}

function readings(quote: Quote | null, tech: Technical | null): string[] {
  const rating = humanRating(tech?.tradingview?.label ?? "");
  return [
    rating ? `TradingView: ${rating}` : "",
    tech?.rsi14 !== null && tech?.rsi14 !== undefined ? `RSI ${formatNumber(tech.rsi14, 0)}` : "",
    trendWord(quote?.price, tech?.sma50, 50),
    trendWord(quote?.price, tech?.sma200, 200),
  ].filter((entry) => entry !== "");
}

function BoardCard({ ticker, testIdPrefix }: { ticker: TickerPacket; testIdPrefix: string }) {
  const quote = ticker.quote;
  const price = quote?.price !== null && quote?.price !== undefined ? `${formatNumber(quote.price)} ${quote.currency}` : "";
  const session = extendedSession(quote);
  const facts = readings(quote, ticker.technical);
  return (
    <section className={CARD} data-testid={`${testIdPrefix}-board-card`} data-symbol={ticker.symbol.yahoo}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-mono text-base font-semibold text-ink">{ticker.symbol.yahoo}</h4>
          <p className="truncate text-xs text-ink/55">{ticker.symbol.name || ticker.symbol.exchange || " "}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold tabular-nums text-ink" data-testid={`${testIdPrefix}-board-price`}>
            {price || "No quote"}
          </p>
          <p className={`text-sm tabular-nums ${changeTone(quote?.changePercent)}`}>
            {formatPercent(quote?.changePercent) || (quote ? "unchanged" : "")}
            {quote?.marketState && quote.marketState !== "UNKNOWN" ? (
              <span className="ml-2 text-xs text-ink/50">{quote.marketState.toLowerCase()}</span>
            ) : null}
          </p>
        </div>
      </header>
      {session ? <p className="mt-1 text-xs text-ink/65">{session}</p> : null}
      {facts.length > 0 ? (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/65" data-testid={`${testIdPrefix}-board-facts`}>
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </p>
      ) : null}
      <div className="mt-3">
        <MarketPriceChart
          history={ticker.history}
          fallback={ticker.chart}
          symbol={ticker.symbol.yahoo}
          testId={`${testIdPrefix}-board-chart`}
        />
      </div>
      {ticker.failures.length > 0 ? (
        <p className={`mt-2 ${NOTE}`} data-testid={`${testIdPrefix}-board-card-note`}>
          {ticker.failures.join("; ")}
        </p>
      ) : null}
    </section>
  );
}

function LoadingCards({ tickers, testIdPrefix }: { tickers: ReadonlyArray<string>; testIdPrefix: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid={`${testIdPrefix}-board-loading`}>
      {tickers.map((ticker) => (
        <section key={ticker} className={`${CARD} animate-pulse`} aria-busy="true">
          <h4 className="font-mono text-base font-semibold text-ink">{ticker}</h4>
          <p className="mt-1 text-xs text-ink/55">Loading quote and chart…</p>
          <div className="mt-3 h-40 rounded-xl bg-mist/40" />
        </section>
      ))}
    </div>
  );
}

/** Quote and chart per ticker as soon as chips exist; works without an API key. */
export function MarketBoard({ board, loading, error, tickers, onRefresh, testIdPrefix = "market" }: Props) {
  if (tickers.length === 0) {
    return null;
  }
  return (
    <div className="space-y-3" data-testid={`${testIdPrefix}-board`} aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink/55" data-testid={`${testIdPrefix}-board-status`}>
          {board
            ? `US market ${sessionLabel(board.clock.usSession).toLowerCase()} · as of ${formatObservedAt(board.clock.runAt)}${loading ? " · updating…" : ""}`
            : loading
              ? "Fetching quotes and charts…"
              : ""}
        </p>
        <button
          type="button"
          className="btn text-xs"
          onClick={onRefresh}
          disabled={loading}
          data-testid={`${testIdPrefix}-board-refresh`}
        >
          Refresh
        </button>
      </div>
      {error ? (
        <p className={NOTE} role="alert" data-testid={`${testIdPrefix}-board-error`}>
          {error}
        </p>
      ) : null}
      {board && board.failures.length > 0 ? (
        <p className={NOTE} data-testid={`${testIdPrefix}-board-failures`}>
          {board.failures.join("; ")}
        </p>
      ) : null}
      {board ? (
        <div className="grid gap-4 md:grid-cols-2">
          {board.tickers.map((ticker) => (
            <BoardCard key={ticker.symbol.yahoo} ticker={ticker} testIdPrefix={testIdPrefix} />
          ))}
        </div>
      ) : loading ? (
        <LoadingCards tickers={tickers} testIdPrefix={testIdPrefix} />
      ) : null}
    </div>
  );
}
