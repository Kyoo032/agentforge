import { describe, expect, it } from "vitest";
import { chunkKnowledgeText, knowledgeFtsQuery } from "./knowledge-text";

// The MATCH expression builder is proved against a real FTS5 table in knowledge-text.test.ts,
// injection payloads included; this keeps only the shape the retrieve path depends on.
describe("knowledge retrieve helpers", () => {
  it("builds an FTS query from meaningful words", () => {
    expect(knowledgeFtsQuery("a to of vendor concentration risk")).toBe('"vendor" OR "concentration" OR "risk"');
    expect(knowledgeFtsQuery("  ")).toBe("");
  });

  it("chunks long source text", () => {
    // Boundary and overlap rules live in knowledge-chunk.test.ts; this pins the plain stride.
    const chunks = chunkKnowledgeText("abcdef", 2, 0);
    expect(chunks).toEqual(["ab", "cd", "ef"]);
    expect(chunkKnowledgeText("   ")).toEqual([]);
  });
});
