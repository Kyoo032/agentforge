import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { UNVERIFIED_MARKER } from "@agentforge/core/finance";
import type { WorkCard } from "./work-cards";

/**
 * The gateway call and the Knowledge Base write are the two edges of `regenerateFinanceSection`.
 * Both are module imports rather than injected dependencies here, so they are mocked at the module
 * boundary; everything between them (guard, repair, merge, artifact id) is the real code. Queued
 * answers go out first, one per call; after that every call gets `sectionDraft`.
 */
const asked: Array<Record<string, unknown>> = [];
const ingested: WorkCard[] = [];
const queued: string[] = [];
let sectionDraft = "";

vi.mock("./job-regen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./job-regen")>();
  return {
    ...actual,
    collectJobAssistantText: async (options: Record<string, unknown>) => {
      asked.push(options);
      return queued.shift() ?? sectionDraft;
    },
    collectJobAssistantRun: async (options: Record<string, unknown>) => {
      asked.push(options);
      return { text: queued.shift() ?? sectionDraft, model: "stub-model" };
    },
  };
});

vi.mock("./knowledge-ingest", () => ({
  upsertWorkSource: async (_tenant: TenantContext, card: WorkCard) => {
    ingested.push(card);
    return { status: "skipped" as const, reason: "test" };
  },
  ingestWorkSource: () => {},
}));

const { EMPTIED_SECTION_BODY, generateFinanceBrief, readRegenArtifactId, regenerateFinanceSection } = await import(
  "./finance-generate"
);

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws-finance-regen",
  userId: "local",
  role: "owner",
};

const BRIEF = {
  title: "FY2025 Gross Margin Review",
  sections: [
    { heading: "Where the margin came from", body: "Revenue was 1000.", metrics: [] },
    { heading: "What to watch", body: "COGS was 400.", metrics: [] },
  ],
  assumptions: ["Figures are FY2025."],
  computed: { metrics: [], tables: [] },
};

const ITEMS = [
  { label: "Revenue", period: "2025", amount: 1000, currency: "IDR", category: "revenue" },
  { label: "COGS", period: "2025", amount: 400, currency: "IDR", category: "cogs" },
];

function body(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { brief: BRIEF, sectionIndex: 1, prompt: "Gross margin story", items: ITEMS, ...extra };
}

