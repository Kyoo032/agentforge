/**
 * The analyst team end to end, through the real `generateMarketBriefing` with
 * the `MarketGenerateDeps` seam: the packet is a fixture, every model call is a
 * scripted string, and nothing opens a socket or reaches a gateway.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wrappingKeyFromSecret, type TenantContext } from "@agentforge/core";
import { UNVERIFIED_MARKER } from "@agentforge/core/finance";
import type { JobEvent } from "@agentforge/core/jobs";
import {
  ADVICE_MARKER,
  ANALYST_UNAVAILABLE,
  MARKET_ANALYSTS,
  RISK_LENSES,
  TEAM_MAX_CALLS,
  analystsFor,
  teamAvailable,
} from "@agentforge/core/market";
import { ensureSchema } from "@agentforge/db/ensure-schema";
import { createArtifactStore, type ArtifactStore } from "./artifacts";
import { FIXTURE_NOW, packet as packetFixture } from "./market/__fixtures__/watch";
import { MARKET_TOOL_BINDINGS } from "./market-generate";
import { generateMarketBriefing, type AskOptions, type MarketGenerateDeps } from "./market-generate";
import { guardTeamNotes, unavailableRisk, unavailableSide } from "./market-team";

const KEY = wrappingKeyFromSecret("c".repeat(64));
const tenant: TenantContext = { organizationId: "org", workspaceId: "ws-team", userId: "local", role: "owner" };
const now = () => FIXTURE_NOW;

const REQUEST = {
  prompt: "Pre-market briefing please",
  tickers: ["mu", "BBCA"],
  language: "en" as const,
  maxChars: 5000,
  depth: "team" as const,
};

function analystNote(analyst: string) {
  return JSON.stringify({
    analyst,
    summary: `The ${analyst} seat read its slice. MU sits at 1000.26.`,
    keyPoints: [`${analyst} point one`],
    confidence: "medium",
  });
}

const BULL = JSON.stringify({
  stance: "bull",
  thesis: "Demand is running ahead of supply at 1000.26.",
  points: ["HBM is sold out"],
  rebuttals: [],
});

const BEAR = JSON.stringify({
  stance: "bear",
  // Both guards have to bite here: a directive sentence and a figure the packet never carried.
  thesis: "Margins compress into the quarter. Sell now.",
  points: ["The stock is worth 4321.99 at most"],
  rebuttals: ["The bull ignores the cycle"],
});

const RISK = JSON.stringify({
  lenses: RISK_LENSES.map((lens) => ({ lens, view: `${lens} view`, keyRisks: [`${lens} risk`] })),
  volatility: "Range is wide.",
  liquidity: "Volume is thin outside the session.",
});

const SYNTHESIS = JSON.stringify({
  title: "Memory names lead the open",
  sections: [
    { heading: "Analyst notes", body: "Four seats reported. MU at 1000.26." },
    { heading: "Bull case", body: "Supply is tight." },
    { heading: "Bear case", body: "Margins compress." },
    { heading: "Risk read", body: "Three lenses agree the range is wide." },
    { heading: "Balance of evidence", body: "The evidence leans bullish; a break of 902.4 would change it." },
  ],
});

/** Maps a versionId onto its scripted answer. `faults` makes one stage throw. */
function script(faults: Record<string, Error> = {}) {
  return (options: AskOptions): string => {
    const version = options.versionId;
    const fault = faults[version];
    if (fault) {
      throw fault;
    }
    const analyst = MARKET_ANALYSTS.find((name) => version === `market-team-${name}`);
    if (analyst) {
      return analystNote(analyst);
    }
    if (version === "market-team-bull") {
      return BULL;
    }
    if (version === "market-team-bear") {
      return BEAR;
    }
    if (version === "market-team-risk") {
      return RISK;
    }
    // The synthesis and the quick single-pass draft share the `{title, sections[]}` contract.
    return SYNTHESIS;
  };
}

