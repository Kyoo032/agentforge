import type { BriefingSection, MarketBriefing } from "@agentforge/core/artifacts";
import type { JobProgress } from "@agentforge/core/jobs";
import {
  ADVICE_MARKER,
  WATCHLIST_MAX,
  normalizeTickerInput,
  partitionTickerInput,
  TEAM_SECTION_KEYS,
  teamSectionHeadings,
  type AnalystNote,
  type DebateSide,
  type MacroSnapshot,
  type MarketBoard,
  type MarketClock,
  type MarketWatchPacket,
  type MarketWatchRequest,
  type Quote,
  type RiskLens,
  type RiskRead,
  type Technical,
  type TeamSectionKey,
  type TeamNotes,
  type TickerPacket,
  type WatchNewsItem,
} from "@agentforge/core/market";
import { apiFetch, isElectron } from "./api-client";
import { saveBlob } from "./artifacts-client";
import {
  CONFIDENCE_LEVELS,
  DEFAULT_MARKET_DEPTH,
  DEFAULT_MARKET_SPECIALIST,
  MARKET_ANALYSTS,
  MARKET_DEPTHS,
  MARKET_SPECIALISTS,
  MARKET_SPECIALIST_META,
  RISK_LENSES,
  defaultWatchPrompt,
  isMarketSpecialist,
  nextDepth,
  nextPrompt,
  specialistAnalysts,
  specialistHint,
  specialistLabel,
  specialistStarterTickers,
  teamAvailable,
  type MarketAnalyst,
  type MarketDepth,
  type MarketSpecialist,
} from "./market-specialist";

/*
 * `MarketWatchRequest` already carries `specialist` (the core zod schema
 * defaults it to `saham`), so the studio only has to put the chosen agent in
 * the body it posts to /api/v1/market and /api/v1/market/stream. The rewrite
 * route reads the agent back off `briefing.specialist`, so it needs no field
 * of its own. These re-exports keep the studio on one import.
 */
export {
  CONFIDENCE_LEVELS,
  DEFAULT_MARKET_DEPTH,
  DEFAULT_MARKET_SPECIALIST,
  MARKET_ANALYSTS,
  MARKET_DEPTHS,
  MARKET_SPECIALISTS,
  MARKET_SPECIALIST_META,
  RISK_LENSES,
  defaultWatchPrompt,
  isMarketSpecialist,
  nextDepth,
  nextPrompt,
  specialistAnalysts,
  specialistHint,
  specialistLabel,
  specialistStarterTickers,
  teamAvailable,
  teamSectionHeadings,
  TEAM_SECTION_KEYS,
};
export type { MarketAnalyst, MarketDepth, MarketSpecialist };

export type {
  AnalystNote,
  BriefingSection,
  DebateSide,
  MacroSnapshot,
  MarketBoard,
  MarketBriefing,
  MarketClock,
  MarketWatchPacket,
  MarketWatchRequest,
  Quote,
  RiskLens,
  RiskRead,
  Technical,
  TeamNotes,
  TeamSectionKey,
  TickerPacket,
  WatchNewsItem,
};

export type WatchLanguage = MarketWatchRequest["language"];

export type GuardReport = {
  flagged: Array<{ section: number; text: string }>;
  /** Figures replaced with "[unverified figure]". */
  total: number;
  /** Sentences the advice guard removed. */
  adviceReplaced: number;
};

export type MarketWatchResult = {
  briefing: MarketBriefing;
  artifactId: string | null;
  markdown: string;
  guard: GuardReport;
};

export type MarketRegenerateResult = {
  section: BriefingSection;
  guard: GuardReport;
};

export type MarketStarter = {
  id: string;
  label: string;
  hint: string;
  tickers: ReadonlyArray<string>;
};

export const DEFAULT_MAX_CHARS = 6000;
export const MIN_MAX_CHARS = 1000;
export const MAX_MAX_CHARS = 20_000;

/** Placeholder for the position context box: the owner's own example, verbatim. */
export const POSITION_PLACEHOLDER = "MU: $100 @ $860, $200 @ $900, target $1,000";

