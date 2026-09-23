"use client";

import {
  formatNumber,
  formatPercent,
  percentVsSma200,
  type MacroSnapshot,
  type TickerPacket,
} from "@/lib/market-client";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";

const HEAD = "px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-[var(--text-2)]";
const CELL = "px-2 py-1.5 text-[var(--text)]";
const NUM = `${CELL} text-right tabular-nums`;

function signClass(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return value < 0 ? " text-[var(--danger)]" : " text-[var(--ok)]";
}

/** Localized TradingView rating; an unknown label is shown as the host sent it. */
function ratingText(label: string): string {
  return label ? labeled(`market.rating.${label.trim().toUpperCase()}`, label) : "";
}

type WatchlistProps = { tickers: TickerPacket[]; testId: string };

/** Ticker, price, chg%, pre-mkt, pre%, state, TV label, RSI, vs SMA200: the same columns as the markdown export. */
export function WatchlistTable({ tickers, testId }: WatchlistProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--line)]" data-testid={testId}>
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg)]">
          <tr>
            <th className={HEAD}>{t("market.tables.ticker")}</th>
            <th className={`${HEAD} text-right`}>{t("market.tables.price")}</th>
            <th className={`${HEAD} text-right`}>{t("market.tables.chgPct")}</th>
            <th className={`${HEAD} text-right`}>{t("market.tables.preMkt")}</th>
            <th className={`${HEAD} text-right`}>{t("market.tables.prePct")}</th>
            <th className={HEAD}>{t("market.tables.state")}</th>
            <th className={HEAD}>{t("market.tables.tvRating")}</th>
            <th className={`${HEAD} text-right`}>{t("market.tables.rsi14")}</th>
            <th className={`${HEAD} text-right`}>{t("market.tables.vsSma200")}</th>
          </tr>
        </thead>
        <tbody>
          {tickers.map((ticker) => {
            const q = ticker.quote;
            const tech = ticker.technical;
            const vsSma = percentVsSma200(q, tech);
            return (
              <tr key={ticker.symbol.yahoo} className="border-t border-[var(--line)]" data-testid={`${testId}-row`}>
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
                <td className={CELL}>{ratingText(tech?.tradingview?.label ?? "")}</td>
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
      <p className="text-sm text-[var(--text-2)]" data-testid={testId}>
        {t("market.briefing.noMacro")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--line)]" data-testid={testId}>
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg)]">
          <tr>
            <th className={HEAD}>{t("market.tables.macro")}</th>
            <th className={HEAD}>{t("market.tables.symbol")}</th>
            <th className={`${HEAD} text-right`}>{t("market.tables.level")}</th>
            <th className={`${HEAD} text-right`}>{t("market.tables.chgPct")}</th>
            <th className={HEAD}>{t("market.tables.state")}</th>
          </tr>
        </thead>
        <tbody>
          {macro.quotes.map((q) => (
            <tr key={q.symbol} className="border-t border-[var(--line)]" data-testid={`${testId}-row`}>
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
