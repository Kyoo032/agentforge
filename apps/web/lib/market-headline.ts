/**
 * What the big number on a ticker card should be. Kept out of the component so
 * it can be tested without a DOM: the rule is subtle and getting it wrong is
 * what made a card read "+2.75%" directly above "Pre-market (-3.05%)".
 */
import { formatNumber, formatPercent, type Quote } from "./market-client";

/** An index or a currency pair is not priced in its quote currency; only a stock is. */
function priceLabel(quote: Quote | null): string {
  if (!quote || quote.price === null) {
    return "";
  }
  const price = formatNumber(quote.price);
  const isIndexOrPair = quote.symbol.startsWith("^") || quote.symbol.includes("=");
  return isIndexOrPair ? price : `${price} ${quote.currency}`.trim();
}

export type Headline = { price: string; percent: number | null; caption: string; note: string };

/**
 * What the big number should be. Outside the regular session a stock trades at
 * its pre-market or after-hours print, so showing yesterday's close and
 * yesterday's move as the headline reads as today's, and contradicts the
 * extended-session line underneath. The latest print leads; the close follows.
 */
export function headlineOf(quote: Quote | null): Headline {
  const blank = { price: "", percent: null, caption: "", note: "" };
  if (!quote) {
    return blank;
  }
  const close = priceLabel(quote);
  const closeNote = close ? `Previous close ${close} (${formatPercent(quote.changePercent) || "unchanged"})` : "";
  if (quote.preMarketPrice !== null) {
    return {
      price: formatNumber(quote.preMarketPrice),
      percent: quote.preMarketChangePercent,
      caption: "Pre-market",
      note: closeNote,
    };
  }
  if (quote.postMarketPrice !== null) {
    return {
      price: formatNumber(quote.postMarketPrice),
      percent: quote.postMarketChangePercent,
      caption: "After hours",
      note: closeNote,
    };
  }
  return { price: close, percent: quote.changePercent, caption: "", note: "" };
}
