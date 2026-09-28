import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatModel, TenantContext } from "@agentforge/core";
import type { WorkCard } from "./work-cards";

/**
 * Same boundary as `document-generate.test.ts`: the gateway call, the artifact store and the
 * Knowledge Base write are mocked; reading the body, the pin and what gets recorded are real.
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
      return { text: answer.text, model: answer.model };
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
    modeCatalogPayload: () => ({ defaults: { presentations: "deepseek-v4-flash" } }),
  };
});

const { generatePresentationOutline, regeneratePresentationSlide } = await import("./presentation-generate");

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws-presentations-model",
  userId: "local",
  role: "owner",
};

const OUTLINE = {
  title: "Vendor switch",
  slides: [
    { kind: "bullets", heading: "We switch on Monday", subhead: "", bullets: ["Billing moves"], aside: "", notes: "" },
    { kind: "close", heading: "Approve by Friday", subhead: "", bullets: [], aside: "", notes: "" },
  ],
};

describe("the model a Presentations job uses and records", () => {
  beforeEach(() => {
    asked.length = 0;
    created.length = 0;
    ingested.length = 0;
    answer = { text: JSON.stringify(OUTLINE), model: "deepseek-v4-flash" };
    vi.stubEnv("AGENTFORGE_RUNTIME", "ai");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records the model that answered, not the one requested, when a stand-in wrote the outline", async () => {
    answer = { text: JSON.stringify(OUTLINE), model: "gpt-5.6-luna" };
    const outline = await generatePresentationOutline(tenant, {
      prompt: "Vendor switch deck",
      model: "deepseek-v4-flash",
    });
    expect(outline.title).toBe("Vendor switch");
    expect(outline.slides[0]?.notes).toMatch(/Say this page once/);
    expect(created[0]?.meta?.model).toBe("gpt-5.6-luna");
    expect(ingested[0]?.model).toBe("gpt-5.6-luna");
  });

  it("hands a pinned pick to the job run as modelExplicit", async () => {
    await generatePresentationOutline(tenant, {
      prompt: "Vendor switch deck",
      model: "gpt-5.6-sol",
      modelPinned: true,
    });
    expect(asked[0]).toMatchObject({ model: "gpt-5.6-sol", modelExplicit: true });
  });

  it("leaves a seeded default rescuable", async () => {
    await generatePresentationOutline(tenant, { prompt: "Vendor switch deck", model: "deepseek-v4-flash" });
    expect(asked[0]?.modelExplicit).toBe(false);
  });

  it("asks once for a crowded slide and still returns the slide that fit", async () => {
    const crowded = {
      title: "Saturday pickup",
      slides: [
        {
          kind: "bullets",
          heading: "Named bags",
          subhead: "",
          bullets: ["One", "Two", "Three", "Four", "Five", "Six"],
          aside: "",
          notes: "Already noted.",
        },
        {
          kind: "close",
          heading: "Keep this close",
          subhead: "",
          bullets: [],
          aside: "",
          notes: "Stay.",
        },
      ],
    };
    answer = { text: JSON.stringify(crowded), model: "deepseek-v4-flash" };
    const outline = await generatePresentationOutline(tenant, { prompt: "Saturday pickup" });
    expect(asked).toHaveLength(2);
    expect(String(asked[1]?.prompt)).toContain("too_many_bullets");
    expect(String(asked[1]?.prompt)).not.toContain("Keep this close");
    expect(outline.slides[0]?.bullets.length).toBeLessThanOrEqual(5);
    expect(outline.slides[0]?.layout).toBe("split");
    expect(outline.slides[1]?.heading).toBe("Keep this close");
    expect(outline.slides[1]?.layout).toBe("section");
    expect(outline.title).toBe("Saturday pickup");
  });

  it("passes the pin on a slide rewrite too", async () => {
    answer = { text: JSON.stringify(OUTLINE.slides[0]), model: "gpt-5.6-sol" };
    await regeneratePresentationSlide(tenant, {
      outline: OUTLINE,
      slideIndex: 0,
      model: "gpt-5.6-sol",
      modelPinned: true,
    });
    expect(asked[0]).toMatchObject({ model: "gpt-5.6-sol", modelExplicit: true });
  });
});
