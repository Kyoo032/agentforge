import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { DOSSIER_HEADINGS, dossierToMarkdown } from "@agentforge/core/artifacts";
import type { JobEvent } from "@agentforge/core/jobs";
import {
  CITE_REPAIR_SYSTEM,
  CLAIMS_SYSTEM,
  EXTRACT_SYSTEM,
  PLAN_SYSTEM,
  SYNTHESIS_SYSTEM,
  buildComparison,
  claimsForRun,
  dedupeCandidates,
  findingCitesResolve,
  groundFindings,
  parseClaimPassages,
  parseExtraction,
  parsePlan,
  parseRepairFindings,
  parseSynthesis,
  passageBackedIds,
  runResearchDossier,
  stripInventedQuotes,
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
      if (system === CLAIMS_SYSTEM) {
        return JSON.stringify({ claims: [] });
      }
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
              body: "Two bankruptcies [S2].",
              sources: ["S2"],
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
    expect(dossier.findings[1]?.sources).toEqual(["S2"]);
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
    expect(phases).toEqual(["planning", "searching", "reading", "comparing", "drafting"]);
    expect(dossier.comparison).toEqual([]);
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

  it("cites a kept passage: rewrites once, then drops a cite that still does not resolve", async () => {
    let repairs = 0;
    const deps = fakeDeps({
      locale: "id",
      ask: async (system, prompt) => {
        if (system === CITE_REPAIR_SYSTEM) {
          repairs += 1;
          return JSON.stringify({
            findings: [
              { heading: "Margins are thin", body: "About 12% [S1].", sources: ["S1"] },
              { heading: "Ghost", body: "Still only [S9].", sources: ["S9"] },
            ],
          });
        }
        if (system === SYNTHESIS_SYSTEM) {
          return JSON.stringify({
            title: "T",
            summary: "S",
            findings: [
              { heading: "Margins are thin", body: "About 12% [S1] and a ghost [S9].", sources: ["S1", "S9"] },
              { heading: "Unread", body: "Snippet only [S3].", sources: ["S3"] },
            ],
            contradictions: ["[S9] disagrees with [S1]"],
            openQuestions: ["What happens to black mass prices?"],
          });
        }
        return fakeDeps().ask(system, prompt);
      },
    });
    const { dossier } = await runResearchDossier({ question: QUESTION, models: ["m1"] }, deps);
    expect(repairs).toBe(1);
    expect(dossier.findings).toEqual([{ heading: "Margins are thin", body: "About 12% [S1].", sources: ["S1"] }]);
    expect(dossier.findings.some((finding) => finding.body.includes("[S9]") || finding.sources.includes("S3"))).toBe(
      false,
    );
    expect(dossier.contradictions).toEqual(["disagrees with [S1]"]);
    expect(dossier.openQuestions).toContain("Tidak ada kutipan yang tersimpan untuk: Ghost");
    const phases = deps.events.filter((event) => event.type === "job.phase");
    expect(phases.map((event) => (event as { phase: string }).phase)).toEqual([
      "planning",
      "searching",
      "reading",
      "comparing",
      "drafting",
      "checking",
    ]);
    expect(phases.find((event) => (event as { phase: string }).phase === "comparing")).toMatchObject({
      label: "Membandingkan sumber",
    });
    expect(phases.at(-1)).toMatchObject({ label: "Memeriksa kutipan" });
  });

  it("does not draft when no page kept a passage", async () => {
    const deps = fakeDeps({
      readPage: async () => {
        throw new Error("HTTP 404");
      },
    });
    await expect(runResearchDossier({ question: QUESTION, models: [] }, deps)).rejects.toThrow(
      /No page kept a sentence/,
    );
    expect(deps.asked).not.toContain(SYNTHESIS_SYSTEM);
    expect(deps.asked).not.toContain(CITE_REPAIR_SYSTEM);
  });
});

