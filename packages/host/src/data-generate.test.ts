import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatModel, TenantContext } from "@agentforge/core";
import type { WorkCard } from "./work-cards";

/**
 * A Data job against a real pasted table in a throwaway data dir. The gateway call, the artifact
 * store and the Knowledge Base write are mocked at the module boundary; the dataset, the SQL runner,
 * the pin and what gets recorded are the real code.
 */
process.env.AGENTFORGE_DATA_DIR = mkdtempSync(join(tmpdir(), "agentforge-data-generate-"));

type Asked = Record<string, unknown>;
const asked: Asked[] = [];
const created: Array<{ meta?: Record<string, unknown> }> = [];
const ingested: WorkCard[] = [];
let answeredBy = "";

const ANALYSIS = JSON.stringify({
  title: "Acme carries most of the spend",
  summary: "Two vendors, one of them large.",
  findings: [{ heading: "Acme is the larger vendor", body: "Acme spends more than Beta.", sql: null }],
  charts: [],
});

vi.mock("./job-regen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./job-regen")>();
  return {
    ...actual,
    collectJobAssistantText: async (options: Asked) => {
      asked.push(options);
      return ANALYSIS;
    },
    collectJobAssistantRun: async (options: Asked) => {
      asked.push(options);
      return { text: ANALYSIS, model: answeredBy || options.model };
    },
  };
});

vi.mock("./artifacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./artifacts")>();
  return {
    ...actual,
    artifactStore: () => ({
      create: (_tenant: TenantContext, input: { meta?: Record<string, unknown> }) => {
        created.push(input);
        return { id: "artifact-1" };
      },
    }),
  };
});

vi.mock("./knowledge-ingest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./knowledge-ingest")>();
  return {
    ...actual,
    upsertWorkSource: async (_tenant: TenantContext, card: WorkCard) => {
      ingested.push(card);
      return { status: "skipped" as const, reason: "test" };
    },
  };
});

const CATALOG = ["deepseek-v4-flash", "gpt-5.6-luna", "gpt-5.6-sol"].map(
  (id): ChatModel => ({ id, label: id, provider: "openai", inputModalities: ["text"] }) as ChatModel,
);

vi.mock("./selectable-models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./selectable-models")>();
  return {
    ...actual,
    listSelectableModels: () => CATALOG,
    modeCatalogPayload: () => ({ defaults: { data: "deepseek-v4-flash" } }),
  };
});

const { analyzeDataset } = await import("./data-generate");

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws-data-model",
  userId: "local",
  role: "owner",
};

const CSV = "vendor,spend\nAcme,12000\nBeta,4100";

describe("the model a Data job uses and records", () => {
  beforeEach(() => {
    asked.length = 0;
    created.length = 0;
    ingested.length = 0;
    answeredBy = "";
    vi.stubEnv("AGENTFORGE_RUNTIME", "ai");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records the model that answered, not the one requested, when a stand-in wrote the analysis", async () => {
    answeredBy = "gpt-5.6-luna";
    const result = await analyzeDataset(tenant, { prompt: "Who spends most?", csv: CSV, model: "deepseek-v4-flash" });
    expect(result.analysis.title).toBe("Acme carries most of the spend");
    expect(asked[0]?.model).toBe("deepseek-v4-flash");
    expect(created[0]?.meta?.model).toBe("gpt-5.6-luna");
    expect(ingested[0]?.model).toBe("gpt-5.6-luna");
  });

  it("hands a pinned pick to the job run as modelExplicit", async () => {
    await analyzeDataset(tenant, { prompt: "Who spends most?", csv: CSV, model: "gpt-5.6-sol", modelPinned: true });
    expect(asked[0]).toMatchObject({ model: "gpt-5.6-sol", modelExplicit: true });
    expect(created[0]?.meta?.model).toBe("gpt-5.6-sol");
  });

  it("leaves a seeded default rescuable", async () => {
    await analyzeDataset(tenant, { prompt: "Who spends most?", csv: CSV, model: "deepseek-v4-flash" });
    expect(asked[0]?.modelExplicit).toBe(false);
  });
});
