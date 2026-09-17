/**
 * Prompt assembly for the Market Watch briefing. The model receives a system
 * text, a compact DATA PACKET block, and the user's own instruction.
 *
 * Which sections that block carries, and in which order, is the chosen desk's
 * harness (`harness.ts`) speaking: a scanner sees the computed SIGNALS table
 * and no headlines, a wave counter sees swing levels and no macro. The
 * renderers themselves live in `packet-sections.ts` and the allowed-number set
 * in `packet-numbers.ts`.
 */
import { UNVERIFIED_MARKER } from "../finance/number-guard";
import { harnessFor, type MarketSource } from "./harness";
import {
  PROMPT_HEADLINES_MAX,
  cryptoGlobalLines,
  cryptoLine,
  fundamentalsLine,
  globalNewsLines,
  insidersLine,
  macroLines,
  metalsLines,
  newsLines,
  quoteLine,
  rotationLines,
  sentimentLines,
  sessionLines,
  signalLines,
  swingLines,
  technicalLine,
  tickerHeader,
} from "./packet-sections";
import { packetNumbers } from "./packet-numbers";
import {
  DEFAULT_MARKET_SPECIALIST,
  MARKET_SPECIALIST_META,
  specialistSystemRules,
  type MarketSpecialist,
} from "./specialists";
import type { MarketWatchPacket, MarketWatchRequest, TickerPacket } from "./watch-schemas";

export { PROMPT_HEADLINES_MAX, packetNumbers };

export const POSITION_CONTEXT_HEADING = "USER POSITION CONTEXT (numbers allowed):";

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
  /** Which named agent is writing. Defaults to the saham desk. */
  specialist?: MarketSpecialist;
};

/**
 * The shared contract (figures only from the packet, no imperative directive,
 * JSON out) plus the chosen agent's own rules. One pipeline, one desk per run.
 */
export function buildWatchSystemPrompt(input: WatchSystemPromptInput): string {
  const language = LANGUAGE_NAMES[input.language] ?? LANGUAGE_NAMES.id;
  const clockLine = input.clockNote.trim() === "" ? [] : [`- Clock context: ${input.clockNote.trim()}`];
  const specialist = input.specialist ?? DEFAULT_MARKET_SPECIALIST;
  const label = MARKET_SPECIALIST_META[specialist].label[input.language] ?? specialist;
  return [
    `You are the "${label}" desk of this market studio.`,
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
    "",
    `Your desk ("${label}"):`,
    ...specialistSystemRules(specialist, input.language),
  ].join("\n");
}

/**
 * Sections printed once for the whole packet, in the order the desk's
 * `packetOrder` lists them. A source absent from the map only contributes
 * inside a ticker block (or, like `history`, is fetched but never printed).
 */
const PACKET_SECTIONS: Partial<Record<MarketSource, (packet: MarketWatchPacket) => string[]>> = {
  macro: macroLines,
  crypto: (packet) => cryptoGlobalLines(packet.cryptoGlobal),
  metals: (packet) => metalsLines(packet.metals),
  signals: (packet) => signalLines(packet.signals),
  rotation: (packet) => rotationLines(packet.rotation),
  sessions: (packet) => sessionLines(packet.sessions),
  globalNews: (packet) => globalNewsLines(packet.globalNews),
};

/**
 * Sections printed as a line inside each ticker block. The order here is
 * fixed: `packetOrder` decides which of them a desk sees, not how a quote and
 * a technical line sit relative to each other.
 */
const TICKER_SECTIONS: readonly (readonly [MarketSource, (ticker: TickerPacket, currency: string) => string[]])[] = [
  ["quotes", (ticker) => [quoteLine(ticker.quote)]],
  ["technicals", (ticker, currency) => [technicalLine(ticker.technical, currency)]],
  ["fundamentals", (ticker, currency) => [fundamentalsLine(ticker.fundamentals, currency)]],
  ["insiders", (ticker) => [insidersLine(ticker.insiders)]],
  ["crypto", (ticker) => [cryptoLine(ticker.crypto)]],
  ["sentiment", (ticker) => sentimentLines(ticker.sentiment)],
  ["swings", (ticker, currency) => swingLines(ticker.swings, currency)],
  ["headlines", (ticker) => newsLines(ticker.news)],
];

const TICKER_SOURCES: ReadonlySet<MarketSource> = new Set(TICKER_SECTIONS.map(([source]) => source));

function tickerBlock(ticker: TickerPacket, wanted: ReadonlySet<MarketSource>): string[] {
  const currency = ticker.quote?.currency || ticker.symbol.currency;
  const lines = TICKER_SECTIONS.filter(([source]) => wanted.has(source)).flatMap(([, render]) =>
    render(ticker, currency),
  );
  const failures = ticker.failures.length === 0 ? [] : [`- failures: ${ticker.failures.join("; ")}`];
  return [tickerHeader(ticker), ...lines, ...failures, ""];
}

/**
 * Compact text the model reads: the clock, then this desk's sections in its
 * own `packetOrder`, then the position context. The ticker blocks are printed
 * where the first ticker-level source appears in that order; a desk whose
 * harness never names a section simply never sees it, which is the whole point
 * of the harness.
 *
 * `only` narrows that order further without ever widening it: at team depth an
 * analyst is handed `analystSections(analyst)` so it reads its own slice of
 * the packet and nothing else (see `team-prompts.ts`). A section the desk does
 * not fetch stays unseen whatever `only` asks for.
 */
export function packetToPromptBlock(
  packet: MarketWatchPacket,
  specialist: MarketSpecialist = DEFAULT_MARKET_SPECIALIST,
  only?: readonly MarketSource[],
): string {
  const allowed: ReadonlySet<MarketSource> | null = only === undefined ? null : new Set(only);
  const order = harnessFor(specialist).packetOrder.filter((source) => allowed === null || allowed.has(source));
  const wanted: ReadonlySet<MarketSource> = new Set(order.filter((source) => TICKER_SOURCES.has(source)));
  const firstTickerIndex = order.findIndex((source) => TICKER_SOURCES.has(source));
  const clock =
    `CLOCK: ${packet.clock.runAt} | U.S. session: ${packet.clock.usSession} | ${packet.clock.note}`.trimEnd();
  const body = order.flatMap((source, index) => [
    ...(PACKET_SECTIONS[source]?.(packet) ?? []),
    ...(index === firstTickerIndex ? packet.tickers.flatMap((ticker) => tickerBlock(ticker, wanted)) : []),
  ]);
  const position =
    packet.positionContext.trim() === "" ? [] : [POSITION_CONTEXT_HEADING, packet.positionContext.trim()];
  return [clock, "", ...body, ...position].join("\n").trimEnd();
}
