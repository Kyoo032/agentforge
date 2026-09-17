/**
 * The analyst-team pipeline: four analysts in parallel (two in flight), then
 * bull, bear, one risk read and the synthesis — at most `TEAM_MAX_CALLS` model
 * calls for one briefing.
 *
 * Every call is its own JSON contract. A call that fails, times out or returns
 * something that does not parse degrades to an "unavailable" note and a failure
 * string; the pipeline never throws out of a stage, because a briefing with
 * three analysts and an honest gap is worth more than no briefing at all. The
 * synthesis is the only stage whose output the reader sees directly, and it
 * goes back through the same `{title, sections[]}` contract a quick run uses,
 * so the number guard, the advice guard and the artifact downstream never learn
 * a second format.
 *
 * Analysts get no tools on purpose: each is handed a pre-fetched slice of the
 * packet and is asked to read it, not to go looking for more. Only the
 * synthesis keeps the desk's harness tools.
 *
 * What the team stores (`briefing.team`) is guarded here too: `guardTeamNotes`
 * runs the number guard and the advice guard over every free-text field, so the
 * stored notes are exactly as clean as the rendered sections.
 */
import {
  ANALYST_UNAVAILABLE,
  MARKET_ANALYSTS,
  RISK_LENSES,
  TEAM_MAX_CALLS,
  TEAM_ROUNDS,
  analystNoteSchema,
  analystPacketOrder,
  analystSystemPrompt,
  bearPrompt,
  bullPrompt,
  debateSideSchema,
  guardAdviceInText,
  packetToPromptBlock,
  riskPrompt,
  riskReadSchema,
  synthesisPrompt,
  teamNotesSchema,
  unavailableAnalystNote,
  type AnalystNote,
  type DebateSide,
  type MarketAnalyst,
  type MarketSpecialist,
  type MarketWatchPacket,
  type RiskRead,
  type TeamLanguage,
  type TeamNotes,
} from "@agentforge/core/market";
import type { JobEmitter } from "@agentforge/core/jobs";
import { guardNumbersSkippingPeriods } from "./market-briefing-build";
import { mapLimit } from "./market/map-limit";
import { extractJsonObject } from "./presentation-outline";

/** Analysts in flight at once. Two keeps the four notes inside one watchdog window without a burst of four calls. */
export const TEAM_ANALYST_CONCURRENCY = 2;

export const TEAM_PHASES = ["analysts", "debate", "risk", "synthesis"] as const;
export type TeamPhase = (typeof TEAM_PHASES)[number];

/** Progress labels in both languages, same shape as `PHASE_LABELS` in `market-generate.ts`. */
export const TEAM_PHASE_LABELS: Readonly<Record<TeamPhase, Readonly<Record<TeamLanguage, string>>>> = {
  analysts: { en: "Analysts reading their sections", id: "Analis membaca bagiannya" },
  debate: { en: "Bull and bear debate", id: "Debat bullish dan bearish" },
  risk: { en: "Reading the three risk lenses", id: "Membaca tiga lensa risiko" },
  synthesis: { en: "Editor writing the briefing", id: "Editor menulis briefing" },
};

export function teamPhaseLabel(phase: TeamPhase, language: TeamLanguage): string {
  return TEAM_PHASE_LABELS[phase][language] ?? TEAM_PHASE_LABELS[phase].id;
}

/** One model call, already bound to the tenant, the model and the run's abort signal by the caller. */
export type TeamAsk = (call: {
  systemPrompt: string;
  prompt: string;
  /** Distinguishes the stages in the run log. */
  versionId: string;
  toolKeys: string[];
}) => Promise<string>;

export type TeamRunInput = {
  packet: MarketWatchPacket;
  specialist: MarketSpecialist;
  language: TeamLanguage;
  /** The reader's own question; only the synthesis sees it. */
  instruction: string;
  analysts: readonly MarketAnalyst[];
  ask: TeamAsk;
  emit: JobEmitter;
  /** The desk's harness tools, bound to the synthesis only. */
  synthesisToolKeys: string[];
};

export type TeamRunResult = {
  /** The synthesis output, in the same `{title, sections[]}` shape a quick run returns. */
  raw: string;
  notes: TeamNotes;
  /** One string per stage that degraded. Empty when all eight calls landed. */
  failures: string[];
  /** Model calls actually made. Never above `TEAM_MAX_CALLS`. */
  calls: number;
};