describe("generateFinanceBrief", () => {
  beforeEach(() => {
    asked.length = 0;
    ingested.length = 0;
    queued.length = 0;
    vi.stubEnv("AGENTFORGE_RUNTIME", "ai");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // An assumption resting on a figure nobody computed is dropped; the reader is told a sentence went.
  it("counts an assumption the guard dropped as a removed sentence, so the reader is told", async () => {
    queued.push(
      JSON.stringify({
        title: "Margin story",
        sections: [{ heading: "Where the margin came from", body: "Revenue was 1000 and COGS was 400.", metrics: [] }],
        assumptions: ["Figures are FY2025.", "Headcount holds at 140 staff."],
      }),
    );
    const result = await generateFinanceBrief(tenant, { prompt: "Gross margin story", items: ITEMS, locale: "en" });
    if (!("brief" in result)) {
      throw new Error("expected the brief path");
    }
    expect(result.brief.assumptions).toEqual(["Figures are FY2025."]);
    expect(result.guard).toEqual({ flagged: [{ section: -1, text: "140" }], total: 1, removed: 1 });
    expect(asked).toHaveLength(1);
  });

  // A section whose every sentence the repair took out used to fail the brief schema (a body may not
  // be empty), and the job answered 500. The slot stays, as a regenerate keeps the section it replaced.
  it("keeps a section the repair emptied, saying why without a figure, and ships no marker", async () => {
    queued.push(
      JSON.stringify({
        title: "Margin story",
        sections: [
          { heading: "Where the margin came from", body: "Revenue was 1000 and COGS was 400.", metrics: [] },
          { heading: "What to watch", body: "Margin hit 62.5%.", metrics: [] },
        ],
        assumptions: [],
      }),
      JSON.stringify({ heading: "What to watch", body: "Margin hit 71%.", metrics: [] }),
    );
    const result = await generateFinanceBrief(tenant, { prompt: "Gross margin story", items: ITEMS, locale: "en" });
    if (!("brief" in result)) {
      throw new Error("expected the brief path");
    }
    expect(asked).toHaveLength(2);
    expect(result.brief.sections.map((section) => [section.heading, section.body])).toEqual([
      ["Where the margin came from", "Revenue was 1000 and COGS was 400."],
      ["What to watch", EMPTIED_SECTION_BODY.en],
    ]);
    expect(EMPTIED_SECTION_BODY.en).not.toMatch(/\d/);
    expect(result.guard.total).toBe(2);
    expect(result.guard.removed).toBe(1);
    expect(JSON.stringify(result.brief)).not.toContain(UNVERIFIED_MARKER);
    expect(result.markdown).not.toContain(UNVERIFIED_MARKER);
    expect(result.artifactId).toBeTruthy();
  });

  it("keeps the brief when the repair emptied every section, in the reader's language", async () => {
    queued.push(
      JSON.stringify({
        title: "Cerita margin",
        sections: [{ heading: "Margin", body: "Margin mencapai 97%.", metrics: [] }],
        assumptions: [],
      }),
      // A rewrite nobody can read: the repair keeps the marked section and takes the sentence out.
      "not json",
    );
    const result = await generateFinanceBrief(tenant, { prompt: "Cerita margin", items: ITEMS, locale: "id" });
    if (!("brief" in result)) {
      throw new Error("expected the brief path");
    }
    expect(result.brief.sections).toEqual([
      { heading: "Margin", body: EMPTIED_SECTION_BODY.id, tables: [], metrics: [] },
    ]);
    expect(EMPTIED_SECTION_BODY.id).not.toMatch(/\d/);
    expect(result.guard.removed).toBe(1);
    expect(result.markdown).not.toContain(UNVERIFIED_MARKER);
  });
});

describe("readRegenArtifactId", () => {
  it("reads a non-empty string id and nothing else", () => {
    expect(readRegenArtifactId({ artifactId: "abc-123" })).toBe("abc-123");
    expect(readRegenArtifactId({ artifactId: "  abc-123  " })).toBe("abc-123");
    expect(readRegenArtifactId({ artifactId: "" })).toBeNull();
    expect(readRegenArtifactId({ artifactId: "   " })).toBeNull();
    expect(readRegenArtifactId({ artifactId: 12 })).toBeNull();
    expect(readRegenArtifactId({})).toBeNull();
    expect(readRegenArtifactId(null)).toBeNull();
  });
});

describe("regenerateFinanceSection", () => {
  beforeEach(() => {
    asked.length = 0;
    ingested.length = 0;
    queued.length = 0;
    sectionDraft = JSON.stringify({
      heading: "What to watch next",
      body: "COGS was 400 against revenue of 1000.",
      metrics: [],
    });
    vi.stubEnv("AGENTFORGE_RUNTIME", "ai");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // F1: the studio used to get `artifactId: null` back, so the next "Send to Knowledge Base"
  // pasted a second row next to the card the original generate had already indexed.
  it("returns the artifact the brief was saved as, so the next send stays idempotent", async () => {
    const result = await regenerateFinanceSection(tenant, body({ artifactId: "artifact-1" }));
    expect(result.artifactId).toBe("artifact-1");
    expect(result.brief.sections[1]?.heading).toBe("What to watch next");
    expect(result.brief.sections[0]?.body).toBe("Revenue was 1000.");
    expect(result.markdown).toContain("What to watch next");
  });

  it("rewrites the same origin's card with the merged brief", async () => {
    const result = await regenerateFinanceSection(tenant, body({ artifactId: "artifact-1" }));
    expect(ingested).toHaveLength(1);
    expect(ingested[0]).toMatchObject({
      type: "Finance",
      origin: { kind: "artifact", id: "artifact-1" },
      pointer: "artifact:artifact-1",
      title: "FY2025 Gross Margin Review",
      prompt: "Gross margin story",
    });
    expect(ingested[0]?.body).toBe(result.markdown);
  });

  it("indexes nothing and answers null when the caller sends no artifact", async () => {
    const result = await regenerateFinanceSection(tenant, body());
    expect(result.artifactId).toBeNull();
    expect(ingested).toEqual([]);
  });

  it("still guards figures the metrics do not support", async () => {
    sectionDraft = JSON.stringify({ heading: "What to watch", body: "Margin hit 62.5%.", metrics: [] });
    const result = await regenerateFinanceSection(tenant, body({ artifactId: "artifact-1" }));
    expect(result.guard.total).toBeGreaterThan(0);
    expect(result.guard.flagged[0]?.section).toBe(1);
  });

  // The rewrite used to be guarded and then shipped: "[unverified figure]" went straight to the reader.
  it("rewrites a blanked figure once, the same repair a generate runs, and ships no marker", async () => {
    queued.push(
      JSON.stringify({ heading: "What to watch", body: "Margin hit 62.5%. COGS was 400.", metrics: [] }),
      JSON.stringify({ heading: "What to watch", body: "COGS was 400 against revenue of 1000.", metrics: [] }),
    );
    const result = await regenerateFinanceSection(tenant, body({ artifactId: "artifact-1" }));
    expect(asked).toHaveLength(2);
    expect(String(asked[1]?.prompt)).toContain("Margin hit [unverified figure].");
    expect(result.brief.sections[1]?.body).toBe("COGS was 400 against revenue of 1000.");
    expect(result.markdown).not.toContain(UNVERIFIED_MARKER);
    expect(JSON.stringify(result.brief)).not.toContain(UNVERIFIED_MARKER);
    expect(result.guard).toEqual({ flagged: [{ section: 1, text: "62.5%" }], total: 1, removed: 0 });
    expect(ingested[0]?.body).not.toContain(UNVERIFIED_MARKER);
  });

  it("takes the sentence out when the rewrite invents again, and counts it", async () => {
    sectionDraft = JSON.stringify({ heading: "What to watch", body: "Margin hit 62.5%. COGS was 400.", metrics: [] });
    const result = await regenerateFinanceSection(tenant, body());
    expect(result.brief.sections[1]?.body).toBe("COGS was 400.");
    expect(result.markdown).not.toContain(UNVERIFIED_MARKER);
    expect(result.guard.removed).toBe(1);
    expect(result.guard.flagged).toEqual([
      { section: 1, text: "62.5%" },
      { section: 1, text: "62.5%" },
    ]);
  });

  // A section cannot be empty; a rewrite with nothing traceable left keeps the section it replaced.
  it("keeps the section it was asked to replace when nothing traceable is left of the rewrite", async () => {
    sectionDraft = JSON.stringify({ heading: "What to watch", body: "Margin hit 62.5%.", metrics: [] });
    const result = await regenerateFinanceSection(tenant, body());
    expect(result.brief.sections[1]).toEqual({ ...BRIEF.sections[1], tables: [] });
    expect(result.markdown).not.toContain(UNVERIFIED_MARKER);
    expect(result.guard.total).toBe(2);
    expect(result.guard.removed).toBe(1);
  });

  it("refuses a malformed body before it reaches the gateway", async () => {
    await expect(regenerateFinanceSection(tenant, "nope")).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
    await expect(regenerateFinanceSection(tenant, body({ sectionIndex: 9 }))).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
    expect(asked).toEqual([]);
  });
});
