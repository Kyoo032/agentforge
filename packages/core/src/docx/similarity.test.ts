import { describe, expect, it } from "vitest";
import { WORD_DIFF_CAP, diceSimilarity, wordDiff, words } from "./similarity";

describe("words", () => {
  it("splits on any whitespace and drops empties", () => {
    expect(words("  a\tb\n\nc  ")).toEqual(["a", "b", "c"]);
    expect(words("")).toEqual([]);
  });
});

describe("diceSimilarity", () => {
  it("is 1 for identical sequences and 0 for disjoint ones", () => {
    expect(diceSimilarity(["the", "bank", "shall", "pay"], ["the", "bank", "shall", "pay"])).toBe(1);
    expect(diceSimilarity(["the", "bank", "shall", "pay"], ["no", "overlap", "at", "all"])).toBe(0);
  });

  it("falls back to equality when a side has fewer than two words", () => {
    expect(diceSimilarity(["one"], ["one"])).toBe(1);
    expect(diceSimilarity(["one"], ["two"])).toBe(0);
    expect(diceSimilarity([], [])).toBe(1);
  });

  it("scores partial overlap between 0 and 1", () => {
    const score = diceSimilarity("the bank shall pay the fee".split(" "), "the bank shall pay the charge".split(" "));
    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThan(1);
  });
});

describe("wordDiff", () => {
  it("returns a single equal edit for identical text", () => {
    expect(wordDiff(["a", "b"], ["a", "b"])).toEqual([{ kind: "equal", text: "a b" }]);
  });

  it("emits merged insert and delete runs", () => {
    expect(wordDiff("the bank shall pay the fee".split(" "), "the bank must pay the fee promptly".split(" "))).toEqual([
      { kind: "equal", text: "the bank" },
      { kind: "delete", text: "shall" },
      { kind: "insert", text: "must" },
      { kind: "equal", text: "pay the fee" },
      { kind: "insert", text: "promptly" },
    ]);
  });

  it("handles empty sides", () => {
    expect(wordDiff([], ["x"])).toEqual([{ kind: "insert", text: "x" }]);
    expect(wordDiff(["x"], [])).toEqual([{ kind: "delete", text: "x" }]);
    expect(wordDiff([], [])).toEqual([]);
  });

  it("falls back to delete plus insert above the word cap", () => {
    const big = Array.from({ length: WORD_DIFF_CAP + 1 }, (_, index) => `w${index}`);
    const edits = wordDiff(big, [...big.slice(1), "tail"]);
    expect(edits.map((edit) => edit.kind)).toEqual(["delete", "insert"]);
  });
});
