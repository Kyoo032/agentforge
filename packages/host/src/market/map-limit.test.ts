import { describe, expect, it } from "vitest";
import { mapLimit } from "./map-limit";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("mapLimit", () => {
  it("never runs more than `limit` tasks at once and keeps input order", async () => {
    const gates = [0, 1, 2, 3, 4].map(() => deferred<void>());
    let inFlight = 0;
    let peak = 0;
    const run = mapLimit([0, 1, 2, 3, 4], 2, async (index) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gates[index]?.promise;
      inFlight -= 1;
      return index * 10;
    });
    await Promise.resolve();
    expect(inFlight).toBe(2);
    for (const gate of gates) {
      gate.resolve();
    }
    const results = await run;
    expect(peak).toBe(2);
    expect(results).toEqual([
      { status: "fulfilled", value: 0 },
      { status: "fulfilled", value: 10 },
      { status: "fulfilled", value: 20 },
      { status: "fulfilled", value: 30 },
      { status: "fulfilled", value: 40 },
    ]);
  });

  it("records a rejection in place and keeps going", async () => {
    const results = await mapLimit(["a", "b", "c"], 4, async (item) => {
      if (item === "b") {
        throw new Error("boom");
      }
      return item.toUpperCase();
    });
    expect(results[0]).toEqual({ status: "fulfilled", value: "A" });
    expect(results[1]).toMatchObject({ status: "rejected", reason: new Error("boom") });
    expect(results[2]).toEqual({ status: "fulfilled", value: "C" });
  });

  it("handles an empty list and a non-positive limit", async () => {
    expect(await mapLimit([], 0, async () => 1)).toEqual([]);
    expect(await mapLimit([1], 0, async (n) => n + 1)).toEqual([{ status: "fulfilled", value: 2 }]);
  });
});
