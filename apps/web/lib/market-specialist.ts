/**
 * Market mode ships one pipeline and several named agents. The picker in the
 * studio only has to do two things: name each agent in the reader's language,
 * and keep the prefilled instruction honest — swap it when the user switches
 * agent or language, leave it alone the moment they have written their own.
 *
 * The logic lives here rather than in the component so it can be unit tested;
 * `apps/web` runs vitest without a DOM.
 */
import {
  CONFIDENCE_LEVELS,
  DEFAULT_MARKET_SPECIALIST,
  MARKET_ANALYSTS,
  MARKET_DEPTHS,
  MARKET_SPECIALISTS,
  MARKET_SPECIALIST_META,
  RISK_LENSES,
  analystsFor,
  defaultWatchPrompt,
  harnessFor,
  isMarketSpecialist,
  teamAvailable,
  type MarketAnalyst,
  type MarketDepth,
  type MarketSource,
  type MarketSpecialist,
} from "@agentforge/core/market";

export {
  CONFIDENCE_LEVELS,
  DEFAULT_MARKET_SPECIALIST,
  MARKET_ANALYSTS,
  MARKET_DEPTHS,
  MARKET_SPECIALISTS,
  MARKET_SPECIALIST_META,
  RISK_LENSES,
  defaultWatchPrompt,
  isMarketSpecialist,
  teamAvailable,
};
export type { MarketAnalyst, MarketDepth, MarketSpecialist };

/** Same two values the briefing language select offers. */
export type SpecialistLanguage = "id" | "en";

/**
 * Every default instruction across both axes. An instruction that still matches
 * one of these was written by us, not by the user, so it is safe to replace.
 */
const DEFAULT_PROMPTS: ReadonlySet<string> = new Set(
  MARKET_SPECIALISTS.flatMap((id) => [defaultWatchPrompt(id, "id").trim(), defaultWatchPrompt(id, "en").trim()]),
);

/** True when the instruction box still holds one of our prefilled defaults. */
export function isDefaultWatchPrompt(prompt: string): boolean {
  return DEFAULT_PROMPTS.has(prompt.trim());
}

export type NextPromptInput = {
  /** What is in the instruction box right now. */
  readonly prompt: string;
  /** The agent that will write the briefing after this change. */
  readonly specialist: MarketSpecialist;
  /** The briefing language after this change. */
  readonly language: SpecialistLanguage;
  /**
   * The default the box was filled with before this change, when the caller
   * knows it. Covers a default that has since been retired from the catalog.
   */
  readonly previousDefault?: string;
};

/**
 * The instruction to show after the agent or the language changed: the new
 * agent's default when the box was untouched, otherwise the user's own words.
 */
export function nextPrompt(input: NextPromptInput): string {
  const current = input.prompt.trim();
  const untouched = current.length === 0 || isDefaultWatchPrompt(current) || current === input.previousDefault?.trim();
  return untouched ? defaultWatchPrompt(input.specialist, input.language) : input.prompt;
}

function resolve(id: MarketSpecialist) {
  return MARKET_SPECIALIST_META[id] ?? MARKET_SPECIALIST_META[DEFAULT_MARKET_SPECIALIST];
}

/** The agent's name in one locale. Used as the fallback behind the i18n catalog. */
export function specialistLabel(id: MarketSpecialist, locale: SpecialistLanguage): string {
  const { label } = resolve(id);
  return locale === "en" ? label.en : label.id;
}

/** The agent's one-line description in one locale. */
export function specialistHint(id: MarketSpecialist, locale: SpecialistLanguage): string {
  const { hint } = resolve(id);
  return locale === "en" ? hint.en : hint.id;
}

/** The watchlist the agent starts from, as a fresh mutable array. */
export function specialistStarterTickers(id: MarketSpecialist): string[] {
  return [...resolve(id).starterTickers];
}

/**
 * Where a briefing's numbers come from. Each agent's harness names the packet
 * sections it fetches or computes; the studio owes the reader one honest line
 * saying which providers that reaches, and which parts never leave the machine.
 *
 * Brand names are not translated. Only the on-device label is, so the caller
 * passes it in rather than this module reaching for the i18n catalog.
 */
