"use client";

import {
  formatNumber,
  formatPercent,
  percentVsSma200,
  type MacroSnapshot,
  type TickerPacket,
} from "@/lib/market-client";

const HEAD = "px-2 py-1.5 text-left text-[12px] font-medium uppercase tracking-wide text-ink/50";
const CELL = "px-2 py-1.5 text-ink/85";
const NUM = `${CELL} text-right tabular-nums`;

function signClass(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return value < 0 ? " text-red-700" : " text-emerald-700";
}

type WatchlistProps = { tickers: TickerPacket[]; testId: string };

/** Ticker, price, chg%, pre-mkt, pre%, state, TV label, RSI, vs SMA200: the same columns as the markdown export. */
export function WatchlistTable({ tickers, testId }: WatchlistProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-mist" data-testid={testId}>
      <table className="w-full text-sm">
        <thead className="bg-mist/30">
          <tr>
            <th className={HEAD}>Ticker</th>
            <th className={`${HEAD} text-right`}>Price</th>
            <th className={`${HEAD} text-right`}>Chg%</th>
            <th className={`${HEAD} text-right`}>Pre-mkt</th>
            <th className={`${HEAD} text-right`}>Pre%</th>
            <th className={HEAD}>State</th>
            <th className={HEAD}>TV rating</th>
            <th className={`${HEAD} text-right`}>RSI14</th>
            <th className={`${HEAD} text-right`}>vs SMA200</th>
          </tr>
        </thead>
        <tbody>
          {tickers.map((ticker) => {
            const q = ticker.quote;
            const tech = ticker.technical;
            const vsSma = percentVsSma200(q, tech);
            return (
              <tr key={ticker.symbol.yahoo} className="border-t border-mist" data-testid={`${testId}-row`}>
                <td className={`${CELL} font-mono`} title={ticker.symbol.name || undefined}>
                  {ticker.symbol.yahoo}
                </td>
                <td className={NUM}>{formatNumber(q?.price)}</td>
                <td className={NUM + signClass(q?.changePercent)}>{formatPercent(q?.changePercent)}</td>
                <td className={NUM}>{formatNumber(q?.preMarketPrice)}</td>
                <td className={NUM + signClass(q?.preMarketChangePercent)}>
                  {formatPercent(q?.preMarketChangePercent)}
                </td>
                <td className={CELL}>{q?.marketState ?? ""}</td>
                <td className={CELL}>{tech?.tradingview?.label ?? ""}</td>
                <td className={NUM}>{formatNumber(tech?.rsi14, 1)}</td>
                <td className={NUM + signClass(vsSma)}>{formatPercent(vsSma)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type MacroProps = { macro: MacroSnapshot; testId: string };

export function MacroTable({ macro, testId }: MacroProps) {
  if (macro.quotes.length === 0) {
    return (
      <p className="text-sm text-ink/55" data-testid={testId}>
        No macro quotes were fetched.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-mist" data-testid={testId}>
      <table className="w-full text-sm">
        <thead className="bg-mist/30">
          <tr>
            <th className={HEAD}>Macro</th>
            <th className={HEAD}>Symbol</th>
            <th className={`${HEAD} text-right`}>Level</th>
            <th className={`${HEAD} text-right`}>Chg%</th>
            <th className={HEAD}>State</th>
          </tr>
        </thead>
        <tbody>
          {macro.quotes.map((q) => (
            <tr key={q.symbol} className="border-t border-mist" data-testid={`${testId}-row`}>
              <td className={CELL}>{q.label || q.name || q.symbol}</td>
              <td className={`${CELL} font-mono text-xs`}>{q.symbol}</td>
              <td className={NUM}>{formatNumber(q.price)}</td>
              <td className={NUM + signClass(q.changePercent)}>{formatPercent(q.changePercent)}</td>
              <td className={CELL}>{q.marketState}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
