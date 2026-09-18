/**
 * Per-agent harness: what each named Market desk actually fetches, computes,
 * and is allowed to reach for.
 *
 * The principle is unchanged — code fetches and computes, the model narrates —
 * but a scanner has no business paying for headlines and a wave counter needs
 * two years of bars, not six months. This table is the single place that says
 * so. The host reads `sources` to decide which fetchers run, `historyMonths`
 * to size the bar request, `headlineCap` to trim the news, and `tools` /
 * `webResearch` to bind the model's tools; `briefing-prompt.ts` reads
 * `packetOrder` to decide which sections are rendered and in what order.
 *
 * Depth is not a taste: `computeTechnical` needs about 200 daily bars for
 * `sma200` and a full 252 for the 52-week high and low, so any desk that lists
 * `technicals` — or `signals` / `rotation`, which are computed from them —
 * asks for 12 months. Six months only buys bars for a desk that reads quotes
 * and headlines. `sector-rotation` also needs a base bar six months back for
 * `ret6mPct`, which a six-month window cannot reliably supply.
 *
 * Invariants asserted in `harness.test.ts`: every specialist has a spec,
 * `packetOrder` is a subset of `sources`, tools are non-empty,
 * `historyMonths` is one of the three supported depths, and every computed-
 * chart desk is at 12 months or deeper.
 */
import { MARKET_SPECIALISTS, type MarketSpecialist } from "./specialist-ids";
import type { MarketAnalyst } from "./team";

/** A packet section: fetched over the network, or computed in code from what was fetched. */
export const MARKET_SOURCES = [
  "quotes",
  "history",
  "technicals",
  "macro",
  "headlines",
  "swings",
  "crypto",
  "metals",
  "signals",
  "rotation",
  "sessions",
  "fundamentals",
  "insiders",
  "sentiment",
  "globalNews",
] as const;
export type MarketSource = (typeof MARKET_SOURCES)[number];

/**
 * A model tool binding, named in core terms. The host maps these onto its own
 * binding names (`quotes` -> `market_quotes`, `technical` -> `market_technical`,
 * and so on); core never names a host binding.
 */
export const MARKET_TOOL_KEYS = ["quotes", "history", "technical", "macro", "news", "calculator"] as const;
export type MarketToolKey = (typeof MARKET_TOOL_KEYS)[number];

/** Bar depths the history fetcher supports. Anything else is a typo, not a choice. */
export const HISTORY_MONTHS_ALLOWED = [6, 12, 24] as const;
export type HistoryMonths = (typeof HISTORY_MONTHS_ALLOWED)[number];

export type MarketHarnessSpec = {
  readonly specialist: MarketSpecialist;
  /** Which packet sections are fetched or computed for this desk. */
  readonly sources: readonly MarketSource[];
  /** Bars depth requested from the history fetcher. */
  readonly historyMonths: HistoryMonths;
  /** Headlines kept per ticker; 0 means the desk gets none. */
  readonly headlineCap: number;
  /** Model tool bindings for this desk, in core names. */
  readonly tools: readonly MarketToolKey[];
  /** Bind web_search / web_fetch when the host has a web backend ready. */
  readonly webResearch: boolean;
  /**
   * Sections rendered by `packetToPromptBlock`, in order. A subset of
   * `sources`: `history` is fetched for the chart and the computed sections
   * but never printed as bars, so it never appears here.
   */
  readonly packetOrder: readonly MarketSource[];
  /**
   * The analysts this desk runs at `team` depth, in the order they are
   * dispatched. An empty list means the desk is quick-only: a scanner reading
   * a computed table and a wave counter labelling pivots have nothing for four
   * analysts to disagree about, and paying eight model calls to find that out
   * is not a feature. See `team.ts`.
   */
  readonly analysts: readonly MarketAnalyst[];
};