export type MarketProviderId = "yahoo" | "tradingview" | "coingecko" | "stocktwits" | "reddit" | "computed";

/**
 * One packet section can reach more than one vendor: the analyst team's
 * `sentiment` section is read off StockTwits and Reddit together, so the badge
 * has to name both. The table is keyed loosely rather than as a total
 * `Record<MarketSource, …>` so the renderer does not break the build the
 * moment core adds a section; `market-specialist.test.ts` walks
 * `MARKET_SOURCES` instead and fails when one is left without a provider.
 */
const PROVIDERS_OF: Readonly<Record<string, readonly MarketProviderId[]>> = Object.freeze({
  quotes: ["yahoo"],
  history: ["yahoo"],
  headlines: ["yahoo"],
  macro: ["yahoo"],
  fundamentals: ["yahoo"],
  insiders: ["yahoo"],
  globalNews: ["yahoo"],
  technicals: ["tradingview"],
  crypto: ["coingecko"],
  sentiment: ["stocktwits", "reddit"],
  metals: ["computed"],
  signals: ["computed"],
  rotation: ["computed"],
  sessions: ["computed"],
  swings: ["computed"],
});

/** The vendor names, which stay in English wherever the studio is read. */
const PROVIDER_BRAND: Readonly<Record<Exclude<MarketProviderId, "computed">, string>> = Object.freeze({
  yahoo: "Yahoo Finance",
  tradingview: "TradingView",
  coingecko: "CoinGecko",
  stocktwits: "StockTwits",
  reddit: "Reddit",
});

/** The providers one packet section reaches, in badge order. Empty for a section we do not map. */
export function sourceProviderIds(source: MarketSource): readonly MarketProviderId[] {
  return PROVIDERS_OF[source] ?? [];
}

/** Separator between providers on the badge. */
const SOURCE_SEPARATOR = " · ";

/**
 * The providers one agent reaches, deduped, in the order its harness lists the
 * sources. Order carries meaning: the first entry is where the quotes come from.
 */
export function specialistProviderIds(id: MarketSpecialist): MarketProviderId[] {
  const seen = new Set<MarketProviderId>();
  const out: MarketProviderId[] = [];
  for (const source of harnessFor(id).sources) {
    for (const provider of sourceProviderIds(source)) {
      if (!seen.has(provider)) {
        seen.add(provider);
        out.push(provider);
      }
    }
  }
  return out;
}

/** The same list as display strings; `computedLabel` is the localized on-device wording. */
export function specialistProviders(id: MarketSpecialist, computedLabel: string): string[] {
  return specialistProviderIds(id).map((provider) =>
    provider === "computed" ? computedLabel : PROVIDER_BRAND[provider],
  );
}

export type SourcesLineInput = {
  readonly specialist: MarketSpecialist;
  /** "Sources" / "Sumber". */
  readonly prefix: string;
  /** "Computed on device" / "Dihitung di perangkat". */
  readonly computedLabel: string;
};

/** The one-line provenance badge: `Sources: Yahoo Finance · TradingView`. */
export function specialistSourcesLine(input: SourcesLineInput): string {
  return `${input.prefix}: ${specialistProviders(input.specialist, input.computedLabel).join(SOURCE_SEPARATOR)}`;
}

/** The depth the studio starts at, and the only one a desk without analysts can be in. */
export const DEFAULT_MARKET_DEPTH: MarketDepth = "quick";

/**
 * Depth is a preference the studio remembers across desks, but not every desk
 * offers the analyst team — `scanner`, `sector-rotation` and `elliott-wave`
 * carry no analysts at all. Switching to one of those falls back to quick
 * rather than sending a depth the host would have to refuse, and switching
 * back to a desk that does offer it starts from quick again rather than
 * silently re-arming a run of up to eight calls.
 */
export function nextDepth(input: { readonly depth: MarketDepth; readonly specialist: MarketSpecialist }): MarketDepth {
  return teamAvailable(input.specialist) ? input.depth : DEFAULT_MARKET_DEPTH;
}

/** The four analysts this desk runs, in core order. Empty when the desk offers no team. */
export function specialistAnalysts(id: MarketSpecialist): readonly MarketAnalyst[] {
  return analystsFor(id);
}
