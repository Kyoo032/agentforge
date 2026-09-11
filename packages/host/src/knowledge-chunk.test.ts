import { describe, expect, it } from "vitest";
import { CHUNK_OVERLAP, CHUNK_TARGET, chunkKnowledgeText } from "./knowledge-text";

/**
 * The chunker decides what a citation can point at. A split inside a word or right after a page
 * marker costs the retrieved chunk its meaning, so the boundary rules are pinned here.
 */

const WORDS = "lorem ipsum ";

describe("chunkKnowledgeText", () => {
  it("returns one chunk for a text under the target", () => {
    const text = "A short note about the vendor concentration risk.";
    expect(chunkKnowledgeText(text)).toEqual([text]);
    expect(chunkKnowledgeText("   ")).toEqual([]);
  });

  it("never cuts inside a word when a boundary is in reach", () => {
    const text = WORDS.repeat(400);
    const chunks = chunkKnowledgeText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_TARGET);
    }
    for (const chunk of chunks.slice(0, -1)) {
      // Every split lands after a whole word, so the tail is one of the two words, never a prefix.
      expect(["lorem", "ipsum"]).toContain(chunk.trimEnd().split(/\s+/).pop());
    }
  });

  it("splits before a markdown heading and keeps the heading whole", () => {
    const text = `# Alpha\n${"alpha ".repeat(120)}\n\n## Beta heading\n${"beta ".repeat(200)}`;
    const chunks = chunkKnowledgeText(text);
    expect(chunks[0]).toContain("# Alpha");
    expect(chunks[0]).not.toContain("## Beta");
    const headingChunk = chunks.find((chunk) => chunk.includes("## Beta"));
    expect(headingChunk).toContain("## Beta heading\n");
  });

  it("overlaps consecutive chunks by exactly CHUNK_OVERLAP characters", () => {
    const chunks = chunkKnowledgeText(WORDS.repeat(400));
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i += 1) {
      const previous = chunks[i - 1] ?? "";
      const current = chunks[i] ?? "";
      expect(current.slice(0, CHUNK_OVERLAP)).toBe(previous.slice(-CHUNK_OVERLAP));
    }
  });

  it("keeps a page marker attached to the text that follows it", () => {
    const text = `${"a ".repeat(393)}<!-- page 2 -->\nBody after the marker.`;
    const chunks = chunkKnowledgeText(text);
    expect(chunks[0]).not.toContain("<!--");
    expect(chunks.some((chunk) => chunk.includes("<!-- page 2 -->\nBody after the marker."))).toBe(true);
  });

  it("keeps every page marker in the output", () => {
    const page = (n: number) => `<!-- page ${n} -->\n${`page ${n} body text. `.repeat(60)}`;
    const text = [1, 2, 3, 4].map(page).join("\n");
    const joined = chunkKnowledgeText(text).join("\n");
    for (const n of [1, 2, 3, 4]) {
      expect(joined).toContain(`<!-- page ${n} -->`);
    }
  });

  it("is deterministic", () => {
    const text = `# Title\n${WORDS.repeat(300)}\n\nSecond section. Third sentence here. ${WORDS.repeat(200)}`;
    expect(chunkKnowledgeText(text)).toEqual(chunkKnowledgeText(text));
  });

  it("honours an explicit size and overlap", () => {
    expect(chunkKnowledgeText("abcdef", 2, 0)).toEqual(["ab", "cd", "ef"]);
  });
});
