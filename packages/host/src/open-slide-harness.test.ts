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

  it("asks once for a crowded page and does not ask for the pages that fit", async () => {
    const full = JSON.parse(deckText()) as OpenSlideDeck;
    const crowded = {
      ...full,
      pages: full.pages.map((page, index) =>
        index === 1
          ? {
              ...page,
              blocks: [
                ...page.blocks,
                ...["one", "two", "three", "four", "five", "six"].map((word, bullet) => ({
                  id: `extra-${bullet}`,
                  kind: "text" as const,
                  x: 120,
                  y: 400 + bullet * 40,
                  w: 800,
                  h: 36,
                  text: word,
                  fontSize: 28,
                  weight: 400 as const,
                  align: "left" as const,
                  tone: "text" as const,
                })),
              ],
            }
          : page,
      ),
    };
    answers.push(JSON.stringify(crowded), JSON.stringify(crowded));
    const deck = await generateOpenSlideDeck(tenant, {
      prompt: "Saturday pickup",
      brief: { pageCount: "short", density: "light" },
    });
    expect(asked).toHaveLength(2);
    const retry = String(asked[1]?.prompt);
    expect(retry).toContain("too_many_bullets");
    expect(retry).toContain(full.pages[1]?.id);
    expect(retry).not.toContain(full.pages[2]?.id ?? "missing-page");
    expect(deck.pages).toHaveLength(full.pages.length);
    const layouts = new Set(["title", "section", "split", "quote", "figure"]);
    expect(deck.pages.every((page) => page.layout && layouts.has(page.layout))).toBe(true);
    const repaired = deck.pages[1];
    const texts = repaired?.blocks.filter((block) => block.kind === "text" && block.fontSize < 40) ?? [];
    expect(texts.length).toBeLessThanOrEqual(5);
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
