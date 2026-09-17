/**
 * CoinGecko + Binance adapters for the crypto desk: global market cap and
 * dominance, per-coin market cap / 24h volume / 7d change, and the perpetual
 * funding rate.
 *
 * Same posture as `tradingview.ts`: bare `fetch` to one fixed HTTPS host, JSON
 * in and out, a hard timeout merged with the caller's signal, `fetchImpl`
 * injectable so tests run on fixtures and never on sockets.
 *
 * Injection safety is structural, not filtered: every field kept here is a
 * number validated by zod, and the only string in a payload is the literal
 * `source` this module writes itself. No vendor free text ever reaches a
 * prompt, so there is nothing for `sanitizeExternalText` to scan.
 *
 * Terms risk: both endpoints are public and unauthenticated today but are rate
 * limited and undocumented for this use. Every call is best-effort — a failure
 * is a failure string or `undefined`, never a thrown packet.
 */
import { z } from "zod";
import { errorMessage, withTimeout } from "./abort";

export const COINGECKO_ORIGIN = "https://api.coingecko.com";
export const BINANCE_FUTURES_ORIGIN = "https://fapi.binance.com";
/** Every crypto call gives up after this long, whatever the caller's signal says. */
export const CRYPTO_TIMEOUT_MS = 10_000;
/** A response larger than this is refused unread rather than parsed. */
export const CRYPTO_BODY_MAX_BYTES = 1_500_000;
/** The literal written into every payload's `source`; no vendor string is ever kept. */
export const CRYPTO_SOURCE = "coingecko";

/**
 * Yahoo crypto symbols ("BTC-USD") to CoinGecko coin ids. A ticker outside
 * this table is skipped rather than guessed — an id guessed wrong would price
 * the wrong coin.
 */
export const COINGECKO_IDS: Readonly<Record<string, string>> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  MATIC: "polygon-ecosystem-token",
  POL: "polygon-ecosystem-token",
  TON: "the-open-network",
};

export type CryptoFetchOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  now?: () => Date;
  timeoutMs?: number;
};

/* Payloads. Numbers only plus the source literal this module writes. */

export const cryptoGlobalSchema = z.object({
  totalMarketCapUsd: z.number().finite(),
  btcDominancePct: z.number().finite(),
  ethDominancePct: z.number().finite(),
  source: z.literal(CRYPTO_SOURCE).default(CRYPTO_SOURCE),
  observedAt: z.string().datetime({ offset: true }),
});
export type CryptoGlobal = z.infer<typeof cryptoGlobalSchema>;

export const cryptoMarketSchema = z.object({
  ticker: z.string().min(1),
  marketCapUsd: z.number().finite().nullable().default(null),
  volume24hUsd: z.number().finite().nullable().default(null),
  change7dPct: z.number().finite().nullable().default(null),
  source: z.literal(CRYPTO_SOURCE).default(CRYPTO_SOURCE),
  observedAt: z.string().datetime({ offset: true }),
});
export type CryptoMarket = z.infer<typeof cryptoMarketSchema>;

export const cryptoFundingSchema = z.object({
  ticker: z.string().min(1),
  fundingRatePct: z.number().finite(),
  source: z.literal("binance").default("binance"),
  observedAt: z.string().datetime({ offset: true }),
});
export type CryptoFunding = z.infer<typeof cryptoFundingSchema>;

/** "BTC-USD" -> "BTC"; anything that is not a `-USD` pair is not a crypto ticker here. */
export function cryptoBase(ticker: string): string | null {
  const match = /^([A-Z0-9]{2,10})-USD$/.exec(ticker.trim().toUpperCase());
  return match ? (match[1] as string) : null;
}

/** "BTC-USD" -> "bitcoin". Unknown bases and non-crypto tickers are null (skipped by the callers). */
export function coingeckoId(ticker: string): string | null {
  const base = cryptoBase(ticker);
  return base ? (COINGECKO_IDS[base] ?? null) : null;
}

export function cryptoGlobalUrl(): string {
  return `${COINGECKO_ORIGIN}/api/v3/global`;
}

export function cryptoMarketsUrl(ids: readonly string[]): string {
  return `${COINGECKO_ORIGIN}/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(
    [...ids].join(","),
  )}&price_change_percentage=7d`;
}

