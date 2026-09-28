import { draftOpenSlideDeck, type OpenSlideDeck } from "@agentforge/core/open-slide";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatModel, TenantContext } from "@agentforge/core";

type Asked = Record<string, unknown>;
const asked: Asked[] = [];
const answers: string[] = [];

vi.mock("./job-regen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./job-regen")>();
  return {
    ...actual,
    collectJobAssistantRun: async (options: Asked) => {
      asked.push(options);
      return { text: answers.shift() ?? "", model: "deepseek-v4-flash" };
    },
  };
});

vi.mock("./artifacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./artifacts")>();
  return {
    ...actual,
    artifactStore: () => ({
      create: () => ({ id: "artifact-1" }),
    }),
  };
});

vi.mock("./knowledge-ingest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./knowledge-ingest")>();
  return {
    ...actual,
    upsertWorkSource: async () => ({ status: "skipped" as const, reason: "test" }),
  };
});

const CATALOG = ["deepseek-v4-flash"].map(
  (id): ChatModel => ({ id, label: id, provider: "openai", inputModalities: ["text"] }) as ChatModel,
);

vi.mock("./selectable-models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./selectable-models")>();
  return {
    ...actual,
    listSelectableModels: () => CATALOG,
    modeCatalogPayload: () => ({ defaults: { presentations: "deepseek-v4-flash" } }),
  };
});

const { generateOpenSlideDeck } = await import("./open-slide-generate");

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws-open-slide-harness",
  userId: "local",
  role: "owner",
};

function deckText(pages?: number): string {
  const full = draftOpenSlideDeck({
    prompt: "Saturday pickup",
    pageCount: "short",
    density: "light",
    locale: "en",
  });
  const trimmed: OpenSlideDeck = pages ? { ...full, pages: full.pages.slice(0, pages) } : full;
  return JSON.stringify(trimmed);
}

describe("open slide length retry", () => {
  beforeEach(() => {
    asked.length = 0;
    answers.length = 0;
    vi.stubEnv("AGENTFORGE_RUNTIME", "ai");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks once more when the deck is shorter than the length chip", async () => {
    answers.push(deckText(2), deckText());
    const deck = await generateOpenSlideDeck(tenant, {
      prompt: "Saturday pickup",
      brief: { pageCount: "short", density: "light", motion: "static" },
    });
    expect(deck.pages).toHaveLength(4);
    expect(asked).toHaveLength(2);
    expect(String(asked[1]?.prompt)).toMatch(/at least 3/);
  });

  it("does not ask a third time when the deck is still short", async () => {
    answers.push(deckText(2), deckText(2));
    const deck = await generateOpenSlideDeck(tenant, {
      prompt: "Saturday pickup",
      brief: { pageCount: "short" },
    });
    expect(deck.pages).toHaveLength(2);
    expect(asked).toHaveLength(2);
  });

  it("does not retry a deck that already fits", async () => {
    answers.push(deckText());
    const deck = await generateOpenSlideDeck(tenant, {
      prompt: "Saturday pickup",
      brief: { pageCount: "short" },
    });
    expect(deck.pages).toHaveLength(4);
    expect(asked).toHaveLength(1);
  });
});
