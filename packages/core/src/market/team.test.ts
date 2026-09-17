import { describe, expect, it } from "vitest";
import { harnessFor } from "./harness";
import { MARKET_SPECIALISTS, type MarketSpecialist } from "./specialist-ids";
import {
  ANALYST_KEY_POINTS_MAX,
  ANALYST_KEY_POINT_CHARS_MAX,
  ANALYST_SUMMARY_MAX,
  ANALYST_UNAVAILABLE,
  CONFIDENCE_LEVELS,
  DEBATE_POINTS_MAX,
  DEBATE_REBUTTALS_MAX,
  DEBATE_STANCES,
  DEBATE_THESIS_MAX,
  DEFAULT_MARKET_DEPTH,
  MARKET_ANALYSTS,
  MARKET_DEPTHS,
  RISK_KEY_RISKS_MAX,
  RISK_LENSES,
  RISK_NOTE_MAX,
  RISK_VIEW_MAX,
  TEAM_MAX_CALLS,
  TEAM_ROUNDS,
  analystNoteSchema,
  analystsFor,
  debateSideSchema,
  riskLensSchema,
  riskReadSchema,
  teamAvailable,
  teamNotesSchema,
  unavailableAnalystNote,
} from "./team";

const note = {
  analyst: "technical" as const,
  summary: "The close sits above both moving averages in the packet.",
  keyPoints: ["RSI14 71.3 is in the overbought band"],
  confidence: "medium" as const,
};

const side = {
  stance: "bull" as const,
  thesis: "Momentum and the sector read both lean up.",
  points: ["close above SMA50"],
  rebuttals: ["the bear case leans on one headline"],
};

const risk = {
  lenses: RISK_LENSES.map((lens) => ({ lens, view: `${lens} view`, keyRisks: ["gap risk"] })),
  volatility: "The 1 day move is wider than the 5 day average.",
  liquidity: "Volume is thin outside the regular session.",
};

describe("depths", () => {
  it("offers exactly quick and team, quick first and default", () => {
    expect([...MARKET_DEPTHS]).toEqual(["quick", "team"]);
    expect(DEFAULT_MARKET_DEPTH).toBe("quick");
  });
});

describe("MARKET_ANALYSTS", () => {
  it("names the four analysts of the team", () => {
    expect([...MARKET_ANALYSTS]).toEqual(["technical", "fundamentals", "sentiment", "news"]);
  });

  it("budgets one call per analyst plus bull, bear, risk, and synthesis", () => {
    expect(TEAM_MAX_CALLS).toBe(MARKET_ANALYSTS.length + 4);
    expect(TEAM_MAX_CALLS).toBe(8);
    expect(TEAM_ROUNDS).toBe(1);
  });
});

describe("analystNoteSchema", () => {
  it("accepts a note and refuses an unknown analyst or confidence", () => {
    expect(analystNoteSchema.parse(note)).toEqual(note);
    expect(analystNoteSchema.safeParse({ ...note, analyst: "trader" }).success).toBe(false);
    expect(analystNoteSchema.safeParse({ ...note, confidence: "certain" }).success).toBe(false);
    expect([...CONFIDENCE_LEVELS]).toEqual(["low", "medium", "high"]);
  });

  it("caps the summary and the key points", () => {
    expect(analystNoteSchema.safeParse({ ...note, summary: "x".repeat(ANALYST_SUMMARY_MAX) }).success).toBe(true);
    expect(analystNoteSchema.safeParse({ ...note, summary: "x".repeat(ANALYST_SUMMARY_MAX + 1) }).success).toBe(false);
    const many = Array.from({ length: ANALYST_KEY_POINTS_MAX + 1 }, () => "point");
    expect(analystNoteSchema.safeParse({ ...note, keyPoints: many }).success).toBe(false);
    expect(analystNoteSchema.safeParse({ ...note, keyPoints: many.slice(1) }).success).toBe(true);
    expect(
      analystNoteSchema.safeParse({ ...note, keyPoints: ["x".repeat(ANALYST_KEY_POINT_CHARS_MAX + 1)] }).success,
    ).toBe(false);
  });

  it("builds the degraded note the host stores when an analyst call fails", () => {
    const degraded = unavailableAnalystNote("news");
    expect(analystNoteSchema.parse(degraded)).toEqual(degraded);
    expect(degraded).toEqual({ analyst: "news", summary: ANALYST_UNAVAILABLE, keyPoints: [], confidence: "low" });
  });
});

