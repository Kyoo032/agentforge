import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  parseEmbeddingResponse,
  parseKnowledgeMap,
  stubEmbed,
  stubKnowledgeMap,
} from "./rag";

describe("knowledge rag", () => {
  it("ranks a matching stub vector above an unrelated one", () => {
    const query = stubEmbed("vendor concentration risk");
    const hit = cosineSimilarity(query, stubEmbed("vendor concentration in the spend table"));
    const miss = cosineSimilarity(query, stubEmbed("a recipe for tomato soup"));
    expect(hit).toBeGreaterThan(miss);
  });

  it("parses OpenAI-style embedding payloads", () => {
    expect(parseEmbeddingResponse({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3] }] })).toEqual([
      [0.1, 0.2],
      [0.3],
    ]);
    expect(parseEmbeddingResponse({})).toEqual([]);
  });

  it("parses a brain/verifier map and ignores fences", () => {
    const map = parseKnowledgeMap(
      '```json\n{"overview":"Desk","topics":[{"title":"Vendors","summary":"Top spend","sourceIds":["s1"],"verdict":"supported","note":"ok"}],"gaps":["dates"],"ready":true}\n```',
      { embeddingModel: "text-embedding-3-small", brainModel: "gpt-5.6-luna", verifierModel: "deepseek-v4-flash" },
      "live",
    );
    expect(map?.topics[0]?.title).toBe("Vendors");
    expect(map?.topics[0]?.verdict).toBe("supported");
    expect(map?.ready).toBe(true);
  });

  it("builds a stub map from sources", () => {
    const map = stubKnowledgeMap([{ id: "s1", name: "Notes" }], {
      embeddingModel: "text-embedding-3-small",
      brainModel: "gpt-5.6-luna",
      verifierModel: "gpt-5.6-luna",
    });
    expect(map.source).toBe("stub");
    expect(map.topics[0]?.title).toBe("Notes");
    expect(map.ready).toBe(true);
  });
});
