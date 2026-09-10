/**
 * Prompt assembly for the Market Watch briefing. The model receives a system
 * text, a compact DATA PACKET block, and the user's own instruction. The
 * allowed-number set for the number guard is everything numeric in the packet
 * plus the figures in the user's position context.
 */
import { UNVERIFIED_MARKER, type NumberToken, extractNumbers } from "../finance/number-guard";
import {
  RSI_DECIMALS,
  SCORE_DECIMALS,
  formatFixed,
  formatPercent,
  formatPrice,
  presentationValues,
} from "./prompt-format";
import type {
  MarketWatchPacket,
  MarketWatchRequest,
  Quote,
  Technical,
  TickerPacket,
  WatchNewsItem,
} from "./watch-schemas";

export const PROMPT_HEADLINES_MAX = 6;
export const POSITION_CONTEXT_HEADING = "USER POSITION CONTEXT (numbers allowed):";
const MISSING = "n/a";

const LANGUAGE_NAMES: Readonly<Record<MarketWatchRequest["language"], string>> = {
  id: "Bahasa Indonesia",
  en: "English",
};

export const DEFAULT_WATCH_PROMPT_ID = `Buat pre-market briefing untuk watchlist saya dari DATA PACKET. Bahasa Indonesia, padat, tanpa pembukaan, tanpa emoji. Bullet singkat; tabel markdown boleh dipakai bila membantu.

Struktur (gunakan judul ini, urutan tetap):
1. TL;DR + confidence - 2-4 kalimat: nada pasar hari ini dan tingkat keyakinan (rendah/sedang/tinggi) beserta alasannya.
2. Macro sekarang - futures, VIX, yield 10Y, minyak, dolar, IHSG/USDIDR bila ada; satu baris per item, angka dari packet.
3. Watchlist snapshot - semua ticker, satu frasa per ticker: harga/pre-market, rating TradingView, posisi terhadap SMA50/200, RSI.
4. Ranking hari ini - urutkan dari paling bullish ke paling bearish, satu alasan per ticker.
5. Events today / fresh catalysts - berita dan katalis 24-48 jam terakhir dari headline packet; sebut sumber dan waktu.
6. Posisi focus - HANYA jika ada USER POSITION CONTEXT: setup vs harga rata-rata (average cost) dan target, apakah target sudah tercapai, level kunci (52-week, SMA, high/low terbaru).
7. Signals to watch at open - 3-5 sinyal konkret (level harga, indikator, event) yang mengubah gambaran.
8. Risk note - korelasi antar posisi, sizing, dan apa yang membuat tesis salah.

Aturan:
- Setiap angka harus berasal dari DATA PACKET atau dari konteks posisi saya. Jika data tidak ada, tulis "data tidak tersedia"; jangan mengarang.
- Jika packet menandai bahwa ini bukan pre-market sungguhan (akhir pekan, sesi reguler, atau setelah tutup), sebutkan di TL;DR dan beri label snapshot dengan jujur (mis. "harga = penutupan terakhir").
- Boleh menyebut sentimen bullish/bearish dan level target dari konteks posisi, tetapi jangan pernah menyuruh pembaca membeli atau menjual sekarang.
- Maksimal {maxChars} karakter; jika perlu memangkas, pangkas bagian 7 dan 8 lebih dulu.
- Tutup dengan satu baris: "Ini analisis, bukan saran investasi."`;

