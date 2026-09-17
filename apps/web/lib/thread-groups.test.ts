import { describe, expect, it } from "vitest";
import { RAIL_RECENT_THREADS, takeRecentThreads } from "./thread-groups";

describe("rail recent threads", () => {
  const threads = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }, { id: "f" }];

  it("keeps the collapsed rail to a few sessions", () => {
    expect(RAIL_RECENT_THREADS).toBe(4);
    expect(takeRecentThreads(threads).map((thread) => thread.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("returns a new array and leaves the source order alone", () => {
    const taken = takeRecentThreads(threads, 2);
    expect(taken).not.toBe(threads);
    expect(taken.map((thread) => thread.id)).toEqual(["a", "b"]);
    expect(threads.map((thread) => thread.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("returns everything when the list is shorter than the cap", () => {
    expect(takeRecentThreads([{ id: "a" }])).toHaveLength(1);
    expect(takeRecentThreads([])).toEqual([]);
  });

  it("yields nothing for a non-positive or broken count", () => {
    expect(takeRecentThreads(threads, 0)).toEqual([]);
    expect(takeRecentThreads(threads, -3)).toEqual([]);
    expect(takeRecentThreads(threads, Number.NaN)).toEqual([]);
  });
});
