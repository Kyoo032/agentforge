/**
 * StockTwits adapter: how loud, and how bullish, retail chatter is for one
 * ticker right now.
 *
 * Same posture as `coingecko.ts`: bare `fetch` to one fixed HTTPS host,
 * `fetchImpl` injectable so tests run on fixtures, a hard timeout merged with
 * the caller's signal, a body size cap, and zod over everything kept. The
 * counts are structural (tagged Bullish / Bearish messages), so the only vendor
 * free text that survives is up to `STOCKTWITS_SAMPLES_MAX` message bodies,
 * each through `sentimentSample` (injection-scanned, PII-masked, capped).
 *
 * Terms risk: the endpoint is public and unauthenticated today but undocumented
 * for this use and rate limited. Every call is best effort — a failure is a
 * failure string, never a thrown packet.
 */
import { z } from "zod";
import { errorMessage, withTimeout } from "./abort";
import { sentimentSample, sentimentSampleSchema, type SentimentSample } from "./sentiment-sample";

export const STOCKTWITS_ORIGIN = "https://api.stocktwits.com";
/** Every StockTwits call gives up after this long, whatever the caller's signal says. */
export const STOCKTWITS_TIMEOUT_MS = 10_000;
/** A response larger than this is refused unread rather than parsed. */
export const STOCKTWITS_BODY_MAX_BYTES = 1_500_000;
/** Messages read from one stream before the rest are ignored. */
export const STOCKTWITS_MESSAGES_MAX = 30;
/** Message bodies kept as samples. The counts come from the tags, not from these. */
export const STOCKTWITS_SAMPLES_MAX = 3;

export const stocktwitsSentimentSchema = z.object({
  symbol: z.string().min(1),
  /** Messages read (after the cap), i.e. how loud the stream is. */
  total: z.number().int().nonnegative(),
  bullish: z.number().int().nonnegative(),
  bearish: z.number().int().nonnegative(),
  /** How many bodies were kept as samples; always `samples.length`. */
  sampled: z.number().int().nonnegative(),
  samples: z.array(sentimentSampleSchema).max(STOCKTWITS_SAMPLES_MAX),
  observedAt: z.string().datetime({ offset: true }),
});
export type StocktwitsSentiment = z.infer<typeof stocktwitsSentimentSchema>;

export type StocktwitsFetchOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  now?: () => Date;
  timeoutMs?: number;
};

export type StocktwitsResult = {
  sentiment?: StocktwitsSentiment;
  /** "stocktwits: <reason>" when the venue was unreachable; null when it answered, even with nothing. */
  failure: string | null;
};

/**
 * The StockTwits symbol for a Yahoo ticker, or null when the venue does not
 * cover it. `BTC-USD` is `BTC.X`; IDX names (`.JK`) are not listed at all; FX
 * (`=X`), futures (`=F`) and indices (`^`) are out of scope rather than guessed
 * at, since a wrong symbol would count the wrong crowd.
 */
export function stocktwitsSymbol(ticker: string): string | null {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) {
    return null;
  }
  const crypto = /^([A-Z0-9]{2,10})-USD$/.exec(symbol);
  if (crypto) {
    return `${crypto[1]}.X`;
  }
  return /^[A-Z][A-Z0-9-]{0,9}$/.test(symbol) ? symbol : null;
}

export function stocktwitsStreamUrl(symbol: string): string {
  return `${STOCKTWITS_ORIGIN}/api/2/streams/symbol/${encodeURIComponent(symbol)}.json`;
}

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
}

/** "Bullish" / "Bearish" from `entities.sentiment.basic`; anything else is untagged. */
export function messageTag(raw: unknown): "bullish" | "bearish" | null {
  const basic = rec(rec(rec(raw)?.entities)?.sentiment)?.basic;
  const label = typeof basic === "string" ? basic.trim().toLowerCase() : "";
  if (label === "bullish" || label === "bearish") {
    return label;
  }
  return null;
}

/** GET one JSON document under the size cap. Non-2xx, oversize and non-JSON bodies all throw. */
async function getJson(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<unknown> {
  const response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" }, signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > STOCKTWITS_BODY_MAX_BYTES) {
    throw new Error(`response is ${declared} bytes, over the ${STOCKTWITS_BODY_MAX_BYTES} byte cap`);
  }
  const text = await response.text();
  const size = Buffer.byteLength(text, "utf8");
  if (size > STOCKTWITS_BODY_MAX_BYTES) {
    throw new Error(`response is ${size} bytes, over the ${STOCKTWITS_BODY_MAX_BYTES} byte cap`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("response was not JSON");
  }
}

/**
 * Pure: one stream document to a sentiment row. A stream with no messages is a
 * valid answer (zero counts, no samples), not a failure. Throws only when the
 * document has no `messages` list at all.
 */
export function parseStocktwits(symbol: string, payload: unknown, observedAt: string): StocktwitsSentiment {
  const messages = rec(payload)?.messages;
  if (!Array.isArray(messages)) {
    throw new Error("response carried no messages");
  }
  const read = messages.slice(0, STOCKTWITS_MESSAGES_MAX);
  let bullish = 0;
  let bearish = 0;
  const samples: SentimentSample[] = [];
  for (const raw of read) {
    const tag = messageTag(raw);
    if (tag === "bullish") {
      bullish += 1;
    } else if (tag === "bearish") {
      bearish += 1;
    }
    if (samples.length < STOCKTWITS_SAMPLES_MAX) {
      const body = rec(raw)?.body;
      const sample = sentimentSample("stocktwits", typeof body === "string" ? body : "", readCreatedAt(raw));
      if (sample) {
        samples.push(sample);
      }
    }
  }
  return stocktwitsSentimentSchema.parse({
    symbol,
    total: read.length,
    bullish,
    bearish,
    sampled: samples.length,
    samples,
    observedAt,
  });
}

function readCreatedAt(raw: unknown): string | null {
  const at = rec(raw)?.created_at;
  return typeof at === "string" ? at : null;
}

/**
 * The retail read for one ticker. A ticker the venue does not cover returns
 * neither a row nor a failure — it was never asked for. Every error (network,
 * HTTP, oversize, schema drift) is a failure string with no row.
 */
export async function fetchStocktwits(
  ticker: string,
  opts: StocktwitsFetchOptions = {},
): Promise<StocktwitsResult> {
  const symbol = stocktwitsSymbol(ticker);
  if (!symbol) {
    return { failure: null };
  }
  const observedAt = (opts.now ?? (() => new Date()))().toISOString();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { signal, dispose } = withTimeout(opts.signal, opts.timeoutMs ?? STOCKTWITS_TIMEOUT_MS);
  try {
    const payload = await getJson(stocktwitsStreamUrl(symbol), fetchImpl, signal);
    return { sentiment: parseStocktwits(symbol, payload, observedAt), failure: null };
  } catch (error) {
    return { failure: `stocktwits: ${errorMessage(error)}` };
  } finally {
    dispose();
  }
}