describe("cite a kept passage", () => {
  const backed = new Set(["S1"]);

  it("backs only a read source that kept a verbatim passage", () => {
    expect(
      passageBackedIds([
        { id: "S1", status: "read", passages: ["Margins reached 12% in 2025."] },
        { id: "S2", status: "read", passages: [] },
        { id: "S3", status: "unreachable", passages: ["A long search snippet that is not a page passage."] },
      ]),
    ).toEqual(new Set(["S1"]));
    expect(findingCitesResolve({ heading: "H", body: "About 12% [S1].", sources: ["S1"] }, backed)).toBe(true);
    expect(findingCitesResolve({ heading: "H", body: "Ghost [S9].", sources: ["S9"] }, backed)).toBe(false);
  });

  it("strips a cite the repair pass still cannot resolve", () => {
    expect(parseRepairFindings("not json")).toBeNull();
    expect(groundFindings([{ heading: "H", body: "Kept [S1] and [S9].", sources: ["S1", "S9"] }], backed)).toEqual([
      { heading: "H", body: "Kept [S1] and.", sources: ["S1"] },
    ]);
  });
});

const MARGINS = "Margins reached 12% in 2025.";
const CHEESE = "The moon is made of cheese.";
const PASTED = `Check these claims.\n\n${MARGINS} ${CHEESE}`;

