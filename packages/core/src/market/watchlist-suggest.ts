/**
 * Typeahead for the Market watchlist. LQ45 (`universe.json`) is the verified
 * Indonesian roster. The US/index rows are only the names this studio already
 * uses in starters and help text — not a world ticker database.
 */
import { LQ45_UNIVERSE } from "./universe";

export type WatchlistSuggestion = {
  ticker: string;
  name: string;
};

type CatalogRow = WatchlistSuggestion & { aliases: readonly string[] };

const FAMILIAR_US: readonly CatalogRow[] = [
  { ticker: "AAPL", name: "Apple", aliases: ["Apple Inc"] },
  { ticker: "AMD", name: "Advanced Micro Devices", aliases: ["AMD"] },
  { ticker: "AVGO", name: "Broadcom", aliases: [] },
  { ticker: "DELL", name: "Dell Technologies", aliases: ["Dell"] },
  { ticker: "GOOGL", name: "Alphabet", aliases: ["Google"] },
  { ticker: "INTC", name: "Intel", aliases: [] },
  { ticker: "MU", name: "Micron Technology", aliases: ["Micron"] },
  { ticker: "NVDA", name: "NVIDIA", aliases: ["Nvidia"] },
  { ticker: "SNOW", name: "Snowflake", aliases: [] },
  { ticker: "SPCX", name: "SPCX", aliases: [] },
  { ticker: "WDC", name: "Western Digital", aliases: [] },
  { ticker: "^VIX", name: "CBOE Volatility Index", aliases: ["VIX"] },
];

const CATALOG: readonly CatalogRow[] = [
  ...LQ45_UNIVERSE.constituents.map((item) => ({
    ticker: item.ticker,
    name: item.name,
    aliases: item.aliases,
  })),
  ...FAMILIAR_US,
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

const EXACT: ReadonlyMap<string, CatalogRow> = new Map(
  CATALOG.flatMap((item) =>
    [item.ticker, item.name, ...item.aliases].map((key): [string, CatalogRow] => [normalize(key), item]),
  ),
);

function rank(row: CatalogRow, query: string): number | null {
  const ticker = normalize(row.ticker);
  const name = normalize(row.name);
  const aliases = row.aliases.map(normalize);
  if (ticker === query) {
    return 0;
  }
  if (aliases.includes(query)) {
    return 1;
  }
  if (name === query) {
    return 2;
  }
  if (ticker.startsWith(query)) {
    return 3;
  }
  if (aliases.some((alias) => alias.startsWith(query))) {
    return 4;
  }
  if (name.startsWith(query)) {
    return 5;
  }
  if (name.includes(query) || aliases.some((alias) => alias.includes(query))) {
    return 6;
  }
  return null;
}

export function lookupWatchTicker(raw: string): string | null {
  const hit = EXACT.get(normalize(raw));
  return hit?.ticker ?? null;
}

/** Exact ticker, name, or alias → the chip symbol. Unknown input is uppercased. */
export function canonicalWatchTicker(raw: string): string {
  return lookupWatchTicker(raw) ?? raw.trim().toUpperCase();
}

/** Ranked matches for the typed fragment. Empty query returns nothing. */
export function suggestWatchlistTickers(
  query: string,
  opts: { exclude?: ReadonlyArray<string>; limit?: number } = {},
): WatchlistSuggestion[] {
  const needle = normalize(query);
  if (needle === "") {
    return [];
  }
  const exclude = new Set((opts.exclude ?? []).map((item) => item.trim().toUpperCase()));
  const limit = opts.limit ?? 8;
  return CATALOG.map((row) => ({ row, score: rank(row, needle) }))
    .filter((item): item is { row: CatalogRow; score: number } => item.score !== null && !exclude.has(item.row.ticker))
    .sort((left, right) => left.score - right.score || left.row.ticker.localeCompare(right.row.ticker))
    .slice(0, limit)
    .map(({ row }) => ({ ticker: row.ticker, name: row.name }));
}