describe("debateSideSchema", () => {
  it("takes one stance, a capped thesis, points, and rebuttals", () => {
    expect(debateSideSchema.parse(side)).toEqual(side);
    expect([...DEBATE_STANCES]).toEqual(["bull", "bear"]);
    expect(debateSideSchema.safeParse({ ...side, stance: "neutral" }).success).toBe(false);
    expect(debateSideSchema.safeParse({ ...side, thesis: "x".repeat(DEBATE_THESIS_MAX + 1) }).success).toBe(false);
    expect(
      debateSideSchema.safeParse({ ...side, points: Array.from({ length: DEBATE_POINTS_MAX + 1 }, () => "p") }).success,
    ).toBe(false);
    expect(
      debateSideSchema.safeParse({ ...side, rebuttals: Array.from({ length: DEBATE_REBUTTALS_MAX + 1 }, () => "r") })
        .success,
    ).toBe(false);
  });
});

describe("riskLensSchema / riskReadSchema", () => {
  it("names the three lenses and caps the view and the risks", () => {
    expect([...RISK_LENSES]).toEqual(["aggressive", "neutral", "conservative"]);
    const lens = { lens: "neutral" as const, view: "balanced", keyRisks: ["gap"] };
    expect(riskLensSchema.parse(lens)).toEqual(lens);
    expect(riskLensSchema.safeParse({ ...lens, lens: "reckless" }).success).toBe(false);
    expect(riskLensSchema.safeParse({ ...lens, view: "x".repeat(RISK_VIEW_MAX + 1) }).success).toBe(false);
    expect(
      riskLensSchema.safeParse({ ...lens, keyRisks: Array.from({ length: RISK_KEY_RISKS_MAX + 1 }, () => "r") })
        .success,
    ).toBe(false);
  });

  it("wants one read per lens, plus a volatility and a liquidity note", () => {
    expect(riskReadSchema.parse(risk)).toEqual(risk);
    expect(riskReadSchema.safeParse({ ...risk, lenses: risk.lenses.slice(1) }).success).toBe(false);
    expect(riskReadSchema.safeParse({ ...risk, volatility: "x".repeat(RISK_NOTE_MAX + 1) }).success).toBe(false);
    expect(riskReadSchema.safeParse({ ...risk, liquidity: "x".repeat(RISK_NOTE_MAX + 1) }).success).toBe(false);
  });
});

describe("teamNotesSchema", () => {
  const notes = { analysts: [note], bull: side, bear: { ...side, stance: "bear" as const }, risk, rounds: TEAM_ROUNDS };

  it("carries the analyst notes, both sides, the risk read, and one round", () => {
    expect(teamNotesSchema.parse(notes)).toEqual(notes);
    expect(teamNotesSchema.parse({ ...notes, rounds: undefined }).rounds).toBe(TEAM_ROUNDS);
    expect(teamNotesSchema.safeParse({ ...notes, rounds: 2 }).success).toBe(false);
  });

  it("never holds more notes than there are analysts", () => {
    const tooMany = Array.from({ length: MARKET_ANALYSTS.length + 1 }, () => note);
    expect(teamNotesSchema.safeParse({ ...notes, analysts: tooMany }).success).toBe(false);
  });
});

describe("teamAvailable / analystsFor", () => {
  const TABLE: Readonly<Record<MarketSpecialist, readonly string[]>> = {
    saham: ["technical", "fundamentals", "sentiment", "news"],
    crypto: ["technical", "sentiment", "news"],
    forex: ["technical", "news"],
    gold: ["technical", "news"],
    commodities: ["technical", "news"],
    indices: ["technical", "news"],
    summary: ["news"],
    news: ["news", "sentiment"],
    scanner: [],
    "sector-rotation": [],
    "elliott-wave": [],
  };

  it("gives each desk the analysts the contract assigns it", () => {
    for (const id of MARKET_SPECIALISTS) {
      expect({ id, analysts: [...analystsFor(id)] }).toEqual({ id, analysts: [...TABLE[id]] });
      expect([...harnessFor(id).analysts]).toEqual([...TABLE[id]]);
    }
  });

  it("offers team depth exactly to the desks that have analysts", () => {
    for (const id of MARKET_SPECIALISTS) {
      expect({ id, team: teamAvailable(id) }).toEqual({ id, team: TABLE[id].length > 0 });
    }
    expect(teamAvailable("saham")).toBe(true);
    expect(teamAvailable("scanner")).toBe(false);
  });

  it("only names known analysts, without duplicates", () => {
    const known: ReadonlySet<string> = new Set(MARKET_ANALYSTS);
    for (const id of MARKET_SPECIALISTS) {
      const analysts = analystsFor(id);
      expect(new Set(analysts).size).toBe(analysts.length);
      for (const analyst of analysts) {
        expect(known.has(analyst)).toBe(true);
      }
    }
  });
});
