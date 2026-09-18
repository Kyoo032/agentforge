/**
 * Market briefing assembly: draft parsing, the two guards, sources, and the
 * final MarketBriefing artifact.
 *
 * Code fetched the packet, the model narrated over it. Every model-written
 * section passes the number guard (allowed figures = every number in the
 * packet plus the user's own position context; the guard's small-integer and
 * year tolerance is kept) and the advice guard (an imperative directive
 * sentence becomes ADVICE_MARKER and is counted, never hidden). The
 * disclaimer is stamped by code.
 */
import { ApiError } from "@agentforge/core";
import {
  marketBriefingSchema,
  marketBriefingToMarkdown,
  type BriefingSection,
  type MarketBriefing,
} from "@agentforge/core/artifacts";
import { type GuardResult, guardNumbers } from "@agentforge/core/finance";
import {
  ADVICE_MARKER,
  ADVICE_PATTERN,
  AdviceLeakError,
  BRIEFING_SECTIONS_MAX,
  BRIEFING_SOURCES_MAX,
  DEFAULT_MARKET_DEPTH,
  DEFAULT_MARKET_SPECIALIST,
  MARKET_DISCLAIMER,
  assertNoAdvice,
  buildWatchSystemPrompt,
  guardAdviceInText,
  packetNumbers,
  synthesisPrompt,
  teamSectionHeadings,
  type MarketDepth,
  type MarketSpecialist,
  type MarketWatchPacket,
  type MarketWatchRequest,
  type TeamNotes,
  type TickerPacket,
  type WatchSystemPromptInput,
} from "@agentforge/core/market";
import { extractJsonObject } from "./presentation-outline";

export type BriefingDraft = { title: string; sections: BriefingSection[] };

export type MarketGuardReport = {
  /** Section index -> figures that did not trace back to the packet. */
  flagged: Array<{ section: number; text: string }>;
  total: number;
  /** Sentences (and headings or titles) the advice guard replaced with the marker. */
  adviceReplaced: number;
};

export type GuardedSection = { section: BriefingSection; flagged: string[]; adviceReplaced: number };
export type BriefingSource = MarketBriefing["sources"][number];

export const SECTION_REWRITE_RULES = [
  "You are rewriting ONE section of an existing briefing over the same DATA PACKET.",
  'Output ONLY JSON, no markdown fence, no preamble: {"heading": string, "body": string}.',
  "Keep the heading unless the instruction asks for another; stay on the section's topic; do not repeat the other sections.",
].join("\n");

/** The briefing system prompt plus the single-section output contract. */
export function sectionSystemPrompt(input: WatchSystemPromptInput): string {
  return `${buildWatchSystemPrompt(input)}\n\n${SECTION_REWRITE_RULES}`;
}

/**
 * The same contract for a section of a team briefing. A team section was
 * written by the editor over the analysts' notes, so the rewrite is asked for
 * under the editor's own rules rather than the quick briefing's — otherwise a
 * rewritten section would stop attributing, and the reader could no longer tell
 * which seat a claim came from.
 */
