import { describe, expect, it } from "vitest";
import { trimLeadingEmptyBuckets } from "@/components/usage-range-chart";

describe("trimLeadingEmptyBuckets", () => {
  it("drops empty leading days but keeps a minimum window", () => {
    const buckets = [
      { usd: 0, models: [] },
      { usd: 0, models: [] },
      { usd: 0.09, models: [{ model: "gpt-5.6-sol" }] },
      { usd: 0, models: [] },
    ];
    expect(trimLeadingEmptyBuckets(buckets, 3)).toEqual([
      { usd: 0, models: [] },
      { usd: 0.09, models: [{ model: "gpt-5.6-sol" }] },
      { usd: 0, models: [] },
    ]);
  });
});