/** Watchlist presets. Labels describe a set of tickers, never a view or an action. */
export const MARKET_STARTERS: ReadonlyArray<MarketStarter> = [
  {
    id: "us-premarket",
    label: "US pre-market favorites",
    hint: "Memory, semis, cloud, and mega-cap tech before the New York open.",
    tickers: ["MU", "WDC", "NVDA", "AMD", "INTC", "DELL", "AVGO", "SNOW", "GOOGL", "AAPL", "SPCX"],
  },
  {
    id: "idx-banks",
    label: "IDX bank check",
    hint: "The four large Jakarta banks side by side.",
    tickers: ["BBCA", "BBRI", "BMRI", "BBNI"],
  },
  {
    id: "semis-macro",
    label: "Semis vs macro",
    hint: "Semiconductor names against the volatility index.",
    tickers: ["NVDA", "AMD", "AVGO", "MU", "^VIX"],
  },
];

/** Free text → unique uppercase tickers, capped at the watchlist limit. */
export function parseTickers(input: string): string[] {
  return normalizeTickerInput(input).slice(0, WATCHLIST_MAX);
}

/** Add typed tickers to the current chips without duplicates; the cap still applies. */
export function mergeTickers(current: ReadonlyArray<string>, input: string): string[] {
  return parseTickers([...current, input].join(","));
}

/** Like `mergeTickers`, but also reports what was dropped so the studio can say why. */
export function mergeTickersReporting(
  current: ReadonlyArray<string>,
  input: string,
): { tickers: string[]; rejected: string[]; overflow: boolean } {
  const { rejected } = partitionTickerInput(input);
  const all = partitionTickerInput([...current, input].join(","));
  return {
    tickers: all.tickers,
    rejected,
    overflow: all.tickers.length >= WATCHLIST_MAX && current.length + 1 > WATCHLIST_MAX,
  };
}

/** True when the advice guard replaced the heading or a sentence of the body in this section. */
export function isGuardedSection(section: BriefingSection): boolean {
  return section.heading.includes(ADVICE_MARKER) || section.body.includes(ADVICE_MARKER);
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(errorMessage(data, fallback));
  }
  return data as T;
}

/** Quotes, bars, technicals, and a chart per ticker. No gateway key involved. */
export async function fetchMarketBoard(tickers: readonly string[], signal?: AbortSignal): Promise<MarketBoard> {
  const res = await apiFetch("/api/v1/market/board", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers }),
    signal,
  });
  return readJson<MarketBoard>(res, "Could not load the watchlist");
}

/** What the studio says when the briefing needs a key the user has not saved yet. */
export const KEY_HINT =
  "Quotes and charts work without a key. To write the briefing, add your API key in Settings.";
export const NO_TICKER_HINT = "None of those tickers could be found. Check the spelling, for example MU, NVDA, or BBCA.";
export const OFFLINE_HINT = "Market data is not reachable right now. Check your internet connection and try again.";

/** True when the host refused because no gateway API key is saved yet. */
export function needsKey(message: string): boolean {
  return /runtime_stub|live gateway|api key/i.test(message);
}

/** Host error text → one plain sentence a trader can act on; anything unknown passes through. */
export function friendlyMarketError(message: string): string {
  if (needsKey(message)) {
    return KEY_HINT;
  }
  if (/no ticker resolved|unknown symbol/i.test(message)) {
    return NO_TICKER_HINT;
  }
  if (/could not be fetched|fetch failed|ENOTFOUND|ECONNREFUSED|timed? ?out/i.test(message)) {
    return OFFLINE_HINT;
  }
  return message;
}

/** TradingView's STRONG_BUY … STRONG_SELL as words: "Strong buy". Empty stays empty. */
export function humanRating(label: string): string {
  const words = label.trim().toLowerCase().replace(/_/g, " ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/** Rewrite one section; the host runs the number guard and the advice guard again. */
export async function regenerateBriefingSection(input: {
  briefing: MarketBriefing;
  section: number;
  instruction?: string;
  model?: string;
  modelPinned?: true;
}): Promise<MarketRegenerateResult> {
  const res = await apiFetch("/api/v1/market/regenerate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      briefing: input.briefing,
      section: input.section,
      instruction: input.instruction || undefined,
      model: input.model || undefined,
      modelPinned: input.modelPinned,
    }),
  });
  return readJson<MarketRegenerateResult>(res, "Could not rewrite that section");
}

