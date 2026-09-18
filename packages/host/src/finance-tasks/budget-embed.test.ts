import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@agentforge/core";
import type { BudgetSideLine } from "@agentforge/core/finance";
import { STUB_EMBED_MODEL } from "../knowledge-embed";
import {
  BUDGET_EMBED_LABEL_CHARS,
  BUDGET_EMBED_LABEL_MAX,
  budgetEmbedLabels,
  budgetEmbedWorthwhile,
  embedBudgetLabels,
} from "./budget-embed";

const TENANT = { organizationId: "org", workspaceId: "ws", userId: "local", role: "owner" } as TenantContext;

function line(label: string, amount = 1): BudgetSideLine {
  return { label, kind: "cost", category: "opex", amounts: [{ period: "Anggaran 2024", on: "2024", amount }] };
}

const MODELS = () => ({ embeddingModel: "text-embedding-3-small" });

/** A fake embedder: one axis per label, so cosine is 1 with itself and 0 with anything else. */
function fakeEmbedder(model = "text-embedding-3-small") {
  return vi.fn(async (texts: string[]) => ({
    vectors: texts.map((_text, at) => texts.map((_other, other) => (at === other ? 1 : 0))),
    model,
  }));
}

describe("what the embedding stage is allowed to send", () => {
  it("sends the labels and nothing else — no amount, no period, no tag", async () => {
    const embed = fakeEmbedder();
    await embedBudgetLabels(TENANT, [line("Sewa kantor", 240_000_000)], [line("Biaya sewa gedung", 264_000_000)], {
      embed,
      models: MODELS,
    });
    const sent = JSON.stringify(embed.mock.calls[0]?.[0] ?? []);
    expect(sent).toBe(JSON.stringify(["Sewa kantor", "Biaya sewa gedung"]));
    expect(sent).not.toMatch(/240000000|264000000|2024/);
  });

  it("de-duplicates and truncates, and asks the embedder exactly once", async () => {
    const embed = fakeEmbedder();
    const long = `Beban ${"a".repeat(400)}`;
    await embedBudgetLabels(TENANT, [line("Sewa kantor"), line(long)], [line("Sewa kantor")], {
      embed,
      models: MODELS,
    });
    const sent = embed.mock.calls[0]?.[0] ?? [];
    expect(embed).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toHaveLength(BUDGET_EMBED_LABEL_CHARS);
  });

  it("stays local rather than embedding a sheet with more labels than the cap", async () => {
    const embed = fakeEmbedder();
    const many = Array.from({ length: BUDGET_EMBED_LABEL_MAX + 1 }, (_entry, at) => line(`Beban ${at}`));
    const answer = await embedBudgetLabels(TENANT, many, [line("Beban lain")], { embed, models: MODELS });
    expect(answer.status).toBe("unavailable");
    expect(embed).not.toHaveBeenCalled();
  });
});

describe("when the embedding stage answers and when it does not", () => {
  it("hands back a cosine between the labels it embedded", async () => {
    const answer = await embedBudgetLabels(TENANT, [line("Sewa kantor")], [line("Biaya sewa gedung")], {
      embed: fakeEmbedder(),
      models: MODELS,
    });
    expect(answer.status).toBe("used");
    expect(answer.similarity?.("Sewa kantor", "Sewa kantor")).toBeCloseTo(1, 6);
    expect(answer.similarity?.("Sewa kantor", "Biaya sewa gedung")).toBeCloseTo(0, 6);
    // A label nobody embedded is not a zero — it is "no reading at all".
    expect(Number.isNaN(answer.similarity?.("Sewa kantor", "Beban lain") ?? 0)).toBe(true);
  });

  it("treats a stub vector as no answer, because its cosine measures spelling and not meaning", async () => {
    const answer = await embedBudgetLabels(TENANT, [line("Sewa kantor")], [line("Biaya sewa gedung")], {
      embed: fakeEmbedder(STUB_EMBED_MODEL),
      models: MODELS,
    });
    expect(answer.status).toBe("unavailable");
    expect(answer.similarity).toBeUndefined();
  });

  it("reports unavailable rather than throwing when the embedder fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const answer = await embedBudgetLabels(TENANT, [line("Sewa kantor")], [line("Biaya sewa gedung")], {
      embed: async () => {
        throw new Error("embeddings 503");
      },
      models: MODELS,
    });
    expect(answer.status).toBe("unavailable");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reports unavailable when the answer is not one vector per label", async () => {
    const answer = await embedBudgetLabels(TENANT, [line("Sewa kantor")], [line("Biaya sewa gedung")], {
      embed: async () => ({ vectors: [[1, 0]], model: "text-embedding-3-small" }),
      models: MODELS,
    });
    expect(answer.status).toBe("unavailable");
  });
});

describe("whether the call is worth making at all", () => {
  it("is worth it only when both sides still hold something unmatched", () => {
    expect(budgetEmbedWorthwhile({ budgetOnly: ["a"], actualOnly: ["b"] })).toBe(true);
    expect(budgetEmbedWorthwhile({ budgetOnly: [], actualOnly: ["b"] })).toBe(false);
    expect(budgetEmbedWorthwhile({ budgetOnly: ["a"], actualOnly: [] })).toBe(false);
  });

  it("builds the payload from labels alone", () => {
    expect(budgetEmbedLabels([line("  Sewa kantor  ")], [line("Sewa kantor")])).toEqual(["Sewa kantor"]);
    expect(budgetEmbedLabels([line("   ")], [])).toEqual([]);
  });
});
