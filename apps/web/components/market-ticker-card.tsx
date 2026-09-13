"use client";

import { MarketPriceChart } from "@/components/market-price-chart";
import {
  formatNumber,
  formatObservedAt,
  formatPercent,
  humanRating,
  percentVsSma200,
  type TickerPacket,
  type WatchNewsItem,
} from "@/lib/market-client";
import { safeLinkHref } from "@/lib/safe-link";

type Props = { ticker: TickerPacket; testIdPrefix: string };

type Fact = { label: string; value: string };

const BANNER = "rounded-lg border border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--text)]";

function quoteFacts(ticker: TickerPacket): Fact[] {
  const q = ticker.quote;
  const tech = ticker.technical;
  const facts: Fact[] = [
    { label: "Price", value: q ? `${formatNumber(q.price)} ${q.currency}`.trim() : "" },
    { label: "Change", value: formatPercent(q?.changePercent) },
    { label: "Prev close", value: formatNumber(q?.previousClose) },
    {
      label: "Pre-market",
      value: [formatNumber(q?.preMarketPrice), formatPercent(q?.preMarketChangePercent)].filter(Boolean).join(" · "),
    },
    {
      label: "After hours",
      value: [formatNumber(q?.postMarketPrice), formatPercent(q?.postMarketChangePercent)].filter(Boolean).join(" · "),
    },
    { label: "Volume", value: formatNumber(q?.volume, 0) },
    { label: "Market cap", value: formatNumber(q?.marketCap, 0) },
    { label: "State", value: q?.marketState ?? "" },
    { label: "TradingView", value: humanRating(tech?.tradingview?.label ?? "") },
    { label: "TV summary", value: formatNumber(tech?.tradingview?.summary) },
    { label: "RSI14", value: formatNumber(tech?.rsi14, 1) },
    { label: "SMA50", value: formatNumber(tech?.sma50) },
    { label: "SMA200", value: formatNumber(tech?.sma200) },
    { label: "vs SMA200", value: formatPercent(percentVsSma200(q, tech)) },
    { label: "MACD", value: [formatNumber(tech?.macd), formatNumber(tech?.macdSignal)].filter(Boolean).join(" / ") },
    {
      label: "5d / 1m",
      value: [formatPercent(tech?.change5dPercent), formatPercent(tech?.change1mPercent)].filter(Boolean).join(" / "),
    },
    {
      label: "52w range",
      value: [formatNumber(tech?.low52w), formatNumber(tech?.high52w)].filter(Boolean).join(" – "),
    },
  ];
  return facts.filter((fact) => fact.value !== "");
}

function Headline({ item, testId }: { item: WatchNewsItem; testId: string }) {
  const href = safeLinkHref(item.link);
  const meta = [item.publisher || item.ref.source, item.publishedAt ? formatObservedAt(item.publishedAt) : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="text-sm text-[var(--text)]" data-testid={testId}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
          {item.title}
        </a>
      ) : (
        <span>{item.title}</span>
      )}
      {meta ? <span className="ml-2 text-xs text-[var(--text-3)]">{meta}</span> : null}
      {item.summary ? <p className="mt-0.5 text-xs text-[var(--text-2)]">{item.summary}</p> : null}
    </li>
  );
}

/** One watchlist entry: chart, quote and technical facts, headlines, and what could not be fetched. */
export function MarketTickerCard({ ticker, testIdPrefix }: Props) {
  const facts = quoteFacts(ticker);
  const news = ticker.news.filter((item) => !item.injectionSuspect);
  const hidden = ticker.news.length - news.length;
  const subtitle = [ticker.symbol.name, ticker.symbol.exchange, ticker.symbol.tradingview].filter(Boolean).join(" · ");
  return (
    <section
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      data-testid={`${testIdPrefix}-ticker-card`}
      data-symbol={ticker.symbol.yahoo}
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="font-mono text-base font-semibold text-[var(--text)]">{ticker.symbol.yahoo}</h4>
        {subtitle ? <span className="text-xs text-[var(--text-3)]">{subtitle}</span> : null}
        {ticker.symbol.input !== ticker.symbol.yahoo ? (
          <span className="text-xs text-[var(--text-3)]">typed as {ticker.symbol.input}</span>
        ) : null}
      </header>
      <div className="mt-3 grid gap-4 lg:[grid-template-columns:minmax(0,3fr)_minmax(0,2fr)]">
        <MarketPriceChart
          history={ticker.history}
          fallback={ticker.chart}
          symbol={ticker.symbol.yahoo}
          testId={`${testIdPrefix}-chart`}
        />
        {facts.length > 0 ? (
          <table className="self-start text-sm" data-testid={`${testIdPrefix}-ticker-facts`}>
            <tbody>
              {facts.map((fact) => (
                <tr key={fact.label} className="border-t border-[var(--line)] first:border-t-0">
                  <th
                    scope="row"
                    className="py-1 pr-3 text-left text-xs font-medium uppercase tracking-wide text-[var(--text-3)]"
                  >
                    {fact.label}
                  </th>
                  <td className="py-1 text-right tabular-nums text-[var(--text)]">{fact.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-[var(--text-3)]">No quote or technical data.</p>
        )}
      </div>
      {news.length > 0 ? (
        <ul className="mt-4 space-y-1.5" data-testid={`${testIdPrefix}-headlines`}>
          {news.map((item) => (
            <Headline key={item.link} item={item} testId={`${testIdPrefix}-headline`} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-[var(--text-3)]">No headlines fetched.</p>
      )}
      {hidden > 0 ? (
        <p className="mt-1 text-xs text-[var(--text-2)]">
          {hidden} headline{hidden === 1 ? "" : "s"} hidden because the text looked like an instruction, not news.
        </p>
      ) : null}
      {ticker.failures.length > 0 ? (
        <ul className={`mt-3 ${BANNER}`} data-testid={`${testIdPrefix}-ticker-failures`}>
          {ticker.failures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
