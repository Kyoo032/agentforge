/**
 * The DATA PACKET sections, one renderer per `MarketSource`.
 *
 * `briefing-prompt.ts` assembles them in the order its desk's harness asks
 * for; nothing here decides what a desk sees. Two rules hold in every
 * renderer: figures are printed at presentation precision (the model copies
 * what it sees, so it must never see a raw float), and period labels are
 * spelled out ("1 month", not "1m") so the number guard never reads a token as
 * a million.
 */
import { RSI_DECIMALS, SCORE_DECIMALS, formatFixed, formatPercent, formatPrice } from "./prompt-format";
import type {
  CryptoGlobal,
  GlobalNewsItem,
  MarketSession,
  MarketSignal,
  MarketWatchPacket,
  MetalsContext,
  Quote,
  RotationRow,
  SwingPoint,
  Technical,
  TickerCrypto,
  TickerFundamentals,
  TickerInsiders,
  TickerPacket,
  TickerSentiment,
  WatchNewsItem,
} from "./watch-schemas";
import { INSIDER_WINDOW_DAYS } from "./watch-schemas";

export const PROMPT_HEADLINES_MAX = 6;
export const MISSING = "n/a";

/** Price-scale figure (quotes, SMAs, MACD, 52-week range) in the ticker's currency precision. */
function price(value: number | null | undefined, currency: string): string {
  return value === null || value === undefined ? MISSING : formatPrice(value, currency);
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? MISSING : formatPercent(value);
}

function fixed(value: number | null | undefined, decimals: number): string {
  return value === null || value === undefined ? MISSING : formatFixed(value, decimals);
}