/** `extractJsonObject` is shared with Presentations; its error names an outline, so a Market failure is re-worded here. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(extractJsonObject(raw)) as unknown;
  } catch {
    throw new Error("The model did not return the JSON this analyst step expects");
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A debate side that could not be written. Reported, never hidden. */
export function unavailableSide(stance: DebateSide["stance"]): DebateSide {
  return { stance, thesis: ANALYST_UNAVAILABLE, points: [], rebuttals: [] };
}

/** A risk read that could not be written: three lenses, each saying so. */
export function unavailableRisk(): RiskRead {
  return {
    lenses: RISK_LENSES.map((lens) => ({ lens, view: ANALYST_UNAVAILABLE, keyRisks: [] })),
    volatility: ANALYST_UNAVAILABLE,
    liquidity: ANALYST_UNAVAILABLE,
  };
}

/* Guards over the stored notes */

/** Number guard then advice guard over one stored string. Pure. */
function guardText(text: string, allowed: readonly number[]): string {
  return guardAdviceInText(guardNumbersSkippingPeriods(text, allowed).text).text;
}

function guardList(items: readonly string[], allowed: readonly number[]): string[] {
  return items.map((item) => guardText(item, allowed));
}

function guardSide(side: DebateSide, allowed: readonly number[]): DebateSide {
  return {
    stance: side.stance,
    thesis: guardText(side.thesis, allowed),
    points: guardList(side.points, allowed),
    rebuttals: guardList(side.rebuttals, allowed),
  };
}

/**
 * Both guards over every free-text field the team stores, so what is saved on
 * the briefing is as clean as what is rendered. Returns new objects; the input
 * is never mutated.
 */
export function guardTeamNotes(notes: TeamNotes, allowed: readonly number[]): TeamNotes {
  return teamNotesSchema.parse({
    analysts: notes.analysts.map((note) => ({
      analyst: note.analyst,
      summary: guardText(note.summary, allowed),
      keyPoints: guardList(note.keyPoints, allowed),
      confidence: note.confidence,
    })),
    bull: guardSide(notes.bull, allowed),
    bear: guardSide(notes.bear, allowed),
    risk: {
      lenses: notes.risk.lenses.map((lens) => ({
        lens: lens.lens,
        view: guardText(lens.view, allowed),
        keyRisks: guardList(lens.keyRisks, allowed),
      })),
      volatility: guardText(notes.risk.volatility, allowed),
      liquidity: guardText(notes.risk.liquidity, allowed),
    },
    rounds: TEAM_ROUNDS,
  });
}

/* The pipeline */

/** Counts calls so the ceiling is enforced in code, not only in the comment. */
class CallBudget {
  private used = 0;

  constructor(private readonly max: number = TEAM_MAX_CALLS) {}

  get spent(): number {
    return this.used;
  }

  /** True when there is room for one more call. */
  take(): boolean {
    if (this.used >= this.max) {
      return false;
    }
    this.used += 1;
    return true;
  }
}

function notesJson(label: string, value: unknown): string {
  return `${label}:\n${JSON.stringify(value, null, 2)}`;
}

async function runAnalyst(
  analyst: MarketAnalyst,
  input: TeamRunInput,
  budget: CallBudget,
): Promise<{ note: AnalystNote; failure: string | null }> {
  if (!budget.take()) {
    return { note: unavailableAnalystNote(analyst), failure: `team: ${analyst} analyst skipped (call budget spent)` };
  }
  try {
    const raw = await input.ask({
      systemPrompt: analystSystemPrompt(analyst, input.specialist, input.language),
      // Its slice of the packet and nothing else: no tools, no reader instruction, no other analyst's view.
      prompt: packetToPromptBlock(input.packet, input.specialist, analystPacketOrder(analyst, input.specialist)),
      versionId: `market-team-${analyst}`,
      toolKeys: [],
    });
    const parsed = analystNoteSchema.parse({ ...(parseJson(raw) as object), analyst });
    return { note: parsed, failure: null };
  } catch (error) {
    return { note: unavailableAnalystNote(analyst), failure: `team: ${analyst} analyst unavailable (${reason(error)})` };
  }
}

async function runSide(
  stance: DebateSide["stance"],
  prompt: string,
  systemPrompt: string,
  input: TeamRunInput,
  budget: CallBudget,
): Promise<{ side: DebateSide; failure: string | null }> {
  if (!budget.take()) {
    return { side: unavailableSide(stance), failure: `team: ${stance} case skipped (call budget spent)` };
  }
  try {
    const raw = await input.ask({ systemPrompt, prompt, versionId: `market-team-${stance}`, toolKeys: [] });
    return { side: debateSideSchema.parse({ ...(parseJson(raw) as object), stance }), failure: null };
  } catch (error) {
    return { side: unavailableSide(stance), failure: `team: ${stance} case unavailable (${reason(error)})` };
  }
}

