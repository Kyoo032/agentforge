/**
 * The named Market agents. One pipeline (packet fetched and computed in code,
 * model narrates, number guard and advice guard unchanged); what differs per
 * agent is the system rules, the default instruction, and the starter
 * watchlist. Adding an agent is an entry here plus one in the meta, the
 * prompts, and the rules — never a second pipeline.
 */

export const MARKET_SPECIALISTS = [
  "saham",
  "forex",
  "gold",
  "crypto",
  "commodities",
  "indices",
  "sector-rotation",
  "scanner",
  "summary",
  "elliott-wave",
  "news",
] as const;
export type MarketSpecialist = (typeof MARKET_SPECIALISTS)[number];

export const DEFAULT_MARKET_SPECIALIST: MarketSpecialist = "saham";

/** What the agent looks at. One per agent, so a renderer can group or icon them. */
export type MarketFocus =
  | "equities"
  | "fx"
  | "commodity"
  | "crypto"
  | "commodities"
  | "indices"
  | "rotation"
  | "scan"
  | "overview"
  | "waves"
  | "news";

const IDS: ReadonlySet<string> = new Set(MARKET_SPECIALISTS);

export function isMarketSpecialist(value: unknown): value is MarketSpecialist {
  return typeof value === "string" && IDS.has(value);
}
