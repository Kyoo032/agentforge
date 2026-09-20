import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@agentforge/core";
import type { WorkCard } from "./work-cards";

/**
 * The gateway call and the Knowledge Base write are the two edges of `regenerateFinanceSection`.
 * Both are module imports rather than injected dependencies here, so they are mocked at the module
 * boundary; everything between them (guard, merge, artifact id) is the real code.
 */
const asked: Array<Record<string, unknown>> = [];
const ingested: WorkCard[] = [];
let sectionDraft = "";

vi.mock("./job-regen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./job-regen")>();
  return {
    ...actual,
    collectJobAssistantText: async (options: Record<string, unknown>) => {
      asked.push(options);
      return sectionDraft;
    },
    collectJobAssistantRun: async (options: Record<string, unknown>) => {
      asked.push(options);
      return { text: sectionDraft, model: "stub-model" };
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

const { readRegenArtifactId, regenerateFinanceSection } = await import("./finance-generate");

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
