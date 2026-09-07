import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { DOSSIER_HEADINGS, dossierToMarkdown } from "@agentforge/core/artifacts";
import type { JobEvent } from "@agentforge/core/jobs";
import {
  EXTRACT_SYSTEM,
  PLAN_SYSTEM,
  SYNTHESIS_SYSTEM,
  dedupeCandidates,
  parseExtraction,
  parsePlan,
  parseSynthesis,
  runResearchDossier,
  type DossierDeps,
} from "./research-dossier";

const QUESTION = "Is lithium battery recycling profitable in 2026?";

describe("parsePlan", () => {
  it("leads with the question, dedupes, and caps", () => {
    const raw = JSON.stringify({
      queries: ["lithium recycling margins", " Lithium Recycling Margins ", "recycler bankruptcies 2026", "", 7],
    });
    expect(parsePlan(raw, QUESTION, 5)).toEqual([QUESTION, "lithium recycling margins", "recycler bankruptcies 2026"]);
    expect(parsePlan(raw, QUESTION, 2)).toEqual([QUESTION, "lithium recycling margins"]);
  });

  it("falls back to the question alone on garbage", () => {
    expect(parsePlan("not json", QUESTION)).toEqual([QUESTION]);
    expect(parsePlan("", QUESTION)).toEqual([QUESTION]);
  });
});

describe("dedupeCandidates", () => {
  it("round-robins across queries, dedupes urls, drops non-https, caps pages", () => {
    const out = dedupeCandidates(
      [
        {
          query: "q1",
          hits: [
            { title: "A", url: "https://a.test/x/" },
            { title: "B", url: "https://b.test/" },
            { title: "F", url: "ftp://f.test/" },
          ],
        },
        {
          query: "q2",
          hits: [
            { title: "A again", url: "https://A.test/x#frag" },
            { title: "C", url: "https://c.test/" },
          ],
        },
        { query: "q3", hits: [{ title: "D", url: "https://d.test/" }] },
      ],
      3,
    );
    expect(out.map((item) => [item.id, item.url, item.foundBy])).toEqual([
      ["S1", "https://a.test/x/", "q1"],
      ["S2", "https://d.test/", "q3"],
      ["S3", "https://b.test/", "q1"],
    ]);
  });
});

describe("parseExtraction", () => {
  it("keeps only verbatim passages", () => {
    const page = "Margins reached 12% in 2025.\nRecyclers   report thin returns.\nUnrelated line.";
    const raw = JSON.stringify({
      passages: ["Margins reached 12% in 2025.", "Recyclers report thin returns.", "Margins are great, said nobody."],
      notes: "Trade body.",
    });
    expect(parseExtraction(raw, page)).toEqual({
      passages: ["Margins reached 12% in 2025.", "Recyclers report thin returns."],
      notes: "Trade body.",
    });
    expect(() => parseExtraction("nope", page)).toThrow(ApiError);
    const curly = "Recyclers \u201creport\u201d thin returns \u2014 for now\u2026";
    expect(
      parseExtraction(JSON.stringify({ passages: ['Recyclers "report" thin returns - for now...'] }), curly).passages,
    ).toEqual(['Recyclers "report" thin returns - for now...']);
  });
});

describe("parseSynthesis", () => {
  it("resolves cited ids to known sources and rejects empty findings", () => {
    const raw = JSON.stringify({
      title: "T",
      summary: "S",
      findings: [
        { heading: "H", body: "Thin margins [S1] and [S9].", sources: ["s2"] },
        { heading: "", body: "dropped" },
      ],
      contradictions: ["S1 vs S2 on margins"],
      openQuestions: [],
    });
    const out = parseSynthesis(raw, ["S1", "S2"]);
    expect(out.findings).toEqual([{ heading: "H", body: "Thin margins [S1] and [S9].", sources: ["S2", "S1"] }]);
    expect(out.contradictions).toEqual(["S1 vs S2 on margins"]);
    expect(() => parseSynthesis(JSON.stringify({ findings: [] }), ["S1"])).toThrow(/no findings/);
  });
});