export function fundingRateUrl(base: string): string {
  return `${BINANCE_FUTURES_ORIGIN}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(`${base}USDT`)}`;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Binance returns numbers as strings; a non-numeric string is null, never NaN. */
function numeric(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** GET one JSON document under the size cap. Non-2xx, oversize and non-JSON bodies all throw. */
async function getJson(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<unknown> {
  const response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" }, signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > CRYPTO_BODY_MAX_BYTES) {
    throw new Error(`response is ${declared} bytes, over the ${CRYPTO_BODY_MAX_BYTES} byte cap`);
  }
  const text = await response.text();
  const size = Buffer.byteLength(text, "utf8");
  if (size > CRYPTO_BODY_MAX_BYTES) {
    throw new Error(`response is ${size} bytes, over the ${CRYPTO_BODY_MAX_BYTES} byte cap`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("response was not JSON");
  }
}

async function withCryptoTimeout<T>(opts: CryptoFetchOptions, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const { signal, dispose } = withTimeout(opts.signal, opts.timeoutMs ?? CRYPTO_TIMEOUT_MS);
  try {
    return await run(signal);
  } finally {
    dispose();
  }
}

/** Pure: the `/global` document to a CryptoGlobal. Missing or non-numeric totals throw. */
export function parseCryptoGlobal(payload: unknown, observedAt: string): CryptoGlobal {
  const data = rec(rec(payload)?.data);
  const totalMarketCap = rec(data?.total_market_cap);
  const dominance = rec(data?.market_cap_percentage);
  return cryptoGlobalSchema.parse({
    totalMarketCapUsd: finite(totalMarketCap?.usd),
    btcDominancePct: finite(dominance?.btc),
    ethDominancePct: finite(dominance?.eth),
    source: CRYPTO_SOURCE,
    observedAt,
  });
}

/**
 * Total crypto market cap in USD plus BTC/ETH dominance. Errors (network,
 * HTTP, oversize, schema drift) come back as `undefined` with a failure note;
 * the packet never fails over a missing dominance figure.
 */
export async function fetchCryptoGlobal(
  opts: CryptoFetchOptions = {},
): Promise<{ global?: CryptoGlobal; failure: string | null }> {
  const observedAt = (opts.now ?? (() => new Date()))().toISOString();
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const payload = await withCryptoTimeout(opts, (signal) => getJson(cryptoGlobalUrl(), fetchImpl, signal));
    return { global: parseCryptoGlobal(payload, observedAt), failure: null };
  } catch (error) {
    return { failure: `crypto-global: ${errorMessage(error)}` };
  }
}

/** Pure: `/coins/markets` rows back to the tickers that asked for them. Rows for other ids are ignored. */
export function parseCryptoMarkets(
  payload: unknown,
  byId: ReadonlyMap<string, string>,
  observedAt: string,
): Map<string, CryptoMarket> {
  const out = new Map<string, CryptoMarket>();
  if (!Array.isArray(payload)) {
    throw new Error("response was not a list of coins");
  }
  for (const raw of payload) {
    const row = rec(raw);
    const id = typeof row?.id === "string" ? row.id : "";
    const ticker = byId.get(id);
    if (!ticker) {
      continue;
    }
    out.set(
      ticker,
      cryptoMarketSchema.parse({
        ticker,
        marketCapUsd: finite(row?.market_cap),
        volume24hUsd: finite(row?.total_volume),
        change7dPct: finite(row?.price_change_percentage_7d_in_currency),
        source: CRYPTO_SOURCE,
        observedAt,
      }),
    );
  }
  return out;
}

/**
 * Market cap, 24h volume and 7d change per ticker, one batch for every ticker
 * this module has an id for. Tickers without an id are skipped silently (they
 * are simply not crypto); a failed batch is one failure string and an empty map.
 */
export async function fetchCryptoMarkets(
  tickers: readonly string[],
  opts: CryptoFetchOptions = {},
): Promise<{ markets: Map<string, CryptoMarket>; failures: string[] }> {
  const byId = new Map<string, string>();
  for (const ticker of tickers) {
    const id = coingeckoId(ticker);
    // First ticker wins when two inputs map to the same id (MATIC-USD and POL-USD).
    if (id && !byId.has(id)) {
      byId.set(id, ticker);
    }
  }
  if (byId.size === 0) {
    return { markets: new Map(), failures: [] };
  }
  const observedAt = (opts.now ?? (() => new Date()))().toISOString();
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const payload = await withCryptoTimeout(opts, (signal) =>
      getJson(cryptoMarketsUrl([...byId.keys()]), fetchImpl, signal),
    );
    const markets = parseCryptoMarkets(payload, byId, observedAt);
    const missing = [...byId.values()].filter((ticker) => !markets.has(ticker));
    return { markets, failures: missing.map((ticker) => `crypto: ${ticker} was not in the CoinGecko batch`) };
  } catch (error) {
    return { markets: new Map(), failures: [`crypto: ${errorMessage(error)}`] };
  }
}

/**
 * Perpetual funding rate for one ticker, as a percentage (`lastFundingRate`
 * times 100). Binance blocks some regions outright, so every failure —
 * including an unknown symbol — is `undefined` and never throws out.
 */
export async function fetchFundingRate(
  ticker: string,
  opts: CryptoFetchOptions = {},
): Promise<CryptoFunding | undefined> {
  const base = cryptoBase(ticker);
  if (!base) {
    return undefined;
  }
  const observedAt = (opts.now ?? (() => new Date()))().toISOString();
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const payload = await withCryptoTimeout(opts, (signal) => getJson(fundingRateUrl(base), fetchImpl, signal));
    const rate = numeric(rec(payload)?.lastFundingRate);
    if (rate === null) {
      return undefined;
    }
    return cryptoFundingSchema.parse({ ticker, fundingRatePct: rate * 100, source: "binance", observedAt });
  } catch {
    return undefined;
  }
}
