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
import { t } from "@/lib/i18n";
import { safeLinkHref } from "@/lib/safe-link";
import { labeled } from "@/lib/ui-copy";

type Props = { ticker: TickerPacket; testIdPrefix: string };

type Fact = { label: string; value: string };

const BANNER = "rounded-lg border border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--text)]";

function ratingText(label: string): string {
  return label ? labeled(`market.rating.${label.trim().toUpperCase()}`, humanRating(label)) : "";
}

function quoteFacts(ticker: TickerPacket): Fact[] {
  const q = ticker.quote;
  const tech = ticker.technical;
  const facts: Fact[] = [
    { label: t("market.facts.price"), value: q ? `${formatNumber(q.price)} ${q.currency}`.trim() : "" },
    { label: t("market.facts.change"), value: formatPercent(q?.changePercent) },
    { label: t("market.facts.prevClose"), value: formatNumber(q?.previousClose) },
    {
      label: t("market.facts.preMarket"),
      value: [formatNumber(q?.preMarketPrice), formatPercent(q?.preMarketChangePercent)].filter(Boolean).join(" · "),
    },
    {
      label: t("market.facts.afterHours"),
      value: [formatNumber(q?.postMarketPrice), formatPercent(q?.postMarketChangePercent)].filter(Boolean).join(" · "),
    },
    { label: t("market.facts.volume"), value: formatNumber(q?.volume, 0) },
    { label: t("market.facts.marketCap"), value: formatNumber(q?.marketCap, 0) },
    { label: t("market.facts.state"), value: q?.marketState ?? "" },
    { label: t("market.facts.tradingView"), value: ratingText(tech?.tradingview?.label ?? "") },
    { label: t("market.facts.tvSummary"), value: formatNumber(tech?.tradingview?.summary) },
    { label: t("market.facts.rsi14"), value: formatNumber(tech?.rsi14, 1) },
    { label: t("market.facts.sma50"), value: formatNumber(tech?.sma50) },
    { label: t("market.facts.sma200"), value: formatNumber(tech?.sma200) },
    { label: t("market.facts.vsSma200"), value: formatPercent(percentVsSma200(q, tech)) },
    {
      label: t("market.facts.macd"),
      value: [formatNumber(tech?.macd), formatNumber(tech?.macdSignal)].filter(Boolean).join(" / "),
    },
    {
      label: t("market.facts.change5d1m"),
      value: [formatPercent(tech?.change5dPercent), formatPercent(tech?.change1mPercent)].filter(Boolean).join(" / "),
    },
    {
      label: t("market.facts.range52w"),
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
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
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
          <span className="text-xs text-[var(--text-3)]">
            {t("market.ticker.typedAs", { input: ticker.symbol.input })}
          </span>
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
          <p className="text-sm text-[var(--text-3)]">{t("market.ticker.noData")}</p>
        )}
      </div>
      {news.length > 0 ? (
        <ul className="mt-4 space-y-1.5" data-testid={`${testIdPrefix}-headlines`}>
          {news.map((item) => (
            <Headline key={item.link} item={item} testId={`${testIdPrefix}-headline`} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-[var(--text-3)]">{t("market.ticker.noHeadlines")}</p>
      )}
      {hidden > 0 ? (
        <p className="mt-1 text-xs text-[var(--text-2)]">
          {t(hidden === 1 ? "market.ticker.hiddenOne" : "market.ticker.hiddenMany", { count: hidden })}
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
