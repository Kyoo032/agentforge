/**
 * Symbol resolution for Market Watch v2: user input -> Yahoo symbol ->
 * TradingView "EXCHANGE:SYMBOL" and scanner market. Pure string mapping; the
 * host confirms the exchange code from the live quote.
 */
import { findConstituent } from "./universe";
import { WATCHLIST_MAX } from "./watch-schemas";

const INPUT_SEPARATOR = /[\s,;]+/;
const LEADING_DOLLAR = /^\$+/;

/** TradingView exchange by Yahoo `fullExchangeName` / `exchange` code. */
const EXCHANGE_BY_YAHOO_CODE: Readonly<Record<string, string>> = {
  NMS: "NASDAQ",
  NGM: "NASDAQ",
  NCM: "NASDAQ",
  NAS: "NASDAQ",
  NYQ: "NYSE",
  PCX: "AMEX",
  ASE: "AMEX",
  JKT: "IDX",
  LSE: "LSE",
  TYO: "TSE",
  JPX: "TSE",
  HKG: "HKEX",
};

/** Fallback when the quote carries no exchange code: infer from the Yahoo suffix. */
const EXCHANGE_BY_YAHOO_SUFFIX: Readonly<Record<string, string>> = {
  JK: "IDX",
  L: "LSE",
  T: "TSE",
  HK: "HKEX",
};

/** TradingView scanner market by exchange prefix. */
const MARKET_BY_EXCHANGE: Readonly<Record<string, string>> = {
  NASDAQ: "america",
  NYSE: "america",
  AMEX: "america",
  IDX: "indonesia",
  LSE: "uk",
  TSE: "japan",
  HKEX: "hongkong",
};

const US_EXCHANGES: ReadonlySet<string> = new Set(["NASDAQ", "NYSE", "AMEX"]);
const HK_LEADING_ZEROS = /^0+(?=\d)/;

/* TradingView's own thresholds on the -1..1 recommendation score. Labels are the vendor's words. */
export const TV_STRONG_BUY_MIN = 0.5;
export const TV_BUY_MIN = 0.1;
export const TV_NEUTRAL_MIN = -0.1;
export const TV_SELL_MIN = -0.5;

/**
 * The shape every venue we support agrees on: an optional `^` for an index,
 * then letters/digits, then the punctuation used by suffixes and pairs
 * (`BBCA.JK`, `ES=F`, `DX-Y.NYB`, `BRK-B`). Anything else is a typo, not a
 * symbol, and is better refused in the studio than sent to Yahoo.
 */
export const TICKER_PATTERN = /^\^?[A-Z0-9][A-Z0-9.=-]{0,19}$/;

/**
 * A bare run of digits is a quantity, not a symbol: "buy 100 shares" must not
 * put a chip called 100 on the watchlist. Numeric tickers do exist, but only
 * with a venue suffix (`0700.HK`, `7203.T`), which this still allows.
 */
const BARE_DIGITS = /^\d+$/;

export function isValidTicker(symbol: string): boolean {
  return TICKER_PATTERN.test(symbol) && !BARE_DIGITS.test(symbol);
}

/** One typed token, cleaned: `$mu ` → `MU`. Not necessarily a valid symbol. */
function cleanToken(token: string): string {
  return token.replace(LEADING_DOLLAR, "").trim().toUpperCase();
}

/**
 * Split free text into tickers and the tokens that could not be one.
 * Separators are commas, whitespace, and semicolons; `$` is stripped;
 * duplicates collapse; the watchlist cap applies to what survives.
 */
export function partitionTickerInput(raw: string): { tickers: string[]; rejected: string[] } {
  if (typeof raw !== "string") {
    return { tickers: [], rejected: [] };
  }
  const tokens = raw
    .split(INPUT_SEPARATOR)
    .map(cleanToken)
    .filter((token) => token !== "");
  const tickers = [...new Set(tokens.filter(isValidTicker))].slice(0, WATCHLIST_MAX);
  const rejected = [...new Set(tokens.filter((token) => !isValidTicker(token)))];
  return { tickers, rejected };
}

/** Split free text into tickers: commas, whitespace, semicolons; strip `$`; uppercase; dedupe; cap. */
export function normalizeTickerInput(raw: string): string[] {
  return partitionTickerInput(raw).tickers;
}

/** Futures (`=F`), FX (`=X`), and indices (`^`) have no TradingView equity symbol. */
export function isNonEquitySymbol(symbol: string): boolean {
  return symbol.includes("=") || symbol.startsWith("^");
}

/** Keep suffixed / futures / index / FX input as-is; map IDX names and aliases to `.JK`; else the bare U.S. symbol. */
export function toYahooSymbol(input: string): string {
  const cleaned = input.trim().replace(LEADING_DOLLAR, "").toUpperCase();
  if (cleaned === "" || isNonEquitySymbol(cleaned) || cleaned.includes(".")) {
    return cleaned;
  }
  return findConstituent(cleaned)?.yahoo ?? cleaned;
}

function tradingViewBase(base: string, exchange: string): string {
  if (exchange === "HKEX") {
    return base.replace(HK_LEADING_ZEROS, "");
  }
  return US_EXCHANGES.has(exchange) ? base.replace("-", ".") : base;
}

/** "EXCHANGE:SYMBOL" for TradingView, or null for futures, indices, FX, and unknown exchanges. */
export function toTradingViewSymbol(yahooSymbol: string, exchangeCode: string): string | null {
  const symbol = yahooSymbol.trim().toUpperCase();
  if (symbol === "" || isNonEquitySymbol(symbol)) {
    return null;
  }
  const dot = symbol.lastIndexOf(".");
  const base = dot === -1 ? symbol : symbol.slice(0, dot);
  const suffix = dot === -1 ? "" : symbol.slice(dot + 1);
  const exchange = EXCHANGE_BY_YAHOO_CODE[exchangeCode.trim().toUpperCase()] ?? EXCHANGE_BY_YAHOO_SUFFIX[suffix];
  if (exchange === undefined || base === "") {
    return null;
  }
  return `${exchange}:${tradingViewBase(base, exchange)}`;
}

/** Scanner market ("america", "indonesia", ...) for a TradingView symbol, or null when unknown. */
export function tradingViewMarket(tvSymbol: string): string | null {
  const colon = tvSymbol.indexOf(":");
  if (colon <= 0) {
    return null;
  }
  return MARKET_BY_EXCHANGE[tvSymbol.slice(0, colon).toUpperCase()] ?? null;
}

/** TradingView's own label for a -1..1 recommendation score; empty when the score is missing. */
export function tradingViewLabel(score: number | null): string {
  if (score === null || Number.isNaN(score)) {
    return "";
  }
  if (score > TV_STRONG_BUY_MIN) {
    return "STRONG_BUY";
  }
  if (score > TV_BUY_MIN) {
    return "BUY";
  }
  if (score >= TV_NEUTRAL_MIN) {
    return "NEUTRAL";
  }
  return score >= TV_SELL_MIN ? "SELL" : "STRONG_SELL";
}
