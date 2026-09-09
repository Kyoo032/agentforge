/**
 * Presentation precision for the Market Watch prompt block. The model copies
 * what it sees, so the packet is shown rounded (no raw floats like 935.6381)
 * and the number guard is given every rounded reading next to the raw value.
 */

export const PRICE_DECIMALS = 2;
export const PERCENT_DECIMALS = 2;
export const RSI_DECIMALS = 1;
export const SCORE_DECIMALS = 2;
/** Prices at or above this level are shown in whole units. */
export const WHOLE_UNIT_MIN = 1000;
/** Currencies quoted in whole units regardless of level. */
export const WHOLE_UNIT_CURRENCIES: ReadonlySet<string> = new Set(["IDR"]);
const PRESENTATION_DECIMALS = [0, 1, 2] as const;

function roundTo(value: number, decimals: number): number {
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** `toFixed` that keeps trailing zeros but never prints "-0.00". */
export function formatFixed(value: number, decimals: number): string {
  return roundTo(value, decimals).toFixed(decimals);
}

export function priceDecimals(value: number, currency: string): number {
  const wholeUnits = WHOLE_UNIT_CURRENCIES.has(currency.toUpperCase()) || Math.abs(value) >= WHOLE_UNIT_MIN;
  return wholeUnits ? 0 : PRICE_DECIMALS;
}

export function formatPrice(value: number, currency: string): string {
  return formatFixed(value, priceDecimals(value, currency));
}

/** "+3.73%", "-0.06%", "0.00%". */
export function formatPercent(value: number): string {
  const sign = roundTo(value, PERCENT_DECIMALS) > 0 ? "+" : "";
  return `${sign}${formatFixed(value, PERCENT_DECIMALS)}%`;
}

/** The raw value, its 0/1/2-decimal presentations, and the absolute values of the negatives among them; unique. */
export function presentationValues(value: number): number[] {
  const readings = [value, ...PRESENTATION_DECIMALS.map((decimals) => roundTo(value, decimals))];
  const unique = [...new Set(readings)];
  const absolutes = [...new Set(unique.filter((reading) => reading < 0).map(Math.abs))];
  return [...unique, ...absolutes];
}
