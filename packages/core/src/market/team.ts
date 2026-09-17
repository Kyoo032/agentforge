/**
 * The analyst team: the second depth a Market run can be written at.
 *
 * `quick` is the single-pass briefing that has always shipped — one model call
 * over the packet. `team` splits the same packet between four analysts who
 * each see only their own sections, sets a bull against a bear for one round,
 * reads the result through three risk lenses, and has a synthesis write the
 * briefing. The shape is adapted from TradingAgents (Apache-2.0); what we
 * deliberately did not take is its trader, its portfolio manager, its
 * execution layer, its five-tier ratings and its price targets. A desk here
 * produces analysis, never a directive: the advice guard and the number guard
 * run over every team output exactly as they do over a quick one.
 *
 * This module owns the vocabulary (depths, analysts, lenses), the caps, and
 * the zod shapes the host parses model JSON with. Which analysts a given desk
 * runs is the harness's business (`harness.ts`), which is why `teamAvailable`
 * asks the harness rather than keeping a second table.
 */
import { z } from "zod";
import { harnessFor } from "./harness";
import type { MarketSpecialist } from "./specialist-ids";

export const MARKET_DEPTHS = ["quick", "team"] as const;
export type MarketDepth = (typeof MARKET_DEPTHS)[number];

/** Quick stays the default: the team costs up to `TEAM_MAX_CALLS` model calls. */
export const DEFAULT_MARKET_DEPTH: MarketDepth = "quick";

/**
 * The four analysts. Each reads one slice of the packet (see
 * `analystSections` in `team-prompts.ts`) and writes one note.
 */
export const MARKET_ANALYSTS = ["technical", "fundamentals", "sentiment", "news"] as const;
export type MarketAnalyst = (typeof MARKET_ANALYSTS)[number];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const DEBATE_STANCES = ["bull", "bear"] as const;
export type DebateStance = (typeof DEBATE_STANCES)[number];

export const RISK_LENSES = ["aggressive", "neutral", "conservative"] as const;
export type RiskLensName = (typeof RISK_LENSES)[number];

/** An analyst note is a paragraph and a handful of points, not a second briefing. */
export const ANALYST_SUMMARY_MAX = 600;
export const ANALYST_KEY_POINTS_MAX = 5;
export const ANALYST_KEY_POINT_CHARS_MAX = 200;

export const DEBATE_THESIS_MAX = 400;
export const DEBATE_POINTS_MAX = 5;
export const DEBATE_REBUTTALS_MAX = 4;

export const RISK_VIEW_MAX = 400;
export const RISK_KEY_RISKS_MAX = 4;
/** The volatility and liquidity notes are one or two sentences each. */
export const RISK_NOTE_MAX = 200;

/** One round of bull versus bear. Two rounds would double the cost for a rerun of the same points. */
export const TEAM_ROUNDS = 1;

/** Four analysts, a bull, a bear, one risk read, one synthesis. The host enforces it as a ceiling. */
export const TEAM_MAX_CALLS = MARKET_ANALYSTS.length + 4;

/** What a note says when that analyst's call failed. Reported in `failures`, never hidden. */
export const ANALYST_UNAVAILABLE = "<unavailable>";

export const analystNoteSchema = z.object({
  analyst: z.enum(MARKET_ANALYSTS),
  summary: z.string().max(ANALYST_SUMMARY_MAX),
  keyPoints: z.array(z.string().max(ANALYST_KEY_POINT_CHARS_MAX)).max(ANALYST_KEY_POINTS_MAX).default([]),
  confidence: z.enum(CONFIDENCE_LEVELS),
});
export type AnalystNote = z.infer<typeof analystNoteSchema>;

export const debateSideSchema = z.object({
  stance: z.enum(DEBATE_STANCES),
  thesis: z.string().max(DEBATE_THESIS_MAX),
  points: z.array(z.string()).max(DEBATE_POINTS_MAX).default([]),
  rebuttals: z.array(z.string()).max(DEBATE_REBUTTALS_MAX).default([]),
});
export type DebateSide = z.infer<typeof debateSideSchema>;

export const riskLensSchema = z.object({
  lens: z.enum(RISK_LENSES),
  view: z.string().max(RISK_VIEW_MAX),
  keyRisks: z.array(z.string()).max(RISK_KEY_RISKS_MAX).default([]),
});
export type RiskLens = z.infer<typeof riskLensSchema>;

/** One read per lens in a single call, plus the two notes every lens argues over. */
export const riskReadSchema = z.object({
  lenses: z.array(riskLensSchema).length(RISK_LENSES.length),
  volatility: z.string().max(RISK_NOTE_MAX),
  liquidity: z.string().max(RISK_NOTE_MAX),
});
export type RiskRead = z.infer<typeof riskReadSchema>;

/**
 * What the run kept from the team, stored on the briefing after the advice and
 * number guards have been run over every free-text field — the stored notes
 * are as clean as the rendered sections.
 */
export const teamNotesSchema = z.object({
  analysts: z.array(analystNoteSchema).max(MARKET_ANALYSTS.length).default([]),
  bull: debateSideSchema,
  bear: debateSideSchema,
  risk: riskReadSchema,
  rounds: z.literal(TEAM_ROUNDS).default(TEAM_ROUNDS),
});
export type TeamNotes = z.infer<typeof teamNotesSchema>;

/** The note the host stores in place of an analyst whose call failed. */
export function unavailableAnalystNote(analyst: MarketAnalyst): AnalystNote {
  return { analyst, summary: ANALYST_UNAVAILABLE, keyPoints: [], confidence: "low" };
}

/** The analysts this desk runs at team depth, in the order the harness lists them. */
export function analystsFor(specialist: MarketSpecialist): readonly MarketAnalyst[] {
  return harnessFor(specialist).analysts;
}

/** Whether team depth is offered at all for this desk. A desk with no analysts stays quick-only. */
export function teamAvailable(specialist: MarketSpecialist): boolean {
  return analystsFor(specialist).length > 0;
}
