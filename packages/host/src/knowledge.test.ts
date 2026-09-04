import { describe, expect, it } from "vitest";
import { chunkKnowledgeText, knowledgeFtsQuery } from "./knowledge-text";

describe("knowledge retrieve helpers", () => {
  it("builds an FTS query from meaningful words", () => {
    expect(knowledgeFtsQuery("a to of vendor concentration risk")).toBe("vendor OR concentration OR risk");
    expect(knowledgeFtsQuery("  ")).toBe("");
  });

  it("chunks long source text", () => {
    const chunks = chunkKnowledgeText("abcdef", 2);
    expect(chunks).toEqual(["ab", "cd", "ef"]);
    expect(chunkKnowledgeText("   ")).toEqual([]);
  });
});
