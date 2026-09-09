/**
 * IDX alias helper. `universe.json` is the verified LQ45 roster copied from
 * the Python reference repo (period, source URL, and verification note
 * inside). In Market Watch v2 it only resolves Indonesian tickers, names, and
 * aliases ("BCA", "Astra") to their Yahoo `.JK` symbols; it is not a universe
 * gate. Rotating the roster after an IDX review is a config change to that
 * file, not code.
 */
import { z } from "zod";
import universeJson from "./universe.json";

export const universeConstituentSchema = z.object({
  ticker: z.string().min(1),
  /** Yahoo Finance symbol, e.g. BBCA.JK. */
  yahoo: z.string().min(1),
  /** TradingView symbol (unused in v1, kept for the MCP server). */
  tv: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
});
export type UniverseConstituent = z.infer<typeof universeConstituentSchema>;

export const universeSchema = z.object({
  index: z.string().min(1),
  as_of: z.string().min(1),
  source_url: z.string().url(),
  verified: z.boolean(),
  note: z.string().default(""),
  constituents: z.array(universeConstituentSchema).min(1),
});
export type Universe = z.infer<typeof universeSchema>;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
    Object.freeze(value);
  }
  return value;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Validated at module load; a malformed roster fails the import (fail loud). */
export const LQ45_UNIVERSE: Readonly<Universe> = deepFreeze(universeSchema.parse(universeJson));

export const LQ45_TICKERS: readonly string[] = Object.freeze(LQ45_UNIVERSE.constituents.map((item) => item.ticker));

const LOOKUP: ReadonlyMap<string, UniverseConstituent> = new Map(
  LQ45_UNIVERSE.constituents.flatMap((item) =>
    [item.ticker, item.name, ...item.aliases].map((key): [string, UniverseConstituent] => [normalize(key), item]),
  ),
);

/** Case-insensitive lookup over ticker, company name, and aliases. */
export function findConstituent(tickerOrAlias: string): UniverseConstituent | null {
  const key = normalize(tickerOrAlias);
  return key === "" ? null : (LOOKUP.get(key) ?? null);
}

export function isKnownTicker(tickerOrAlias: string): boolean {
  return findConstituent(tickerOrAlias) !== null;
}