describe("claimed sources and comparison", () => {
  it("keeps a claim only when it is in the question or the pasted text", () => {
    const raw = JSON.stringify({
      claims: [MARGINS, CHEESE, "A fabricated claim that is not in the prompt at all."],
    });
    expect(claimsForRun(raw, PASTED, 5)).toEqual([MARGINS, CHEESE]);
    expect(claimsForRun("not json", PASTED, 5)).toEqual([MARGINS, CHEESE]);
    expect(claimsForRun(JSON.stringify({ claims: [] }), QUESTION, 5)).toEqual([QUESTION]);
  });

  it("drops a passage that is not on the page", () => {
    const page = "Margins fell to 2% in 2025 and plants closed.";
    const raw = JSON.stringify({
      onClaims: [
        { claim: MARGINS, passage: page, stance: "contradicts" },
        { claim: CHEESE, passage: CHEESE, stance: "supports" },
        { claim: MARGINS, passage: page, stance: "maybe" },
        { claim: "Not a pulled claim at all.", passage: page, stance: "supports" },
      ],
    });
    expect(parseClaimPassages(raw, page, [MARGINS, CHEESE])).toEqual([
      { claim: MARGINS, passage: page, stance: "contradicts" },
    ]);
  });

  it("builds agree, contradict, and only in code, and drops a claim with no passage", () => {
    const fell = "Margins fell to 2% in 2025 and plants closed.";
    const rows = buildComparison(
      [MARGINS, "Two recyclers filed for bankruptcy.", CHEESE, "Only the tides are mentioned here."],
      [
        { claim: MARGINS, sourceId: "S3", passage: fell, stance: "contradicts" },
        { claim: MARGINS, sourceId: "S1", passage: MARGINS, stance: "supports" },
        {
          claim: "Two recyclers filed for bankruptcy.",
          sourceId: "S2",
          passage: "Two recyclers filed.",
          stance: "supports",
        },
        {
          claim: "Two recyclers filed for bankruptcy.",
          sourceId: "S4",
          passage: "Two recyclers filed.",
          stance: "supports",
        },
        { claim: CHEESE, sourceId: "S5", passage: CHEESE, stance: "supports" },
      ],
    );
    expect(rows).toEqual([
      { claim: MARGINS, verdict: "contradict", sources: ["S1", "S3"] },
      { claim: "Two recyclers filed for bankruptcy.", verdict: "agree", sources: ["S2", "S4"] },
      { claim: CHEESE, verdict: "only", sources: ["S5"] },
    ]);
  });

  it("drops a quote that is not a kept passage", () => {
    expect(stripInventedQuotes(`One page says "${MARGINS}" and "the moon is made of cheese".`, [MARGINS])).toBe(
      `One page says "${MARGINS}" and.`,
    );
  });

  it("drops a claim with no kept passage and builds the comparison row in code", async () => {
    const fell = "Margins fell to 2% in 2025 and plants closed.";
    const searched: string[] = [];
    const deps = fakeDeps({
      locale: "id",
      caps: { maxQueries: 2, maxPages: 4 },
      ask: async (system, prompt) => {
        if (system === CLAIMS_SYSTEM) {
          return JSON.stringify({
            claims: [MARGINS, CHEESE, "A fabricated claim that is not in the prompt at all."],
          });
        }
        if (system === PLAN_SYSTEM) {
          return JSON.stringify({ queries: ["this extra query must not be searched"] });
        }
        if (system === EXTRACT_SYSTEM) {
          const text = prompt.split("Page text:\n")[1] ?? "";
          const sentence = `${text.split(". ")[0]}.`;
          const onClaims = text.includes("Margins fell")
            ? [{ claim: MARGINS, passage: fell, stance: "contradicts" }]
            : text.includes("Margins reached")
              ? [{ claim: MARGINS, passage: MARGINS, stance: "supports" }]
              : [{ claim: CHEESE, passage: CHEESE, stance: "supports" }];
          return JSON.stringify({ passages: [sentence], notes: "ok", onClaims });
        }
        if (system === SYNTHESIS_SYSTEM) {
          expect(prompt).toContain(`${MARGINS} — contradict [S1][S3]`);
          expect(prompt).not.toContain(`${CHEESE} —`);
          return JSON.stringify({
            title: "Claim check",
            summary: "The pages do not agree.",
            findings: [
              {
                heading: "Margins",
                body: `One page says "${MARGINS}" [S1]. A blog said "the moon is made of cheese".`,
                sources: ["S1"],
              },
            ],
            comparison: [{ claim: "Invented by the model", verdict: "agree", sources: ["S9"] }],
            contradictions: [],
            openQuestions: [],
          });
        }
        throw new Error(`unexpected system prompt`);
      },
      search: async (query) => {
        searched.push(query);
        if (query === MARGINS) {
          return [
            { title: "High", url: "https://a.test/high" },
            { title: "Low", url: "https://b.test/low" },
          ];
        }
        if (query === CHEESE) {
          return [{ title: "Tides", url: "https://c.test/tides" }];
        }
        return [{ title: "Dead", url: "https://dead.test/", description: "snippet dead" }];
      },
      readPage: async (url) => {
        const pages: Record<string, string> = {
          "https://a.test/high": `${MARGINS} Recyclers report thin returns.`,
          "https://b.test/low": `${fell} Demand for black mass fell.`,
          "https://c.test/tides": "This page discusses ocean tides and nothing about the claim.",
        };
        const text = pages[url];
        if (!text) {
          throw new Error("HTTP 404");
        }
        return { title: url, text, truncated: false };
      },
    });

    const { dossier } = await runResearchDossier({ question: PASTED, models: ["m1"] }, deps);

    expect(searched).toEqual([MARGINS, CHEESE]);
    expect(dossier.comparison).toEqual([{ claim: MARGINS, verdict: "contradict", sources: ["S1", "S3"] }]);
    expect(dossier.comparison.some((row) => row.claim === CHEESE || row.claim === "Invented by the model")).toBe(false);
    expect(dossier.findings[0]?.body).toBe(`One page says "${MARGINS}" [S1]. A blog said.`);
    expect(dossier.findings[0]?.sources).toEqual(["S1"]);

    const md = dossierToMarkdown(dossier, "id");
    expect(md).toContain(`${MARGINS} — Sumber bertentangan [S1][S3]`);
    expect(md).toContain("## Comparison");
    const phases = deps.events
      .filter((event) => event.type === "job.phase")
      .map((event) => (event as { phase: string }).phase);
    expect(phases).toEqual(["planning", "searching", "reading", "comparing", "drafting"]);
  });
});
