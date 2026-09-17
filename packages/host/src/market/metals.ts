/**
 * The `metals` packet section for the Gold & Minerals desk, derived from rows
 * already in the packet. No network: every figure here is arithmetic over a
 * quote the packet fetched, so the model never has to eyeball a ratio.
 *
 * `dxy` and `us10y` come from the macro snapshot when it carries them (both
 * are in core's MACRO_SYMBOLS) and from the watchlist quotes otherwise.
 *
 * Honesty about the basis premium: `GC=F` is the front-month future. A true
 * futures-vs-spot premium needs spot gold (`XAUUSD=X`), and only then is the
 * figure published as `goldFuturesVsSpotPct`. `GLD` is an ETF share worth
 * roughly a tenth of an ounce net of fees and is NOT spot, so the figure it
 * produces is published under its own name, `goldFuturesVsGldPct`, and is
 * never passed off as a spot basis. When both are present spot wins.
 *
 * Core's `metalsContextSchema` carries `goldFuturesVsGldPct` under that same
 * name, so the packet builder publishes the figure as itself; the packet block
 * prints it in its own "futures vs GLD" cell.
 */
import type { MacroSnapshot, TickerPacket } from "@agentforge/core/market";

/** Core's WatchSource for a figure the host worked out itself rather than quoted. */
export const METALS_SOURCE = "computed";
export const DXY_SYMBOL = "DX-Y.NYB";
export const US10Y_SYMBOL = "^TNX";
export const GOLD_FUTURES_SYMBOL = "GC=F";
export const SILVER_FUTURES_SYMBOL = "SI=F";
export const GOLD_SPOT_SYMBOL = "XAUUSD=X";
export const GOLD_ETF_SYMBOL = "GLD";
/**
 * One GLD share started at 1/10 oz and drifts down with the expense ratio, so
 * ten shares are an approximation of an ounce and the field name says so.
 */
export const GLD_SHARES_PER_OUNCE = 10;

export type DerivedMetals = {
  dxy?: number;
  us10y?: number;
  goldSilverRatio?: number;
  /** Front-month future against spot gold. Only present when `XAUUSD=X` was fetched. */
  goldFuturesVsSpotPct?: number;
  /** Front-month future against ten GLD shares. A proxy, not a spot basis. */
  goldFuturesVsGldPct?: number;
  source: typeof METALS_SOURCE;
  observedAt: string;
};

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Last traded price, else the previous close, else the last daily bar. Never a guess. */
function closeOf(packet: TickerPacket | undefined): number | null {
  if (!packet) {
    return null;
  }
  const quoted = finite(packet.quote?.price) ?? finite(packet.quote?.previousClose);
  if (quoted !== null) {
    return quoted;
  }
  return finite(packet.history?.bars.at(-1)?.close);
}

function bySymbol(tickers: readonly TickerPacket[]): Map<string, TickerPacket> {
  return new Map(tickers.map((ticker) => [ticker.symbol.yahoo.toUpperCase(), ticker]));
}

function macroLevel(macro: MacroSnapshot | null | undefined, symbol: string): number | null {
  const quote = macro?.quotes.find((row) => row.symbol.toUpperCase() === symbol.toUpperCase());
  return finite(quote?.price) ?? finite(quote?.previousClose);
}

function percentDiff(value: number, basis: number): number | null {
  return basis === 0 ? null : ((value - basis) / basis) * 100;
}

function withNumber(out: Record<string, unknown>, key: string, value: number | null): void {
  if (value !== null && Number.isFinite(value)) {
    out[key] = value;
  }
}

/**
 * Pure derivation over the packet's own rows. Returns `undefined` when nothing
 * could be derived, so the caller leaves the section off the packet entirely
 * instead of shipping an empty object.
 */
export function deriveMetals(
  tickers: readonly TickerPacket[],
  macro: MacroSnapshot | null | undefined,
  observedAt: string,
): DerivedMetals | undefined {
  const quotes = bySymbol(tickers);
  const at = (symbol: string) => closeOf(quotes.get(symbol.toUpperCase()));

  const out: Record<string, unknown> = {};
  withNumber(out, "dxy", macroLevel(macro, DXY_SYMBOL) ?? at(DXY_SYMBOL));
  withNumber(out, "us10y", macroLevel(macro, US10Y_SYMBOL) ?? at(US10Y_SYMBOL));

  const gold = at(GOLD_FUTURES_SYMBOL);
  const silver = at(SILVER_FUTURES_SYMBOL);
  if (gold !== null && silver !== null && silver !== 0) {
    withNumber(out, "goldSilverRatio", gold / silver);
  }

  if (gold !== null) {
    const spot = at(GOLD_SPOT_SYMBOL);
    const gld = at(GOLD_ETF_SYMBOL);
    if (spot !== null) {
      withNumber(out, "goldFuturesVsSpotPct", percentDiff(gold, spot));
    } else if (gld !== null) {
      withNumber(out, "goldFuturesVsGldPct", percentDiff(gold, gld * GLD_SHARES_PER_OUNCE));
    }
  }

  if (Object.keys(out).length === 0) {
    return undefined;
  }
  return { ...out, source: METALS_SOURCE, observedAt } as DerivedMetals;
}
