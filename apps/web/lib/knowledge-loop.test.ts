import { describe, expect, it } from "vitest";
import { barFraction, countSourcesByType, isWorkSourceType, summarizeLoop } from "./knowledge-loop";

const sources = [
  { type: "Paste", status: "Indexed" as const, chunks: 2 },
  { type: "Videos", status: "Indexed" as const, chunks: 1 },
  { type: "Chat", status: "Indexed" as const, chunks: 1 },
  { type: "Chat", status: "Failed" as const, chunks: 0 },
  { type: "URL", status: "Indexed" as const, chunks: 9 },
  { type: "URL", status: "Indexed" as const, chunks: 3 },
  { type: "File", status: "Failed" as const, chunks: 0 },
];

describe("knowledge loop counts", () => {
  it("groups by type with work types first in rail order, then manual by count", () => {
    const counts = countSourcesByType(sources);
    expect(counts.map((row) => row.type)).toEqual(["Chat", "Videos", "URL", "File", "Paste"]);
    expect(counts[0]).toEqual({ type: "Chat", total: 2, indexed: 1, failed: 1, chunks: 1 });
    expect(counts[2]).toEqual({ type: "URL", total: 2, indexed: 2, failed: 0, chunks: 12 });
  });

  it("summarizes work vs manual and index health", () => {
    expect(summarizeLoop(sources)).toEqual({ work: 3, manual: 4, indexed: 5, failed: 2, chunks: 16 });
    expect(summarizeLoop([])).toEqual({ work: 0, manual: 0, indexed: 0, failed: 0, chunks: 0 });
  });

  it("knows which types the loop writes", () => {
    expect(isWorkSourceType("Chat")).toBe(true);
    expect(isWorkSourceType("Edit")).toBe(true);
    expect(isWorkSourceType("Paste")).toBe(false);
    expect(isWorkSourceType("Dossier")).toBe(false);
  });

  it("scales bars to the largest count and never above 1", () => {
    expect(barFraction(2, 4)).toBe(0.5);
    expect(barFraction(5, 4)).toBe(1);
    expect(barFraction(0, 4)).toBe(0);
    expect(barFraction(3, 0)).toBe(0);
  });
});
