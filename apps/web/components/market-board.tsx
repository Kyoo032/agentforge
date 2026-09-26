"use client";

import { MarketPriceChart } from "@/components/market-price-chart";
import { headlineOf } from "@/lib/market-headline";
import {
  formatNumber,
  formatObservedAt,
  formatPercent,
  humanRating,
  type MarketBoard as Board,
  type Quote,
  type Technical,
  type TickerPacket,
} from "@/lib/market-client";
import { t } from "@/lib/i18n";

type Props = {
  board: Board | null;
  loading: boolean;
  error: string | null;
  tickers: ReadonlyArray<string>;
  onRefresh: () => void;
  testIdPrefix?: string;
};

const CARD = "rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4";
const NOTE = "rounded-lg border border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--text)]";

function changeTone(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "text-[var(--text-2)]";
  }
  return value >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]";
}

function trendWord(price: number | null | undefined, average: number | null | undefined, days: number): string {
  if (price === null || price === undefined || average === null || average === undefined) {
    return "";
  }
  return t(price >= average ? "market.board.aboveAverage" : "market.board.belowAverage", { days });
}

function readings(quote: Quote | null, tech: Technical | null): string[] {
  const rating = humanRating(tech?.tradingview?.label ?? "");
  return [
    rating ? t("market.board.tradingView", { rating }) : "",
    tech?.rsi14 !== null && tech?.rsi14 !== undefined ? `RSI ${formatNumber(tech.rsi14, 0)}` : "",
    trendWord(quote?.price, tech?.sma50, 50),
    trendWord(quote?.price, tech?.sma200, 200),
  ].filter((entry) => entry !== "");
}

function BoardCard({ ticker, testIdPrefix }: { ticker: TickerPacket; testIdPrefix: string }) {
  const quote = ticker.quote;
  const headline = headlineOf(quote);
  const facts = readings(quote, ticker.technical);
  return (
    <section className={CARD} data-testid={`${testIdPrefix}-board-card`} data-symbol={ticker.symbol.yahoo}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-mono text-base font-semibold text-[var(--text)]">{ticker.symbol.yahoo}</h4>
          <p className="truncate text-xs text-[var(--text-3)]">{ticker.symbol.name || ticker.symbol.exchange || " "}</p>
        </div>
        <div className="text-right">
          <p
            className="text-xl font-semibold tabular-nums text-[var(--text)]"
            data-testid={`${testIdPrefix}-board-price`}
          >
            {headline.price || t("market.board.noQuote")}
          </p>
          <p className={`text-sm tabular-nums ${changeTone(headline.percent)}`}>
            {formatPercent(headline.percent) || (quote ? t("market.board.unchanged") : "")}
            {headline.caption ? <span className="ml-2 text-xs text-[var(--text-3)]">{headline.caption}</span> : null}
          </p>
        </div>
      </header>
      {headline.note ? (
        <p className="mt-1 text-xs text-[var(--text-2)]" data-testid={`${testIdPrefix}-board-close`}>
          {headline.note}
        </p>
      ) : null}
      {facts.length > 0 ? (
        <p
          className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-2)]"
          data-testid={`${testIdPrefix}-board-facts`}
        >
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
    <div
      className="grid gap-4 md:grid-cols-2 min-[1600px]:grid-cols-3 min-[2400px]:grid-cols-4"
      data-testid={`${testIdPrefix}-board-loading`}
    >
      {tickers.map((ticker) => (
        <section key={ticker} className={CARD} aria-busy="true">
          <h4 className="font-mono text-base font-semibold text-[var(--text)]">{ticker}</h4>
          <p className="mt-1 text-xs text-[var(--text-3)]">{t("market.board.loading")}</p>
          <div className="mt-3 h-40 rounded-xl border border-[var(--line)] bg-[var(--accent-soft)]" />
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
        <p className="text-xs text-[var(--text-3)]" data-testid={`${testIdPrefix}-board-status`}>
          {board
            ? t("market.board.status", {
                session: t(`market.session.${board.clock.usSession}`),
                when: `${formatObservedAt(board.clock.runAt)}${loading ? ` · ${t("market.board.updating")}` : ""}`,
              })
            : loading
              ? t("market.board.fetching")
              : ""}
        </p>
        <button
          type="button"
          className="btn text-xs"
          onClick={onRefresh}
          disabled={loading}
          data-testid={`${testIdPrefix}-board-refresh`}
        >
          {t("market.board.refresh")}
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
        <div className="grid gap-4 md:grid-cols-2 min-[1600px]:grid-cols-3 min-[2400px]:grid-cols-4">
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