export async function downloadMarketDocx(briefing: MarketBriefing): Promise<void> {
  const res = await apiFetch("/api/v1/market/docx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ briefing }),
  });
  if (!res.ok) {
    throw new Error(errorMessage(await res.json().catch(() => null), "Could not build the DOCX file"));
  }
  if (isElectron()) {
    return;
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "market-briefing.docx";
  saveBlob(await res.blob(), filename);
}

/**
 * Merge a rewritten section into a result. The guard shown after a rewrite is
 * the rewrite's own report. The saved artifact still holds the pre-rewrite
 * briefing, so the id is dropped and downloads use the current markdown.
 */
export function applyRegeneratedSection(
  result: MarketWatchResult,
  index: number,
  next: MarketRegenerateResult,
): MarketWatchResult {
  const sections = result.briefing.sections.map((section, at) => (at === index ? next.section : section));
  return {
    ...result,
    artifactId: null,
    briefing: { ...result.briefing, sections, guardedSections: sections.filter(isGuardedSection).length },
    guard: {
      flagged: next.guard.flagged.map((item) => ({ ...item, section: index })),
      total: next.guard.total,
      adviceReplaced: next.guard.adviceReplaced,
    },
  };
}

export function formatObservedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "" for null; otherwise a fixed-digit number with thousands separators. */
export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** "" for null; otherwise a signed percentage such as "+1.25%". */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Distance of the last price from the 200-day simple moving average, in percent; null when either is missing. */
export function percentVsSma200(quote: Quote | null, technical: Technical | null): number | null {
  const price = quote?.price ?? null;
  const sma = technical?.sma200 ?? null;
  if (price === null || sma === null || sma === 0) {
    return null;
  }
  return ((price - sma) / sma) * 100;
}

const SESSION_LABEL: Record<MarketClock["usSession"], string> = {
  pre: "Pre-market",
  regular: "Regular session",
  post: "After hours",
  closed: "Closed",
};

export function sessionLabel(session: MarketClock["usSession"]): string {
  return SESSION_LABEL[session];
}

/**
 * The phases the analyst-team run streams, in the order the host emits them.
 *
 * The packet phases (`resolving` … `macro`) are labelled by the host and shown
 * verbatim by `JobProgressList`, which has no catalog of its own. The team run
 * is the first market phase set the studio wants in the reader's language, so
 * the studio relabels these four off `market.progress.*` and leaves every other
 * phase — including a phase a newer host invents — on the host's own wording.
 */
export const MARKET_TEAM_PHASES = ["analysts", "debate", "risk", "synthesis"] as const;
export type MarketTeamPhase = (typeof MARKET_TEAM_PHASES)[number];

const TEAM_PHASE_KEYS: ReadonlySet<string> = new Set<string>(MARKET_TEAM_PHASES);

/** The catalog key for a streamed phase, or null when the host label should stand. */
export function marketPhaseKey(phase: string): string | null {
  return TEAM_PHASE_KEYS.has(phase) ? `market.progress.${phase}` : null;
}

/**
 * A copy of the streamed progress with the team phases relabelled. `translate`
 * is the studio's `labeled(key, fallback)`; nothing is mutated, so the job
 * stream's own state is untouched.
 */
export function localizeMarketProgress(
  progress: JobProgress,
  translate: (key: string, fallback: string) => string,
): JobProgress {
  let changed = false;
  const phases = progress.phases.map((phase) => {
    const key = marketPhaseKey(phase.phase);
    if (!key) {
      return phase;
    }
    const label = translate(key, phase.label);
    if (label === phase.label) {
      return phase;
    }
    changed = true;
    return { ...phase, label };
  });
  return changed ? { ...progress, phases } : progress;
}

/** Every packet failure with the ticker it belongs to, macro last. */
export function collectFailures(packet: MarketWatchPacket): string[] {
  const perTicker = packet.tickers.flatMap((ticker) =>
    ticker.failures.map((failure) => `${ticker.symbol.yahoo}: ${failure}`),
  );
  const macro = packet.macro.failures.map((failure) => `Macro: ${failure}`);
  return [...perTicker, ...macro];
}