describe("market analyst team", () => {
  let db: Database.Database;
  let artifacts: ArtifactStore;
  let asked: AskOptions[];
  let events: JobEvent[];

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    artifacts = createArtifactStore(db, () => KEY);
    asked = [];
    events = [];
    vi.stubEnv("AGENTFORGE_RUNTIME", "ai");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    db.close();
  });

  function deps(faults: Record<string, Error> = {}): MarketGenerateDeps {
    const answer = script(faults);
    return {
      db: () => db,
      now,
      artifacts: () => artifacts,
      webReady: () => false,
      ingest: async () => ({ status: "skipped", reason: "test" }),
      buildPacket: async () => ({ packet: packetFixture(), failures: [] }),
      ask: async (options) => {
        asked.push(options);
        return answer(options);
      },
    };
  }

  const emit = (event: JobEvent) => {
    events.push(event);
  };

  const versions = () => asked.map((call) => call.versionId);
  const phases = () =>
    events.filter((event): event is Extract<JobEvent, { type: "job.phase" }> => event.type === "job.phase");

  it("runs four analysts, a debate, one risk read and the synthesis — eight calls, never more", async () => {
    const result = await generateMarketBriefing(tenant, REQUEST, emit, undefined, deps());

    expect(analystsFor("saham")).toEqual([...MARKET_ANALYSTS]);
    expect(asked).toHaveLength(TEAM_MAX_CALLS);
    expect(versions().slice(-4)).toEqual([
      "market-team-bull",
      "market-team-bear",
      "market-team-risk",
      "market-team-synthesis",
    ]);
    // The four analysts come first, in the harness's order; concurrency does not change which ran.
    expect(versions().slice(0, 4).sort()).toEqual(MARKET_ANALYSTS.map((name) => `market-team-${name}`).sort());
    expect(result.briefing.depth).toBe("team");
    expect(result.briefing.team?.analysts.map((note) => note.analyst).sort()).toEqual([...MARKET_ANALYSTS].sort());
    expect(result.briefing.team?.rounds).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it("gives the analysts no tools and their own slice, and keeps the desk's tools for the editor", async () => {
    await generateMarketBriefing(tenant, REQUEST, emit, undefined, deps());

    const analystCalls = asked.filter((call) => call.versionId.startsWith("market-team-"));
    const analysts = analystCalls.filter((call) => call.versionId !== "market-team-synthesis");
    expect(analysts.every((call) => call.toolKeys?.length === 0)).toBe(true);

    const synthesis = asked.at(-1);
    expect(synthesis?.versionId).toBe("market-team-synthesis");
    expect(synthesis?.toolKeys).toContain(MARKET_TOOL_BINDINGS.quotes);
    // The reader's own question reaches the editor and nobody else.
    expect(synthesis?.prompt).toContain(REQUEST.prompt);
    const technical = asked.find((call) => call.versionId === "market-team-technical");
    const news = asked.find((call) => call.versionId === "market-team-news");
    expect(technical?.prompt).not.toContain(REQUEST.prompt);
    expect(technical?.prompt).not.toBe(news?.prompt);
  });

  it("emits a phase per stage plus one step per analyst", async () => {
    await generateMarketBriefing(tenant, REQUEST, emit, undefined, deps());

    expect(phases().map((event) => event.phase)).toEqual(
      expect.arrayContaining(["analysts", "debate", "risk", "synthesis"]),
    );
    const steps = events.filter((event) => event.type === "job.step" && event.phase === "analysts");
    expect(steps).toHaveLength(MARKET_ANALYSTS.length);
    expect(steps.map((step) => (step as { label: string }).label)).toEqual(
      expect.arrayContaining([expect.stringContaining(`${MARKET_ANALYSTS.length}/${MARKET_ANALYSTS.length}`)]),
    );
  });

  it("degrades one failed analyst to an unavailable note and still writes the briefing", async () => {
    const result = await generateMarketBriefing(
      tenant,
      REQUEST,
      emit,
      undefined,
      deps({ "market-team-fundamentals": new Error("gateway timeout") }),
    );

    expect(asked).toHaveLength(TEAM_MAX_CALLS);
    const note = result.briefing.team?.analysts.find((entry) => entry.analyst === "fundamentals");
    expect(note).toEqual({ analyst: "fundamentals", summary: ANALYST_UNAVAILABLE, keyPoints: [], confidence: "low" });
    expect(result.failures).toContain("team: fundamentals analyst unavailable (gateway timeout)");
    // The other three seats are untouched.
    expect(result.briefing.team?.analysts.filter((entry) => entry.summary !== ANALYST_UNAVAILABLE)).toHaveLength(3);
    expect(result.briefing.sections.length).toBeGreaterThan(0);
  });

  it("degrades a failed risk read to three lenses that say so", async () => {
    const result = await generateMarketBriefing(
      tenant,
      REQUEST,
      emit,
      undefined,
      deps({ "market-team-risk": new Error("bad JSON") }),
    );

    expect(result.briefing.team?.risk.lenses.map((lens) => lens.lens)).toEqual([...RISK_LENSES]);
    expect(result.briefing.team?.risk.volatility).toBe(ANALYST_UNAVAILABLE);
    expect(result.failures).toContain("team: risk read unavailable (bad JSON)");
  });

  it("runs both guards over the stored notes, not only over the rendered sections", async () => {
    const result = await generateMarketBriefing(tenant, REQUEST, emit, undefined, deps());

    const bear = result.briefing.team?.bear;
    // The advice guard replaces the directive sentence inside the stored thesis.
    expect(bear?.thesis).toContain(ADVICE_MARKER);
    expect(bear?.thesis).not.toContain("Sell now");
    // The number guard replaces a figure the packet never carried.
    expect(bear?.points.join(" ")).toContain(UNVERIFIED_MARKER);
    expect(bear?.points.join(" ")).not.toContain("4321.99");
    // A figure that is in the packet survives.
    expect(result.briefing.team?.bull.thesis).toContain("1000.26");
  });

  it("falls back to a quick briefing on a desk whose harness names no analysts", async () => {
    expect(teamAvailable("scanner")).toBe(false);
    const result = await generateMarketBriefing(
      tenant,
      { ...REQUEST, specialist: "scanner" },
      emit,
      undefined,
      deps(),
    );

    expect(asked).toHaveLength(1);
    expect(asked[0]?.versionId).toBe("market-briefing");
    expect(result.briefing.depth).toBe("quick");
    expect(result.briefing.team).toBeUndefined();
    expect(result.failures).toContain(
      "team: the scanner desk has no analyst team; wrote a quick briefing instead",
    );
  });

  it("leaves a quick request exactly as it was: one call, no team", async () => {
    const result = await generateMarketBriefing(
      tenant,
      { ...REQUEST, depth: "quick" },
      emit,
      undefined,
      deps(),
    );

    expect(asked).toHaveLength(1);
    expect(result.briefing.depth).toBe("quick");
    expect(result.briefing.team).toBeUndefined();
    expect(phases().map((event) => event.phase)).not.toContain("analysts");
  });
});