export const DEFAULT_WATCH_PROMPT_EN = `Write a pre-market briefing for my watchlist from the DATA PACKET. English, compact, no preamble, no emojis. Short bullets; markdown tables are fine where they help.

Structure (use these headings, in this order):
1. TL;DR + confidence - 2-4 sentences: today's market tone and your confidence (low/medium/high) with the reason.
2. Macro now - futures, VIX, 10Y yield, oil, dollar, IHSG/USDIDR when present; one line each, numbers from the packet.
3. Watchlist snapshot - every ticker, one phrase each: price/pre-market, TradingView rating, position vs SMA50/200, RSI.
4. Ranking today - most bullish to most bearish, one reason per ticker.
5. Events today / fresh catalysts - news and catalysts from the last 24-48h in the packet headlines; name the source and time.
6. Position focus - ONLY if USER POSITION CONTEXT is given: setup vs average cost and target, whether the target is reached, key levels (52-week, SMAs, recent high/low).
7. Signals to watch at open - 3-5 concrete signals (price levels, indicators, events) that would change the picture.
8. Risk note - correlation across positions, sizing, and what would make the thesis wrong.

Rules:
- Every number must come from the DATA PACKET or from my position context. When data is missing, write "not available"; never invent it.
- If the packet says this is not a real pre-market run (weekend, regular session, after close), say so in the TL;DR and label the snapshot honestly (e.g. "prices = last close").
- You may call sentiment bullish/bearish and discuss target levels from my position context, but never instruct me to buy or sell right now.
- Stay under {maxChars} characters; if you must trim, trim sections 7 and 8 first.
- End with one line: "This is analysis, not investment advice."`;

export type WatchSystemPromptInput = {
  language: MarketWatchRequest["language"];
  maxChars: number;
  clockNote: string;
};

export function buildWatchSystemPrompt(input: WatchSystemPromptInput): string {
  const language = LANGUAGE_NAMES[input.language] ?? LANGUAGE_NAMES.id;
  const clockLine = input.clockNote.trim() === "" ? [] : [`- Clock context: ${input.clockNote.trim()}`];
  return [
    "You are a market analyst writing a watchlist briefing for one reader.",
    "You receive a DATA PACKET (quotes, pre-market moves, TradingView technical ratings, RSI/SMA/MACD, 52-week range, headlines with publisher and time, macro levels) and then the reader's own instruction.",
    "",
    "Rules:",
    `- Every number in your output must be one of the numbers in the DATA PACKET or a number from the USER POSITION CONTEXT. A guard replaces any other figure with "${UNVERIFIED_MARKER}", so do not derive new figures, do not compute percentages that are not in the packet, and do not quote levels from memory.`,
    "- Rank the tickers and read sentiment freely (bullish/bearish, key levels, whether the reader's target is reached), but never tell the reader to buy or sell now. No imperative directives.",
    "- Do not fabricate data. When a field is missing (n/a, none, failures), say that it is missing instead of guessing.",
    "- Keep ticker symbols and source names exactly as they appear in the packet.",
    `- Write in ${language}. Stay under ${input.maxChars} characters in total.`,
    ...clockLine,
    '- Output ONLY JSON, no markdown fence, no preamble: {"title": string, "sections": [{"heading": string, "body": string}]}. Use the headings the reader\'s instruction asks for, in that order. Bodies are markdown (bullets and tables allowed).',
  ].join("\n");
}

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

