import { describe, expect, it } from "vitest";
import { chunkKnowledgeText, knowledgeFtsQuery } from "./knowledge-text";

describe("knowledge retrieve helpers", () => {
  it("builds an FTS query from meaningful words", () => {
    expect(knowledgeFtsQuery("a to of vendor concentration risk")).toBe('"vendor" OR "concentration" OR "risk"');
    expect(knowledgeFtsQuery("  ")).toBe("");
  });

  it("quotes FTS5 keywords and operators so they stay literal", () => {
    expect(knowledgeFtsQuery('NEAR( AND col:x -foo ^bar "baz"')).toBe(
      '"NEAR(" OR "AND" OR "col:x" OR "-foo" OR "^bar" OR "baz"',
    );
  });

  it("chunks long source text", () => {
    // Boundary and overlap rules live in knowledge-chunk.test.ts; this pins the plain stride.
    const chunks = chunkKnowledgeText("abcdef", 2, 0);
    expect(chunks).toEqual(["ab", "cd", "ef"]);
    expect(chunkKnowledgeText("   ")).toEqual([]);
  });
});