describe("guardTeamNotes", () => {
  const notes = {
    analysts: [
      { analyst: "technical" as const, summary: "Jual sekarang di 999999.11.", keyPoints: ["Buy now"], confidence: "high" as const },
    ],
    bull: { stance: "bull" as const, thesis: "Fine.", points: ["Fine"], rebuttals: [] },
    bear: unavailableSide("bear"),
    risk: unavailableRisk(),
    rounds: 1 as const,
  };

  it("replaces directives and untraceable figures in every free-text field and returns new objects", () => {
    const guarded = guardTeamNotes(notes, [1000.26]);

    expect(guarded.analysts[0]?.summary).toContain(ADVICE_MARKER);
    expect(guarded.analysts[0]?.summary).not.toContain("999999.11");
    expect(guarded.analysts[0]?.keyPoints[0]).toContain(ADVICE_MARKER);
    // The confidence and the analyst name are structure, not prose: untouched.
    expect(guarded.analysts[0]?.confidence).toBe("high");
    expect(guarded.analysts[0]?.analyst).toBe("technical");
    // Pure: the input is not mutated.
    expect(notes.analysts[0]?.summary).toBe("Jual sekarang di 999999.11.");
    expect(guarded).not.toBe(notes);
  });

  it("leaves an unavailable note readable rather than guarding the marker itself", () => {
    const guarded = guardTeamNotes(notes, [1000.26]);
    expect(guarded.bear.thesis).toBe(ANALYST_UNAVAILABLE);
    expect(guarded.risk.volatility).toBe(ANALYST_UNAVAILABLE);
  });
});