export function teamSectionSystemPrompt(briefing: Pick<MarketBriefing, "specialist" | "language">): string {
  return [synthesisPrompt(briefing.specialist, briefing.language), "", SECTION_REWRITE_RULES].join("\n");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readSection(item: unknown): BriefingSection | null {
  const record = (item ?? {}) as Record<string, unknown>;
  const section = { heading: text(record.heading), body: text(record.body) };
  return section.heading && section.body ? section : null;
}

function parseJson(raw: string, what: string): Record<string, unknown> {
  try {
    return JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  } catch {
    throw new ApiError("invalid_market", `Model returned invalid JSON for the ${what}`, 502);
  }
}

/** `{ title, sections }` from the model's text; fences and preambles are tolerated, sections are capped. */
export function parseBriefingDraft(raw: string): BriefingDraft {
  const parsed = parseJson(raw, "briefing");
  const sections = (Array.isArray(parsed.sections) ? parsed.sections : [])
    .map(readSection)
    .filter((section): section is BriefingSection => section !== null)
    .slice(0, BRIEFING_SECTIONS_MAX);
  if (sections.length === 0) {
    throw new ApiError("invalid_market", "Model returned no sections", 502);
  }
  return { title: text(parsed.title), sections };
}

export function parseBriefingSection(raw: string): BriefingSection {
  const section = readSection(parseJson(raw, "section"));
  if (!section) {
    throw new ApiError("invalid_market", "Model returned an empty section", 502);
  }
  return section;
}

/**
 * Period labels the packet and the reader use. "1m" would otherwise parse as
 * one million. A currency sign or digit in front ("$1m", "26m") keeps it a figure.
 */
/** Period labels and clock times (09:39 ET, 20:39 WIB) are not figures; blanked before the guard runs. */
export const PERIOD_LABEL =
  /(?<![$€£\d.,])\b(1d|5d|1w|1m|3m|6m|1y|52w|52[- ]?(?:week|wk|minggu)|\d{1,2}:\d{2}(?::\d{2})?)\b/gi;
/** Private-use character: carries no digits, so the guard never reads it. */
const PERIOD_SENTINEL = "\uE000";
const PERIOD_SENTINELS = /\uE000+/;

/** Blank period labels at equal length before the guard runs and put them back after; token indexes stay valid. */
export function guardNumbersSkippingPeriods(body: string, allowed: readonly number[]): GuardResult {
  const labels = [...body.matchAll(PERIOD_LABEL)].map((match) => match[0]);
  if (labels.length === 0) {
    return guardNumbers(body, allowed);
  }
  const masked = body.replace(PERIOD_LABEL, (label) => PERIOD_SENTINEL.repeat(label.length));
  const result = guardNumbers(masked, allowed);
  const restored = result.text
    .split(PERIOD_SENTINELS)
    .map((part, index) => (index === 0 ? part : `${labels[index - 1] ?? ""}${part}`))
    .join("");
  return { ...result, text: restored };
}

/** Number guard then advice guard over body; advice guard over the heading. Returns new objects. */
export function guardBriefingSection(section: BriefingSection, allowed: readonly number[]): GuardedSection {
  const numbers = guardNumbersSkippingPeriods(section.body, allowed);
  const body = guardAdviceInText(numbers.text);
  const heading = ADVICE_PATTERN.test(section.heading)
    ? { text: ADVICE_MARKER, replaced: 1 }
    : { text: section.heading, replaced: 0 };
  return {
    section: { heading: heading.text, body: body.text },
    flagged: numbers.flagged.map((token) => token.text),
    adviceReplaced: body.replaced + heading.replaced,
  };
}

/** Every figure the model may repeat: the packet's quotes, technicals, macro, and the user's position context. */
export function allowedNumbers(packet: MarketWatchPacket): number[] {
  return packetNumbers(packet, packet.positionContext);
}

function tickerSources(ticker: TickerPacket): BriefingSource[] {
  const symbol = ticker.symbol.yahoo;
  return [
    ...(ticker.quote
      ? [{ label: symbol, url: ticker.quote.ref.sourceUrl, observedAt: ticker.quote.ref.observedAt }]
      : []),
    ...(ticker.technical
      ? [
          {
            label: `${symbol} technicals`,
            url: ticker.technical.ref.sourceUrl,
            observedAt: ticker.technical.ref.observedAt,
          },
        ]
      : []),
    ...ticker.news
      .filter((item) => !item.injectionSuspect)
      .map((item) => ({ label: item.title, url: item.link, observedAt: item.ref.observedAt })),
  ];
}

/** One entry per distinct URL, in packet order (tickers first, then macro), capped. */
export function briefingSources(packet: MarketWatchPacket): BriefingSource[] {
  const seen = new Set<string>();
  const all = [
    ...packet.tickers.flatMap(tickerSources),
    ...packet.macro.quotes.map((quote) => ({
      label: quote.label || quote.symbol,
      url: quote.ref.sourceUrl,
      observedAt: quote.ref.observedAt,
    })),
  ];
  return all
    .filter((source) => {
      if (seen.has(source.url)) {
        return false;
      }
      seen.add(source.url);
      return true;
    })
    .slice(0, BRIEFING_SOURCES_MAX);
}

export function defaultBriefingTitle(packet: MarketWatchPacket): string {
  const symbols = packet.tickers.map((ticker) => ticker.symbol.yahoo);
  const shown = symbols.slice(0, 4).join(", ");
  const more = symbols.length > 4 ? ` +${symbols.length - 4}` : "";
  return `Market briefing: ${shown}${more}`.trim();
}

function guardedTitle(title: string, fallback: string): { text: string; replaced: number } {
  if (!title) {
    return { text: fallback, replaced: 0 };
  }
  return ADVICE_PATTERN.test(title) ? { text: fallback, replaced: 1 } : { text: title, replaced: 0 };
}

export type BuildBriefingInput = {
  language: MarketWatchRequest["language"];
  generatedAt: string;
  /** The named agent that wrote the draft; defaults to the saham desk. */
  specialist?: MarketSpecialist;
  /** How it was written; defaults to the single-pass quick run. */
  depth?: MarketDepth;
  /** The team's notes, already guarded by the caller. Only a `team` run has them. */
  team?: TeamNotes;
};

export function buildMarketBriefing(
  draft: BriefingDraft,
  packet: MarketWatchPacket,
  input: BuildBriefingInput,
): { briefing: MarketBriefing; guard: MarketGuardReport } {
  const allowed = allowedNumbers(packet);
  const guarded = draft.sections.map((section) => guardBriefingSection(section, allowed));
  const title = guardedTitle(draft.title, defaultBriefingTitle(packet));
  const flagged = guarded.flatMap((entry, index) => entry.flagged.map((token) => ({ section: index, text: token })));
  const adviceReplaced = guarded.reduce((sum, entry) => sum + entry.adviceReplaced, title.replaced);
  const briefing = marketBriefingSchema.parse({
    title: title.text,
    language: input.language,
    specialist: input.specialist ?? DEFAULT_MARKET_SPECIALIST,
    depth: input.depth ?? DEFAULT_MARKET_DEPTH,
    ...(input.team ? { team: input.team } : {}),
    generatedAt: input.generatedAt,
    sections: guarded.map((entry) => entry.section),
    packet,
    sources: briefingSources(packet),
    guardedSections: guarded.filter((entry) => entry.adviceReplaced > 0).length,
    disclaimer: MARKET_DISCLAIMER,
  });
  return { briefing, guard: { flagged, total: flagged.length, adviceReplaced } };
}

/**
 * Last line of defence over the model-written sections. With every section
 * already guarded this cannot throw; if it does, that is a bug or a tampered
 * client payload: the path is logged and the caller gets a 502.
 */
export function assertBriefingHasNoAdvice(sections: readonly BriefingSection[]): void {
  try {
    assertNoAdvice({ sections });
  } catch (error) {
    if (error instanceof AdviceLeakError) {
      console.error(`market: advice leak after guarding at ${error.path} (matched ${JSON.stringify(error.match)})`);
      throw new ApiError("advice_leak", "The briefing still contained directive language after guarding", 502);
    }
    throw error;
  }
}

/* The Team appendix */

/** Heading of the appendix, per language. The five section headings inside it are core's. */
export const TEAM_APPENDIX_HEADING: Readonly<Record<MarketBriefing["language"], string>> = {
  en: "Team",
  id: "Tim",
};

function appendixLabels(language: MarketBriefing["language"]): {
  confidence: string;
  volatility: string;
  liquidity: string;
  rebuttals: string;
  unavailable: string;
} {
  return language === "en"
    ? {
        confidence: "confidence",
        volatility: "Volatility",
        liquidity: "Liquidity",
        rebuttals: "Rebuttals",
        unavailable: "unavailable",
      }
    : {
        confidence: "keyakinan",
        volatility: "Volatilitas",
        liquidity: "Likuiditas",
        rebuttals: "Sanggahan",
        unavailable: "tidak tersedia",
      };
}

/**
 * The team's own notes, rendered under the briefing so a reader can see the
 * four seats behind the editor's text: each analyst with its confidence, both
 * sides of the debate, and the three risk lenses.
 *
 * Empty for a quick briefing. The notes are already guarded when they are
 * stored, so nothing here re-guards them; this is rendering only.
 */
export function teamAppendixMarkdown(briefing: MarketBriefing): string[] {
  const notes = briefing.team;
  if (!notes) {
    return [];
  }
  const [analystNotes, bullHeading, bearHeading, riskHeading] = teamSectionHeadings(briefing.language);
  const labels = appendixLabels(briefing.language);
  const side = (heading: string | undefined, entry: TeamNotes["bull"]): string[] => [
    `### ${heading ?? entry.stance}`,
    "",
    entry.thesis,
    "",
    ...entry.points.map((point) => `- ${point}`),
    ...(entry.rebuttals.length > 0
      ? ["", `**${labels.rebuttals}:**`, ...entry.rebuttals.map((point) => `- ${point}`)]
      : []),
    "",
  ];
  return [
    `## ${TEAM_APPENDIX_HEADING[briefing.language]}`,
    "",
    `### ${analystNotes ?? "Analyst notes"}`,
    "",
    ...notes.analysts.flatMap((note) => [
      `**${note.analyst}** (${labels.confidence}: ${note.confidence})`,
      "",
      note.summary,
      "",
      ...note.keyPoints.map((point) => `- ${point}`),
      "",
    ]),
    ...side(bullHeading, notes.bull),
    ...side(bearHeading, notes.bear),
    `### ${riskHeading ?? "Risk read"}`,
    "",
    ...notes.risk.lenses.flatMap((lens) => [
      `**${lens.lens}** — ${lens.view}`,
      "",
      ...lens.keyRisks.map((risk) => `- ${risk}`),
      "",
    ]),
    `**${labels.volatility}:** ${notes.risk.volatility}`,
    "",
    `**${labels.liquidity}:** ${notes.risk.liquidity}`,
    "",
  ];
}

/**
 * The briefing as markdown. Core renders the briefing itself; a team run gets
 * the Team appendix spliced in ahead of the closing disclaimer, so the
 * disclaimer stays the last line of the document whatever the depth.
 */
export function marketBriefingMarkdown(briefing: MarketBriefing): string {
  const base = marketBriefingToMarkdown(briefing);
  const appendix = teamAppendixMarkdown(briefing);
  if (appendix.length === 0) {
    return base;
  }
  const closing = `> ${briefing.disclaimer}`;
  const at = base.lastIndexOf(closing);
  const block = `${appendix.join("\n")}\n`;
  return at < 0 ? `${base}\n${block}` : `${base.slice(0, at)}${block}${base.slice(at)}`;
}
