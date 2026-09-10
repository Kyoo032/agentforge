/**
 * Macro snapshot: one Yahoo quote batch over MACRO_SYMBOLS (index futures,
 * VIX, US 10Y, WTI, DXY, IHSG, USD/IDR) with the core labels attached.
 * Symbols Yahoo did not return and a failed batch are failure strings; the
 * snapshot is never a throw.
 */
import { MACRO_SYMBOLS, macroSnapshotSchema, type MacroSnapshot } from "@agentforge/core/market";
import { errorMessage } from "./abort";
import { fetchQuotes, type YahooFetchOptions } from "./yahoo";

export const MACRO_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  MACRO_SYMBOLS.map((entry) => [entry.symbol, entry.label]),
);

export function macroLabel(symbol: string): string {
  return MACRO_LABELS[symbol] ?? "";
}

export async function fetchMacro(opts: YahooFetchOptions = {}): Promise<MacroSnapshot> {
  const symbols = MACRO_SYMBOLS.map((entry) => entry.symbol);
  try {
    const quotes = await fetchQuotes(symbols, opts);
    const returned = new Set(quotes.map((quote) => quote.symbol.toUpperCase()));
    return macroSnapshotSchema.parse({
      quotes: quotes.map((quote) => ({ ...quote, label: macroLabel(quote.symbol) })),
      failures: symbols
        .filter((symbol) => !returned.has(symbol.toUpperCase()))
        .map((symbol) => `${symbol}: no quote returned`),
    });
  } catch (error) {
    return { quotes: [], failures: [`macro: ${errorMessage(error)}`] };
  }
}
