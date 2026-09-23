import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatModel, TenantContext } from "@agentforge/core";
import type { WorkCard } from "./work-cards";

/**
 * The gateway call, the artifact store and the Knowledge Base write are the edges of a Documents
 * job. They are mocked at the module boundary, so everything between them (reading the body, the
 * pin, what gets recorded) is the real code. `readModelPinned` stays real.
 */
type Asked = Record<string, unknown>;
const asked: Asked[] = [];
const created: Array<{ meta?: Record<string, unknown> }> = [];
const ingested: WorkCard[] = [];
let answer = { text: "", model: "" };

vi.mock("./job-regen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./job-regen")>();
  return {
    ...actual,
    collectJobAssistantText: async (options: Asked) => {
      asked.push(options);
      return answer.text;
    },
    collectJobAssistantRun: async (options: Asked) => {
      asked.push(options);
      return answer.model === options.model
        ? { text: answer.text, model: answer.model }
        : {
            text: answer.text,
            model: answer.model,
            notice: { code: "model_fallback", from: options.model, to: answer.model },
          };
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
  (id): ChatModel => ({ id, label: id, provider: "openai", inputModalities: ["text", "image"] }) as ChatModel,
);

vi.mock("./selectable-models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./selectable-models")>();
  return {
    ...actual,
    listSelectableModels: () => CATALOG,
    modeCatalogPayload: () => ({ defaults: { documents: "deepseek-v4-flash", finance: "deepseek-v4-flash" } }),
  };
});

const { documentJobSystemPrompt, generateDocumentDraft, isFinanceJob, regenerateDocumentSection } = await import(
  "./document-generate"
);

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws-documents-model",
  userId: "local",
  role: "owner",
};

const DRAFT = {
  title: "Vendor switch memo",
  sections: [
    { heading: "What changes on Monday", body: "The new vendor takes over billing." },
    { heading: "What I need from you", body: "Approve the contract by Friday." },
  ],
};

describe("finance document prompt", () => {
  it("flags job=finance and never invents figures", () => {
    expect(isFinanceJob({ job: "finance", prompt: "breakeven" })).toBe(true);
    expect(isFinanceJob({ prompt: "breakeven" })).toBe(false);
    const prompt = documentJobSystemPrompt(true, "en");
    expect(prompt).toMatch(/Never invent numbers/i);
    expect(prompt).toMatch(/Use only figures the user pasted/i);
    expect(documentJobSystemPrompt(false, "en")).not.toMatch(/Never invent numbers/i);
    expect(documentJobSystemPrompt(false, "id")).toMatch(/Bahasa Indonesia/);
    expect(documentJobSystemPrompt(true, "id")).toMatch(/Bahasa Indonesia/);
  });
});

describe("the model a Documents job uses and records", () => {
  beforeEach(() => {
    asked.length = 0;
    created.length = 0;
    ingested.length = 0;
    answer = { text: JSON.stringify(DRAFT), model: "deepseek-v4-flash" };
    vi.stubEnv("AGENTFORGE_RUNTIME", "ai");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records the model that answered, not the one requested, when a stand-in wrote the draft", async () => {
    answer = { text: JSON.stringify(DRAFT), model: "gpt-5.6-luna" };
    const draft = await generateDocumentDraft(tenant, { prompt: "Write the vendor memo", model: "deepseek-v4-flash" });
    expect(draft.title).toBe("Vendor switch memo");
    expect(asked[0]?.model).toBe("deepseek-v4-flash");
    expect(created[0]?.meta?.model).toBe("gpt-5.6-luna");
    expect(ingested[0]?.model).toBe("gpt-5.6-luna");
  });

  it("records the requested model when it answered itself", async () => {
    await generateDocumentDraft(tenant, { prompt: "Write the vendor memo", model: "deepseek-v4-flash" });
    expect(created[0]?.meta?.model).toBe("deepseek-v4-flash");
    expect(ingested[0]?.model).toBe("deepseek-v4-flash");
  });

  it("hands a pinned pick to the job run as modelExplicit, so the fallback never swaps it", async () => {
    answer = { text: JSON.stringify(DRAFT), model: "gpt-5.6-sol" };
    await generateDocumentDraft(tenant, { prompt: "Write the vendor memo", model: "gpt-5.6-sol", modelPinned: true });
    expect(asked[0]).toMatchObject({ model: "gpt-5.6-sol", modelExplicit: true });
  });

  it("leaves a seeded default rescuable: no pin, no modelExplicit", async () => {
    await generateDocumentDraft(tenant, { prompt: "Write the vendor memo", model: "deepseek-v4-flash" });
    expect(asked[0]?.modelExplicit).toBe(false);
  });

  it("passes the pin on a section rewrite too", async () => {
    answer = { text: JSON.stringify(DRAFT.sections[0]), model: "gpt-5.6-sol" };
    await regenerateDocumentSection(tenant, {
      draft: DRAFT,
      sectionIndex: 0,
      prompt: "Write the vendor memo",
      model: "gpt-5.6-sol",
      modelPinned: true,
    });
    expect(asked[0]).toMatchObject({ model: "gpt-5.6-sol", modelExplicit: true });
  });

  it("leaves an unpinned section rewrite rescuable", async () => {
    answer = { text: JSON.stringify(DRAFT.sections[0]), model: "deepseek-v4-flash" };
    await regenerateDocumentSection(tenant, { draft: DRAFT, sectionIndex: 0, model: "deepseek-v4-flash" });
    expect(asked[0]?.modelExplicit).toBe(false);
  });
});