const SPECS: Readonly<Record<MarketSpecialist, MarketHarnessSpec>> = {
  saham: {
    specialist: "saham",
    sources: [
      "quotes",
      "history",
      "technicals",
      "macro",
      "headlines",
      "sessions",
      "fundamentals",
      "insiders",
      "sentiment",
    ],
    historyMonths: 12,
    headlineCap: 5,
    tools: ["quotes", "history", "technical", "news", "calculator"],
    webResearch: true,
    packetOrder: ["macro", "sessions", "quotes", "technicals", "fundamentals", "insiders", "sentiment", "headlines"],
    analysts: ["technical", "fundamentals", "sentiment", "news"],
  },
  forex: {
    specialist: "forex",
    sources: ["quotes", "history", "technicals", "macro", "headlines", "sessions", "globalNews"],
    historyMonths: 12,
    headlineCap: 4,
    tools: ["quotes", "history", "technical", "macro", "calculator"],
    webResearch: true,
    packetOrder: ["macro", "globalNews", "sessions", "quotes", "technicals", "headlines"],
    analysts: ["technical", "news"],
  },
  gold: {
    specialist: "gold",
    sources: ["quotes", "history", "technicals", "metals", "macro", "headlines", "globalNews"],
    historyMonths: 12,
    headlineCap: 4,
    tools: ["quotes", "history", "technical", "macro", "news", "calculator"],
    webResearch: true,
    packetOrder: ["macro", "metals", "globalNews", "quotes", "technicals", "headlines"],
    analysts: ["technical", "news"],
  },
  crypto: {
    specialist: "crypto",
    sources: ["quotes", "history", "technicals", "crypto", "headlines", "sentiment"],
    historyMonths: 12,
    headlineCap: 5,
    tools: ["quotes", "history", "technical", "news", "calculator"],
    webResearch: true,
    packetOrder: ["crypto", "quotes", "technicals", "sentiment", "headlines"],
    analysts: ["technical", "sentiment", "news"],
  },
  commodities: {
    specialist: "commodities",
    sources: ["quotes", "history", "technicals", "macro", "headlines", "globalNews"],
    historyMonths: 12,
    headlineCap: 4,
    tools: ["quotes", "history", "technical", "macro", "news", "calculator"],
    webResearch: true,
    packetOrder: ["macro", "globalNews", "quotes", "technicals", "headlines"],
    analysts: ["technical", "news"],
  },
  indices: {
    specialist: "indices",
    sources: ["quotes", "history", "technicals", "macro", "sessions", "globalNews"],
    historyMonths: 12,
    headlineCap: 3,
    tools: ["quotes", "history", "technical", "macro", "calculator"],
    webResearch: false,
    packetOrder: ["macro", "globalNews", "sessions", "quotes", "technicals"],
    analysts: ["technical", "news"],
  },
  "sector-rotation": {
    specialist: "sector-rotation",
    sources: ["quotes", "history", "rotation"],
    historyMonths: 12,
    headlineCap: 0,
    tools: ["quotes", "history", "calculator"],
    webResearch: false,
    packetOrder: ["rotation", "quotes"],
    analysts: [],
  },
  scanner: {
    specialist: "scanner",
    sources: ["quotes", "technicals", "signals"],
    historyMonths: 12,
    headlineCap: 0,
    tools: ["quotes", "technical", "calculator"],
    webResearch: false,
    packetOrder: ["signals", "quotes", "technicals"],
    analysts: [],
  },
  summary: {
    specialist: "summary",
    sources: ["quotes", "macro", "sessions", "headlines", "globalNews"],
    historyMonths: 6,
    headlineCap: 2,
    tools: ["quotes", "macro", "news", "calculator"],
    webResearch: true,
    packetOrder: ["macro", "globalNews", "sessions", "quotes", "headlines"],
    analysts: ["news"],
  },
  "elliott-wave": {
    specialist: "elliott-wave",
    sources: ["quotes", "history", "swings"],
    historyMonths: 24,
    headlineCap: 0,
    tools: ["quotes", "history", "calculator"],
    webResearch: false,
    packetOrder: ["quotes", "swings"],
    analysts: [],
  },
  news: {
    specialist: "news",
    sources: ["quotes", "headlines", "sentiment", "globalNews"],
    historyMonths: 6,
    headlineCap: 10,
    tools: ["news", "quotes", "calculator"],
    webResearch: true,
    packetOrder: ["globalNews", "quotes", "sentiment", "headlines"],
    analysts: ["news", "sentiment"],
  },
};

/** The harness table. Frozen: a desk's reach is configuration, not state. */
export const MARKET_HARNESS: Readonly<Record<MarketSpecialist, MarketHarnessSpec>> = Object.freeze(SPECS);

const FALLBACK: MarketSpecialist = MARKET_SPECIALISTS[0];

/** The harness for one desk. An unknown id falls back to the first desk rather than throwing. */
export function harnessFor(specialist: MarketSpecialist): MarketHarnessSpec {
  return MARKET_HARNESS[specialist] ?? MARKET_HARNESS[FALLBACK];
}
