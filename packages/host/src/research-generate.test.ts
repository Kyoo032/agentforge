import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatModel, TenantContext } from "@agentforge/core";
import type { Dossier } from "@agentforge/core/artifacts";
import type { WorkCard } from "./work-cards";

/**
 * A Research job makes several model calls through one `ask`. The dossier loop, the gateway
 * call, the artifact store and the Knowledge Base write are mocked at
 * the module boundary; the pin and what gets recorded are the real code.
 */
type Asked = Record<string, unknown>;
const asked: Asked[] = [];
const created: Array<{ body?: string; meta?: Record<string, unknown> }> = [];
const ingested: WorkCard[] = [];
/** The model that answers each successive call; the last entry repeats. */
let answers: string[] = [];

vi.mock("@agentforge/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentforge/core")>();
  return { ...actual, listToolRoutes: () => ({ web: { ready: true } }) };
});

vi.mock("./register-tools", () => ({ ensureToolsRegistered: () => {} }));

vi.mock("./research-dossier", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./research-dossier")>();
  return {
    ...actual,
    runResearchDossier: async (
      input: { question: string; models: string[] },
      deps: { ask: (system: string, prompt: string) => Promise<string> },
    ) => {
      await deps.ask("plan the queries", input.question);
      await deps.ask("write the dossier", input.question);
      const dossier: Dossier = {
        title: "Vendor landscape",
        question: input.question,
        created: "2026-09-23T00:00:00.000Z",
        models: input.models,
        queries: [],
        sources: [],
        findings: [],
        contradictions: [],
        openQuestions: [],
      };
      return { dossier, notes: { title: "Vendor landscape", summary: "", sections: [], sources: [] } };
    },
  };
});

vi.mock("./job-regen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./job-regen")>();
  const answer = (options: Asked) => {
    const index = asked.length;
    asked.push(options);
    return answers[Math.min(index, answers.length - 1)] ?? String(options.model);
  };
  return {
    ...actual,
    collectJobAssistantText: async (options: Asked) => {
      answer(options);
      return "{}";
    },
    collectJobAssistantRun: async (options: Asked) => ({ text: "{}", model: answer(options) }),
  };
});

vi.mock("./artifacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./artifacts")>();
  return {
    ...actual,
    artifactStore: () => ({
      create: (_tenant: TenantContext, input: { body?: string; meta?: Record<string, unknown> }) => {
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
    modeCatalogPayload: () => ({ defaults: { research: "deepseek-v4-flash" } }),
  };
});

const { generateResearchNotes } = await import("./research-generate");

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws-research-model",
  userId: "local",
  role: "owner",
};

describe("the model a Research job uses and records", () => {
  beforeEach(() => {
    asked.length = 0;
    created.length = 0;
    ingested.length = 0;
    answers = [];
    vi.stubEnv("AGENTFORGE_RUNTIME", "ai");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hands a pinned pick to every call of the run as modelExplicit", async () => {
    await generateResearchNotes(tenant, {
      prompt: "Who sells vendor billing?",
      model: "gpt-5.6-sol",
      modelPinned: true,
    });
    expect(asked).toHaveLength(2);
    for (const options of asked) {
      expect(options).toMatchObject({ model: "gpt-5.6-sol", modelExplicit: true });
    }
  });

  it("leaves a seeded default rescuable", async () => {
    await generateResearchNotes(tenant, { prompt: "Who sells vendor billing?", model: "deepseek-v4-flash" });
    expect(asked.map((options) => options.modelExplicit)).toEqual([false, false]);
  });

  it("records the models that answered, and the one that wrote the dossier, after a mid-run fallback", async () => {
    answers = ["deepseek-v4-flash", "gpt-5.6-luna"];
    const result = await generateResearchNotes(tenant, {
      prompt: "Who sells vendor billing?",
      model: "deepseek-v4-flash",
    });
    expect(created[0]?.meta?.model).toBe("gpt-5.6-luna");
    expect(created[0]?.meta?.models).toEqual(["deepseek-v4-flash", "gpt-5.6-luna"]);
    expect(ingested[0]?.model).toBe("gpt-5.6-luna");
    // The dossier's own front matter names who wrote it, not who was asked.
    expect(result.dossier.markdown).toContain('models: ["deepseek-v4-flash", "gpt-5.6-luna"]');
  });

  it("records the requested model when it answered every call itself", async () => {
    const result = await generateResearchNotes(tenant, {
      prompt: "Who sells vendor billing?",
      model: "deepseek-v4-flash",
    });
    expect(created[0]?.meta?.model).toBe("deepseek-v4-flash");
    expect(created[0]?.meta?.models).toEqual(["deepseek-v4-flash"]);
    expect(result.dossier.markdown).toContain('models: ["deepseek-v4-flash"]');
  });
});