/** "2026-09-09T10:00Z" from an ISO timestamp; n/a when absent. */
function shortTime(iso: string | null): string {
  if (iso === null) {
    return MISSING;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

function quoteLine(quote: Quote | null): string {
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

/** Period labels are spelled out ("1 month", not "1m") so the model never writes a token the guard reads as a million. */
function technicalLine(technical: Technical | null, currency: string): string {
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

function headlineLine(item: WatchNewsItem): string {
  return `  - ${item.title} — ${item.publisher || item.ref.source} (${shortTime(item.publishedAt)}) ${item.link}`;
}

function newsLines(news: readonly WatchNewsItem[]): string[] {
  const shown = news.filter((item) => !item.injectionSuspect).slice(0, PROMPT_HEADLINES_MAX);
  return shown.length === 0 ? ["- news: none"] : ["- news:", ...shown.map(headlineLine)];
}

/** "TICKER MU — MU Inc — NASDAQ:MU (NMS, USD)"; empty parts are dropped. */
function tickerHeader(ticker: TickerPacket): string {
  const s = ticker.symbol;
  const venue = [s.exchange, s.currency].filter(Boolean).join(", ");
  const tv = s.tradingview ?? "";
  const listing = [tv, venue ? `(${venue})` : ""].filter(Boolean).join(" ");
  return [`TICKER ${s.yahoo}`, s.name, listing].filter(Boolean).join(" — ");
}

function tickerBlock(ticker: TickerPacket): string[] {
  const header = tickerHeader(ticker);
  const failures = ticker.failures.length === 0 ? [] : [`- failures: ${ticker.failures.join("; ")}`];
  const currency = ticker.quote?.currency || ticker.symbol.currency;
  return [
    header,
    quoteLine(ticker.quote),
    technicalLine(ticker.technical, currency),
    ...newsLines(ticker.news),
    ...failures,
    "",
  ];
}

function macroLines(packet: MarketWatchPacket): string[] {
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

/** Compact text the model reads: clock, macro table, one block per ticker, position context last. */
export function packetToPromptBlock(packet: MarketWatchPacket): string {
  const clock =
    `CLOCK: ${packet.clock.runAt} | U.S. session: ${packet.clock.usSession} | ${packet.clock.note}`.trimEnd();
  const tickers = packet.tickers.flatMap(tickerBlock);
  const position =
    packet.positionContext.trim() === "" ? [] : [POSITION_CONTEXT_HEADING, packet.positionContext.trim()];
  return [clock, "", ...macroLines(packet), ...tickers, ...position].join("\n").trimEnd();
}

const QUOTE_FIELDS = [
  "price",
  "changePercent",
  "previousClose",
  "preMarketPrice",
  "preMarketChangePercent",
  "postMarketPrice",
  "postMarketChangePercent",
  "volume",
  "marketCap",
] as const;

const TECHNICAL_FIELDS = [
  "rsi14",
  "sma50",
  "sma200",
  "ema200",
  "macd",
  "macdSignal",
  "change1dPercent",
  "change5dPercent",
  "change1mPercent",
  "high52w",
  "low52w",
] as const;

const RATING_FIELDS = ["summary", "movingAverages", "oscillators"] as const;

function quoteNumbers(quote: Quote | null): (number | null)[] {
  return quote === null ? [] : QUOTE_FIELDS.map((field) => quote[field]);
}

function technicalNumbers(technical: Technical | null): (number | null)[] {
  if (technical === null) {
    return [];
  }
  const rating = technical.tradingview;
  return [
    ...TECHNICAL_FIELDS.map((field) => technical[field]),
    ...(rating === null ? [] : RATING_FIELDS.map((field) => rating[field])),
  ];
}

function isFigure(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Both readings of an ambiguous "1.000" in the user's own text (1,000 or 1.0). */
function contextReadings(token: NumberToken): number[] {
  return token.alternate === undefined ? [token.value] : [token.value, token.alternate];
}

/**
 * Every figure the model may write: packet quotes, technicals, and macro (each
 * with its rounded presentations, see `presentationValues`) plus the numbers in
 * the position context.
 */
/** Figures quoted inside the headlines the model saw (analyst targets, deal sizes). Attributed third-party data, so allowed. */
function headlineNumbers(packet: MarketWatchPacket): number[] {
  const text = packet.tickers
    .flatMap((t) => t.news.filter((n) => !n.injectionSuspect).map((n) => `${n.title} ${n.summary}`))
    .join("\n");
  return extractNumbers(text).flatMap(contextReadings).filter(isFigure);
}

export function packetNumbers(packet: MarketWatchPacket, positionContext: string): number[] {
  const raw = [
    ...packet.tickers.flatMap((t) => [...quoteNumbers(t.quote), ...technicalNumbers(t.technical)]),
    ...packet.macro.quotes.flatMap(quoteNumbers),
  ].filter(isFigure);
  const context = extractNumbers(positionContext).flatMap(contextReadings).filter(isFigure);
  return [...new Set([...raw.flatMap(presentationValues), ...context, ...headlineNumbers(packet)])];
}
