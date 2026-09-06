import { describe, expect, it } from "vitest";
import { estimateJobUsd } from "./price-table";

describe("estimateJobUsd", () => {
  const now = new Date("2026-09-06T00:00:00.000Z");

  it("estimates known rows", () => {
    expect(estimateJobUsd("grok-imagine-video", { seconds: 5 }, now)).toBeCloseTo(0.3);
    expect(estimateJobUsd("seedance-2.0-fast", { seconds: 2, resolution: "720p" }, now)).toBeCloseTo(0.6);
    expect(estimateJobUsd("seedance-2.0-fast", { seconds: 2, resolution: "1080p" }, now)).toBeCloseTo(1.2);
    expect(estimateJobUsd("gpt-image-2", { count: 2 }, now)).toBeCloseTo(0.08);
  });

  it("returns null for unknown models", () => {
    expect(estimateJobUsd("not-a-model", { seconds: 5 }, now)).toBeNull();
  });

  it("returns null when asOf is older than 90 days", () => {
    const staleNow = new Date("2027-01-01T00:00:00.000Z");
    expect(estimateJobUsd("grok-imagine-video", { seconds: 5 }, staleNow)).toBeNull();
  });
});