/** "2026-09-09T10:00Z" from an ISO timestamp; n/a when absent. Milliseconds are dropped on purpose. */
export function shortTime(iso: string | null): string {
  if (iso === null) {
    return MISSING;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

/** "(web, observed 2026-09-09T10:00Z)" — the attribution every derived section carries. */
function attribution(section: { source: string; observedAt: string }): string {
  return `(${section.source}, observed ${shortTime(section.observedAt)})`;
}

export function quoteLine(quote: Quote | null): string {
  if (quote === null) {
    return `- quote: ${MISSING}`;
  }
  const cur = quote.currency;
  const pre =
    quote.preMarketPrice === null
      ? MISSING
      : `${price(quote.preMarketPrice, cur)} (${pct(quote.preMarketChangePercent)})`;
  const post =
    quote.postMarketPrice === null
      ? MISSING
      : `${price(quote.postMarketPrice, cur)} (${pct(quote.postMarketChangePercent)})`;
  return [
    `- quote: ${price(quote.price, cur)} ${cur}`.trimEnd(),
    `chg ${pct(quote.changePercent)}`,
    `prev close ${price(quote.previousClose, cur)}`,
    `pre-mkt ${pre}`,
    `post-mkt ${post}`,
    `state ${quote.marketState}`,
    `volume ${fixed(quote.volume, 0)}`,
    `mkt cap ${fixed(quote.marketCap, 0)}`,
    `(${quote.ref.source}, observed ${shortTime(quote.ref.observedAt)})`,
  ].join(", ");
}

function ratingText(technical: Technical): string {
  const tv = technical.tradingview;
  if (tv === null) {
    return `TV ${MISSING}`;
  }
  const scores = `${fixed(tv.summary, SCORE_DECIMALS)}; MA ${fixed(tv.movingAverages, SCORE_DECIMALS)}, osc ${fixed(tv.oscillators, SCORE_DECIMALS)}`;
  return `TV ${tv.label || MISSING} (${scores})`;
}

export function technicalLine(technical: Technical | null, currency: string): string {
  if (technical === null) {
    return `- technical: ${MISSING}`;
  }
  return [
    `- technical: ${ratingText(technical)}`,
    `RSI14 ${fixed(technical.rsi14, RSI_DECIMALS)}`,
    `SMA50 ${price(technical.sma50, currency)}`,
    `SMA200 ${price(technical.sma200, currency)}`,
    `EMA200 ${price(technical.ema200, currency)}`,
    `MACD ${price(technical.macd, currency)} / signal ${price(technical.macdSignal, currency)}`,
    `1 day ${pct(technical.change1dPercent)}`,
    `5 days ${pct(technical.change5dPercent)}`,
    `1 month ${pct(technical.change1mPercent)}`,
    `52-week ${price(technical.low52w, currency)}-${price(technical.high52w, currency)}`,
  ].join(", ");
}

/** Crypto-native figures for one coin. Absent fields read as n/a, never as zero. */
export function cryptoLine(crypto: TickerCrypto | undefined): string {
  if (crypto === undefined) {
    return `- crypto: ${MISSING}`;
  }
  return [
    `- crypto: mkt cap ${fixed(crypto.marketCapUsd, 0)}`,
    `daily volume ${fixed(crypto.volume24hUsd, 0)}`,
    `7 days ${pct(crypto.change7dPct)}`,
    `dominance ${pct(crypto.dominancePct)}`,
    `funding rate ${pct(crypto.fundingRatePct)}`,
    attribution(crypto),
  ].join(", ");
}

/**
 * Reported company figures for one listing. Ratios at score precision, money
 * in whole units, percentages with their sign; a field the provider did not
 * give reads n/a so the analyst says "not reported" instead of inferring one.
 */
export function fundamentalsLine(fundamentals: TickerFundamentals | undefined, currency: string): string {
  if (fundamentals === undefined) {
    return `- FUNDAMENTALS: ${MISSING}`;
  }
  const f = fundamentals;
  return [
    `- FUNDAMENTALS: sector ${f.sector || MISSING}`,
    `industry ${f.industry || MISSING}`,
    `mkt cap ${fixed(f.marketCap, 0)}`,
    `trailing P/E ${fixed(f.trailingPe, SCORE_DECIMALS)}`,
    `forward P/E ${fixed(f.forwardPe, SCORE_DECIMALS)}`,
    `PEG ${fixed(f.peg, SCORE_DECIMALS)}`,
    `price/book ${fixed(f.priceToBook, SCORE_DECIMALS)}`,
    `EPS trailing ${price(f.epsTrailing, currency)}`,
    `EPS forward ${price(f.epsForward, currency)}`,
    `dividend yield ${pct(f.dividendYieldPct)}`,
    `beta ${fixed(f.beta, SCORE_DECIMALS)}`,
    `revenue over the last 12 months ${fixed(f.revenueTtm, 0)}`,
    `gross margin ${pct(f.grossMarginPct)}`,
    `operating margin ${pct(f.operatingMarginPct)}`,
    `profit margin ${pct(f.profitMarginPct)}`,
    `return on equity ${pct(f.roePct)}`,
    `return on assets ${pct(f.roaPct)}`,
    `debt/equity ${fixed(f.debtToEquity, SCORE_DECIMALS)}`,
    `current ratio ${fixed(f.currentRatio, SCORE_DECIMALS)}`,
    `free cash flow ${fixed(f.freeCashflow, 0)}`,
    attribution(f),
  ].join(", ");
}

/** Insider filings counted over the fixed window. Counts, never a reason to act on them. */
export function insidersLine(insiders: TickerInsiders | undefined): string {
  if (insiders === undefined) {
    return `- INSIDERS: ${MISSING}`;
  }
  return [
    `- INSIDERS: last ${INSIDER_WINDOW_DAYS} days`,
    `buy filings ${fixed(insiders.buys, 0)}`,
    `sell filings ${fixed(insiders.sells, 0)}`,
    `net shares ${fixed(insiders.netShares, 0)}`,
    attribution(insiders),
  ].join(", ");
}

/**
 * The crowd read. A venue that did not answer prints n/a; a venue that
 * answered with nothing prints its zero, because "no one is posting" and "the
 * venue is down" are different facts. Sampled posts are quoted as mood: their
 * figures are not packet figures and the number guard does not accept them.
 */
export function sentimentLines(sentiment: TickerSentiment | undefined): string[] {
  if (sentiment === undefined) {
    return [`- SENTIMENT: ${MISSING}`];
  }
  const st = sentiment.stocktwits;
  const reddit = sentiment.reddit;
  const stText =
    st === undefined
      ? `StockTwits ${MISSING}`
      : `StockTwits ${fixed(st.total, 0)} messages (bullish ${fixed(st.bullish, 0)}, bearish ${fixed(st.bearish, 0)}, sampled ${fixed(st.sampled, 0)})`;
  const redditText =
    reddit === undefined
      ? `Reddit ${MISSING}`
      : `Reddit ${fixed(reddit.posts, 0)} posts in ${reddit.subreddits.join(", ") || "no subreddit"}`;
  const head = `- SENTIMENT: ${stText}, ${redditText}, observed ${shortTime(sentiment.observedAt)}`;
  const samples = sentiment.samples.map(
    (sample) => `  - sample (${sample.source}, mood only): "${sample.title}" (${shortTime(sample.at ?? null)})`,
  );
  return samples.length === 0 ? [head, "  - samples: none"] : [head, ...samples];
}

/** Macro headlines from the fixed global queries, each tagged with the query that surfaced it. */
export function globalNewsLines(items: readonly GlobalNewsItem[] | undefined): string[] {
  if (items === undefined) {
    return [];
  }
  if (items.length === 0) {
    return ["GLOBAL NEWS: none", ""];
  }
  const rows = items.map(
    (item) => `- ${item.title} — ${item.publisher || MISSING} (${shortTime(item.at ?? null)}) [query: ${item.query}]`,
  );
  return ["GLOBAL NEWS (fixed macro queries):", ...rows, ""];
}

function headlineLine(item: WatchNewsItem): string {
  return `  - ${item.title} — ${item.publisher || item.ref.source} (${shortTime(item.publishedAt)}) ${item.link}`;
}

/** Dated pivot levels the Elliott Wave desk may label. */
export function swingLines(swings: readonly SwingPoint[] | undefined, currency: string): string[] {
  const rows = swings ?? [];
  if (rows.length === 0) {
    return ["- swings: none"];
  }
  return [`- swings: ${rows.map((s) => `${s.date} ${s.kind} ${price(s.price, currency)}`).join(", ")}`];
}

export function newsLines(news: readonly WatchNewsItem[]): string[] {
  const shown = news.filter((item) => !item.injectionSuspect).slice(0, PROMPT_HEADLINES_MAX);
  return shown.length === 0 ? ["- news: none"] : ["- news:", ...shown.map(headlineLine)];
}

/** "TICKER MU — MU Inc — NASDAQ:MU (NMS, USD)"; empty parts are dropped. */
export function tickerHeader(ticker: TickerPacket): string {
  const s = ticker.symbol;
  const venue = [s.exchange, s.currency].filter(Boolean).join(", ");
  const tv = s.tradingview ?? "";
  const listing = [tv, venue ? `(${venue})` : ""].filter(Boolean).join(" ");
  return [`TICKER ${s.yahoo}`, s.name, listing].filter(Boolean).join(" — ");
}

export function macroLines(packet: MarketWatchPacket): string[] {
  const { quotes, failures } = packet.macro;
  const failureLine = failures.length === 0 ? [] : [`- macro failures: ${failures.join("; ")}`];
  if (quotes.length === 0) {
    return [`MACRO: ${MISSING}`, ...failureLine, ""];
  }
  const rows = quotes.map(
    (q) =>
      `| ${q.label || q.symbol} | ${q.symbol} | ${price(q.price, q.currency)} | ${pct(q.changePercent)} | ${q.marketState} |`,
  );
  return ["MACRO:", "| Macro | Symbol | Level | Chg% | State |", "|---|---|---|---|---|", ...rows, ...failureLine, ""];
}

export function cryptoGlobalLines(global: CryptoGlobal | undefined): string[] {
  if (global === undefined) {
    return [];
  }
  const cells = [
    `total market cap ${fixed(global.totalMarketCapUsd, 0)}`,
    `BTC dominance ${pct(global.btcDominancePct)}`,
    `ETH dominance ${pct(global.ethDominancePct)}`,
    attribution(global),
  ];
  return [`CRYPTO GLOBAL: ${cells.join(", ")}`, ""];
}

export function metalsLines(metals: MetalsContext | undefined): string[] {
  if (metals === undefined) {
    return [];
  }
  const cells = [
    `DXY ${fixed(metals.dxy, SCORE_DECIMALS)}`,
    `US 10-year yield ${fixed(metals.us10y, SCORE_DECIMALS)}`,
    `gold/silver ratio ${fixed(metals.goldSilverRatio, SCORE_DECIMALS)}`,
    `futures versus spot ${pct(metals.goldFuturesVsSpotPct)}`,
    `futures vs GLD ${pct(metals.goldFuturesVsGldPct)}`,
    attribution(metals),
  ];
  return [`METALS CONTEXT: ${cells.join(", ")}`, ""];
}

/** Code-computed chart observations. The model narrates these; it does not recompute them. */
export function signalLines(signals: readonly MarketSignal[] | undefined): string[] {
  if (signals === undefined) {
    return [];
  }
  if (signals.length === 0) {
    return ["SIGNALS: none", ""];
  }
  const rows = signals.map((s) => `| ${s.ticker} | ${s.kind} | ${fixed(s.value, SCORE_DECIMALS)} | ${s.note} |`);
  return ["SIGNALS (computed):", "| Ticker | Observation | Value | Note |", "|---|---|---|---|", ...rows, ""];
}

/** Code-computed trailing returns, already ranked by the 1-month column. */
export function rotationLines(rotation: readonly RotationRow[] | undefined): string[] {
  if (rotation === undefined) {
    return [];
  }
  if (rotation.length === 0) {
    return ["ROTATION: none", ""];
  }
  const rows = rotation.map(
    (r) =>
      `| ${r.rank1m} | ${r.ticker} | ${pct(r.ret1dPct)} | ${pct(r.ret5dPct)} | ${pct(r.ret1mPct)} | ${pct(r.ret6mPct)} |`,
  );
  return [
    "ROTATION (computed, ranked by the 1 month column):",
    "| Rank | Ticker | 1 day | 5 days | 1 month | 6 months |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ];
}

const SESSION_WORDS: Readonly<Record<MarketSession["state"], string>> = {
  pre: "pre-market",
  open: "open",
  post: "after-hours",
  closed: "closed",
  always: "always open",
};

/** One line per exchange the watchlist touches, so a desk cannot pass a stale close off as live. */
export function sessionLines(sessions: readonly MarketSession[] | undefined): string[] {
  if (sessions === undefined) {
    return [];
  }
  if (sessions.length === 0) {
    return ["SESSIONS: none", ""];
  }
  const rows = sessions.map((session) => {
    const next =
      session.nextChangeAt === null ? "no scheduled change" : `next change ${shortTime(session.nextChangeAt)}`;
    return `- ${session.exchange}: ${SESSION_WORDS[session.state]}, ${next}`;
  });
  return ["SESSIONS:", ...rows, ""];
}
