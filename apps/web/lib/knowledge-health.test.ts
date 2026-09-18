import { describe, expect, it } from "vitest";
import { VERIFIED_STALE_MS, healthTiles, shouldShowByType, verifiedTone } from "./knowledge-health";
import { countSourcesByType } from "./knowledge-loop";

const NOW = 1_760_000_000_000;

const sources = [
  { type: "Paste", status: "Indexed" as const, chunks: 2 },
  { type: "Videos", status: "Indexed" as const, chunks: 1 },
  { type: "Chat", status: "Indexed" as const, chunks: 1 },
  { type: "Chat", status: "Failed" as const, chunks: 0 },
  { type: "URL", status: "Indexed" as const, chunks: 9 },
  { type: "URL", status: "Indexed" as const, chunks: 3 },
  { type: "File", status: "Failed" as const, chunks: 0 },
];

describe("healthTiles", () => {
  it("reads work, added-by-hand, indexed, and retrieved in that order", () => {
    const tiles = healthTiles({ sources, retrievals: 7 }, NOW);
    expect(tiles.map((tile) => tile.key)).toEqual(["work", "manual", "indexed", "retrieved", "failed"]);
    expect(tiles[0]?.value).toBe(3);
    expect(tiles[1]?.value).toBe(4);
    expect(tiles[2]?.value).toBe(5);
    expect(tiles[3]?.value).toBe(7);
  });

  it("keeps the saved total and the chunk count on their tiles", () => {
    const tiles = healthTiles({ sources, retrievals: 7 }, NOW);
    // "Added by hand 4" still carries Saved's 7 for the subline and for data-value.
    expect(tiles[1]?.sub).toBe(7);
    expect(tiles[1]?.stage).toBe("Saved");
    expect(tiles[1]?.stageValue).toBe(7);
    expect(tiles[2]?.sub).toBe(16);
  });

  it("carries the loop stage testid and state onto each tile", () => {
    const tiles = healthTiles({ sources: [], retrievals: 0 }, NOW);
    expect(tiles.map((tile) => tile.stage)).toEqual(["Work", "Saved", "Indexed", "Retrieved"]);
    expect(tiles[3]?.stageState).toBe("idle");
  });

  it("hides the Failed tile on a healthy desk and shows it in danger when something broke", () => {
    const healthy = healthTiles({ sources: [{ type: "Chat", status: "Indexed", chunks: 1 }] }, NOW);
    expect(healthy.map((tile) => tile.key)).not.toContain("failed");
    const broken = healthTiles({ sources }, NOW);
    const failed = broken.find((tile) => tile.key === "failed");
    expect(failed?.value).toBe(2);
    expect(failed?.danger).toBe(true);
    expect(failed?.stage).toBeNull();
  });

  it("degrades to zeroes when the host reports nothing", () => {
    const tiles = healthTiles({ sources: [] }, NOW);
    expect(tiles.map((tile) => tile.value)).toEqual([0, 0, 0, 0]);
    expect(healthTiles({ sources: [], retrievals: Number.NaN, graph: null, verified: null }, NOW)[3]?.value).toBe(0);
  });
});

describe("verifiedTone", () => {
  it("is green only for a recent pass", () => {
    expect(verifiedTone({ ok: true, at: NOW - 60_000, detail: "" }, NOW)).toBe("pass");
    expect(verifiedTone({ ok: true, at: NOW - VERIFIED_STALE_MS - 1, detail: "" }, NOW)).toBe("stale");
  });

  it("is red for a fail and amber for never or unknown", () => {
    expect(verifiedTone({ ok: false, at: NOW, detail: "plant not retrieved" }, NOW)).toBe("fail");
    expect(verifiedTone(null, NOW)).toBe("never");
    expect(verifiedTone(undefined, NOW)).toBe("never");
    expect(verifiedTone({ ok: true, at: 0, detail: "" }, NOW)).toBe("stale");
    expect(verifiedTone({ ok: true, at: Number.NaN, detail: "" }, NOW)).toBe("stale");
  });
});

describe("shouldShowByType", () => {
  it("stays off until there is a mix worth naming", () => {
    expect(shouldShowByType(countSourcesByType(sources))).toBe(true);
    expect(shouldShowByType(countSourcesByType([{ type: "Chat", status: "Indexed", chunks: 1 }]))).toBe(false);
    expect(shouldShowByType([])).toBe(false);
  });
});