async function runRisk(
  prompt: string,
  input: TeamRunInput,
  budget: CallBudget,
): Promise<{ risk: RiskRead; failure: string | null }> {
  if (!budget.take()) {
    return { risk: unavailableRisk(), failure: "team: risk read skipped (call budget spent)" };
  }
  try {
    const raw = await input.ask({
      systemPrompt: riskPrompt(input.specialist, input.language),
      prompt,
      versionId: "market-team-risk",
      toolKeys: [],
    });
    return { risk: riskReadSchema.parse(parseJson(raw)), failure: null };
  } catch (error) {
    return { risk: unavailableRisk(), failure: `team: risk read unavailable (${reason(error)})` };
  }
}

/**
 * analysts (two in flight) -> bull -> bear -> risk -> synthesis.
 *
 * Only the synthesis may fail the run: it is the briefing. Every earlier stage
 * degrades to an "unavailable" note so the editor can say a seat was empty.
 */
export async function runTeamPipeline(input: TeamRunInput): Promise<TeamRunResult> {
  const budget = new CallBudget();
  const failures: string[] = [];
  const wanted = input.analysts.length > 0 ? input.analysts : MARKET_ANALYSTS;

  input.emit({ type: "job.phase", phase: "analysts", label: teamPhaseLabel("analysts", input.language) });
  let done = 0;
  const settled = await mapLimit(wanted, TEAM_ANALYST_CONCURRENCY, async (analyst) => {
    const result = await runAnalyst(analyst, input, budget);
    done += 1;
    input.emit({
      type: "job.step",
      phase: "analysts",
      label: `${done}/${wanted.length} ${analyst}`,
      current: done,
      total: wanted.length,
    });
    return result;
  });
  const analysts: AnalystNote[] = [];
  settled.forEach((result, index) => {
    const analyst = wanted[index] as MarketAnalyst;
    if (result.status === "fulfilled") {
      analysts.push(result.value.note);
      if (result.value.failure) {
        failures.push(result.value.failure);
      }
    } else {
      // mapLimit only rejects if runAnalyst itself threw, which it does not; kept so a future change cannot lose a seat.
      analysts.push(unavailableAnalystNote(analyst));
      failures.push(`team: ${analyst} analyst unavailable (${reason(result.reason)})`);
    }
  });

  input.emit({ type: "job.phase", phase: "debate", label: teamPhaseLabel("debate", input.language) });
  const bull = await runSide(
    "bull",
    notesJson("ANALYST NOTES", analysts),
    bullPrompt(input.specialist, input.language),
    input,
    budget,
  );
  const bear = await runSide(
    "bear",
    [notesJson("ANALYST NOTES", analysts), notesJson("BULL CASE", bull.side)].join("\n\n"),
    bearPrompt(input.specialist, input.language),
    input,
    budget,
  );
  failures.push(...[bull.failure, bear.failure].filter((entry): entry is string => entry !== null));

  input.emit({ type: "job.phase", phase: "risk", label: teamPhaseLabel("risk", input.language) });
  const evidence = [
    notesJson("ANALYST NOTES", analysts),
    notesJson("BULL CASE", bull.side),
    notesJson("BEAR CASE", bear.side),
  ].join("\n\n");
  const risk = await runRisk(evidence, input, budget);
  if (risk.failure) {
    failures.push(risk.failure);
  }

  input.emit({ type: "job.phase", phase: "synthesis", label: teamPhaseLabel("synthesis", input.language) });
  const notes = teamNotesSchema.parse({
    analysts,
    bull: bull.side,
    bear: bear.side,
    risk: risk.risk,
    rounds: TEAM_ROUNDS,
  });
  if (!budget.take()) {
    throw new Error("team: the call budget was spent before the synthesis");
  }
  const raw = await input.ask({
    systemPrompt: synthesisPrompt(input.specialist, input.language),
    prompt: [
      packetToPromptBlock(input.packet, input.specialist),
      notesJson("ANALYST NOTES", analysts),
      notesJson("BULL CASE", bull.side),
      notesJson("BEAR CASE", bear.side),
      notesJson("RISK READ", risk.risk),
      `READER INSTRUCTION:\n${input.instruction.trim()}`,
    ].join("\n\n"),
    versionId: "market-team-synthesis",
    toolKeys: input.synthesisToolKeys,
  });
  return { raw, notes, failures, calls: budget.spent };
}
