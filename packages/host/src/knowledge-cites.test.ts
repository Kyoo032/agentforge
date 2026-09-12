import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "./knowledge/backend";
import { citedSources, parseCiteMarkers } from "./knowledge-cites";

/**
 * Phase 4 of the knowledge loop: the `cites` edge. A reply's `[n]` markers are the model's own
 * statement of which offered sources it used; they map by position onto the chunks the run was
 * injected with (`knowledgeInjection` numbers them `[1] … [n]`). Fenced code is quoted text, not a
 * citation, so markers inside it are ignored.
 */

function chunk(sourceId: string, chunkIndex = 0): RetrievedChunk {
  return {
    body: `body ${chunkIndex} of ${sourceId}`,
    sourceId,
    sourceName: `name ${sourceId}`,
    score: 0.5,
    chunkIndex,
  };
}

describe("parseCiteMarkers", () => {
  it("reads [n] markers in first-use order and counts each number once", () => {
    expect(parseCiteMarkers("Concentration is high [2]. The memo agrees [1], and so does [2].")).toEqual([2, 1]);
  });

  it("ignores [n] inside fenced code and resumes after the fence closes", () => {
    const text = [
      "Cited [1] before the example.",
      "```ts",
      'const marker = "[2]"; // a literal, not a citation',
      "```",
      "Then [3] after the fence.",
    ].join("\n");
    expect(parseCiteMarkers(text)).toEqual([1, 3]);
  });

  it("ignores everything after an unterminated fence", () => {
    expect(parseCiteMarkers("A real citation [1].\n~~~\nquoted [2]\nstill quoted [3]")).toEqual([1]);
  });

  it("only counts a bare 1-based integer: [S1], [n], [1,2] and [0] are not markers", () => {
    expect(parseCiteMarkers("See [S1], [n], [1,2] and a placeholder [0].")).toEqual([]);
  });
});

describe("citedSources", () => {
  it("maps [n] to the source of the nth injected chunk, in citation order", () => {
    const chunks = [chunk("source-a"), chunk("source-b"), chunk("source-c")];
    expect(citedSources("First [3], then [1].", chunks)).toEqual(["source-c", "source-a"]);
  });

  it("drops markers past the last injected chunk", () => {
    const chunks = [chunk("source-a"), chunk("source-b")];
    expect(citedSources("Concentration [1] and something never injected [4].", chunks)).toEqual(["source-a"]);
  });

  it("counts a source once even when two of its chunks are cited", () => {
    const chunks = [chunk("source-a"), chunk("source-b"), chunk("source-a", 1)];
    expect(citedSources("[1][3][2]", chunks)).toEqual(["source-a", "source-b"]);
  });

  it("returns nothing for a reply that only quotes markers in a fence", () => {
    const chunks = [chunk("source-a")];
    expect(citedSources("Like this:\n```\n[1]\n```", chunks)).toEqual([]);
  });
});
