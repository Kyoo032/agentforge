import { describe, expect, it } from "vitest";
import { outputLanguageRule } from "../output-language";
import { dropSourceIds, groundKnowledgeMap, knowledgeMissBlock } from "./harness";
import type { KnowledgeMap } from "./rag";

const MODELS = {
  embeddingModel: "text-embedding-3-small",
  brainModel: "gpt-5.6-luna",
  verifierModel: "deepseek-v4-flash",
};

function map(overrides: Partial<KnowledgeMap> = {}): KnowledgeMap {
  return {
    overview: "Desk",
    topics: [
      {
        title: "Vendors",
        summary: "Top spend",
        sourceIds: ["kept", "gone"],
        verdict: "supported",
        note: "ok",
      },
      {
        title: "Only gone",
        summary: "Invented",
        sourceIds: ["gone"],
        verdict: "supported",
        note: "",
      },
    ],
    gaps: [],
    ready: true,
    source: "live",
    ...MODELS,
    createdAt: 1,
    ...overrides,
  };
}

describe("knowledge harness checks", () => {
  it("says a miss in the desk language", () => {
    const en = knowledgeMissBlock("en");
    const id = knowledgeMissBlock("id");
    expect(en).toContain("No saved source matched this question.");
    expect(en).toContain(outputLanguageRule("knowledge", "en"));
    expect(id).toContain("Tidak ada sumber tersimpan");
    expect(id).toContain(outputLanguageRule("knowledge", "id"));
    expect(en).not.toContain("Tidak ada sumber");
  });

  it("drops a deleted source and the topic that only cited it", () => {
    const next = dropSourceIds(map(), new Set(["gone"]));
    expect(next.topics).toHaveLength(1);
    expect(next.topics[0]?.sourceIds).toEqual(["kept"]);
    expect(next.topics[0]?.title).toBe("Vendors");
    expect(next.ready).toBe(true);
    const unchanged = map();
    expect(dropSourceIds(unchanged, new Set())).toBe(unchanged);
  });

  it("grounds a map to indexed ids and clears ready when nothing supported remains", () => {
    const next = groundKnowledgeMap(map(), new Set(["kept"]));
    expect(next.topics.map((topic) => topic.title)).toEqual(["Vendors"]);
    expect(next.topics[0]?.sourceIds).toEqual(["kept"]);
    const empty = groundKnowledgeMap(map(), new Set());
    expect(empty.topics).toEqual([]);
    expect(empty.ready).toBe(false);
  });

  it("drops a topic that cites no source", () => {
    const bare = map({
      topics: [{ title: "Loose", summary: "", sourceIds: [], verdict: "weak", note: "" }],
      ready: false,
    });
    const next = groundKnowledgeMap(bare, new Set(["kept"]));
    expect(next.topics).toEqual([]);
    expect(next.ready).toBe(false);
  });
});