function fakeDeps(overrides: Partial<DossierDeps> = {}): DossierDeps & { asked: string[]; events: JobEvent[] } {
  const asked: string[] = [];
  const events: JobEvent[] = [];
  const pages: Record<string, string> = {
    "https://a.test/report": "Margins reached 12% in 2025. Recyclers report thin returns. Filler sentence here.",
    "https://b.test/news": "Two recyclers filed for bankruptcy in March 2026. Demand for black mass fell.",
  };
  return {
    asked,
    events,
    emit: (event) => events.push(event),
    now: () => new Date("2026-09-07T10:00:00Z"),
    ask: async (system, prompt) => {
      asked.push(system);
      if (system === PLAN_SYSTEM) {
        return JSON.stringify({ queries: ["lithium recycling margins", "recycler bankruptcies 2026"] });
      }
      if (system === EXTRACT_SYSTEM) {
        const text = prompt.split("Page text:\n")[1] ?? "";
        return JSON.stringify({ passages: [`${text.split(". ")[0]}.`, "Invented sentence."], notes: "ok source" });
      }
      if (system === SYNTHESIS_SYSTEM) {
        return JSON.stringify({
          title: "Lithium recycling economics",
          summary: "Thin. Confidence: med.",
          findings: [
            { heading: "Margins are thin", body: "About 12% [S1].", sources: ["S1"] },
            {
              heading: "Failures are rising",
              body: "Two bankruptcies [S2]; S3 could not be read.",
              sources: ["S2", "S3"],
            },
          ],
          contradictions: [],
          openQuestions: ["What happens to black mass prices?"],
        });
      }
      throw new Error(`unexpected system prompt`);
    },
    search: async (query) =>
      query === QUESTION
        ? [{ title: "Report", url: "https://a.test/report", description: "snippet a" }]
        : query === "lithium recycling margins"
          ? [
              { title: "News", url: "https://b.test/news", description: "snippet b" },
              { title: "Report dup", url: "https://a.test/report/" },
            ]
          : [{ title: "Dead", url: "https://dead.test/", description: "snippet dead" }],
    readPage: async (url) => {
      const text = pages[url];
      if (!text) {
        throw new Error("HTTP 404");
      }
      return { title: `Title of ${url}`, text, truncated: false };
    },
    ...overrides,
  };
}

describe("runResearchDossier", () => {
  it("plans, searches, reads, extracts verbatim passages, and cites real sources", async () => {
    const deps = fakeDeps();
    const { dossier, notes } = await runResearchDossier({ question: QUESTION, models: ["m1"] }, deps);

    expect(dossier.queries).toEqual([QUESTION, "lithium recycling margins", "recycler bankruptcies 2026"]);
    expect(dossier.sources.map((source) => [source.id, source.status])).toEqual([
      ["S1", "read"],
      ["S2", "read"],
      ["S3", "unreachable"],
    ]);
    expect(dossier.sources[0]?.passages).toEqual(["Margins reached 12% in 2025."]);
    expect(dossier.sources[2]?.passages).toEqual(["snippet dead"]);
    expect(dossier.sources[2]?.notes).toMatch(/HTTP 404/);
    expect(dossier.sources[0]?.retrievedAt).toBe("2026-09-07T10:00:00.000Z");
    expect(dossier.findings[1]?.sources).toEqual(["S2", "S3"]);
    expect(dossier.openQuestions).toEqual(["What happens to black mass prices?"]);

    expect(notes.title).toBe("Lithium recycling economics");
    expect(notes.notes[0]?.sources).toEqual([
      { title: "S1 Title of https://a.test/report", url: "https://a.test/report" },
    ]);

    const md = dossierToMarkdown(dossier);
    for (const heading of Object.values(DOSSIER_HEADINGS)) {
      expect(md).toContain(heading);
    }
    expect(md).toContain("### S3 — Dead");
    expect(md).toContain("- Status: unreachable");

    const phases = deps.events
      .filter((event) => event.type === "job.phase")
      .map((event) => (event as { phase: string }).phase);
    expect(phases).toEqual(["planning", "searching", "reading", "drafting"]);
    const reads = deps.events.filter(
      (event) => event.type === "job.step" && (event as { phase: string }).phase === "reading",
    );
    expect(reads).toHaveLength(3);
    expect(deps.asked.filter((system) => system === EXTRACT_SYSTEM)).toHaveLength(2);
  });

  it("enforces query and page caps", async () => {
    const deps = fakeDeps({ caps: { maxQueries: 1, maxPages: 1 } });
    const { dossier } = await runResearchDossier({ question: QUESTION, models: [] }, deps);
    expect(dossier.queries).toEqual([QUESTION]);
    expect(dossier.sources).toHaveLength(1);
  });

  it("still searches when the planner fails and fails visibly with no results", async () => {
    const deps = fakeDeps({
      ask: async (system) => {
        if (system === PLAN_SYSTEM) {
          throw new Error("planner down");
        }
        return fakeDeps().ask(system, "Page text:\nMargins reached 12% in 2025. x");
      },
    });
    const { dossier } = await runResearchDossier({ question: QUESTION, models: [] }, deps);
    expect(dossier.queries).toEqual([QUESTION]);
    await expect(
      runResearchDossier({ question: QUESTION, models: [] }, fakeDeps({ search: async () => [] })),
    ).rejects.toThrow(/no readable HTTPS results/);
  });

  it("stops between phases when cancelled", async () => {
    const controller = new AbortController();
    const deps = fakeDeps({
      abortSignal: controller.signal,
      search: async () => {
        controller.abort();
        return [{ title: "x", url: "https://a.test/report" }];
      },
    });
    await expect(runResearchDossier({ question: QUESTION, models: [] }, deps)).rejects.toMatchObject({
      code: "aborted",
    });
    expect(deps.asked).not.toContain(SYNTHESIS_SYSTEM);
  });
});
