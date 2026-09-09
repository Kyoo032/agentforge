import { describe, expect, it } from "vitest";
import { INSUFFICIENT_AGE_MULTIPLIER, TTL_SECONDS, computeStaleness, isInsufficient } from "./staleness";

const AS_OF = "2026-09-09T10:00:00Z";
const HOUR = 3600;

function plusSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

describe("TTL_SECONDS", () => {
  it("keeps the v1 keys and adds the v2 watch kinds (quote 5 m, technical 15 m, history 6 h, macro 5 m)", () => {
    expect(TTL_SECONDS).toEqual({
      prices: 36 * HOUR,
      technicals: 6 * HOUR,
      fundamentals: 30 * 86400,
      analysts: 30 * 86400,
      news: 90 * 86400,
      quote: 300,
      technical: 900,
      history: 6 * HOUR,
      macro: 300,
    });
  });
});

describe("computeStaleness", () => {
  it("is fresh at zero age", () => {
    expect(computeStaleness(AS_OF, AS_OF, HOUR)).toEqual({ asOf: AS_OF, maxAgeSeconds: HOUR, isStale: false });
  });

  it("is not stale exactly at max age", () => {
    expect(computeStaleness(AS_OF, plusSeconds(AS_OF, HOUR), HOUR).isStale).toBe(false);
  });

  it("is stale one second beyond max age", () => {
    expect(computeStaleness(AS_OF, plusSeconds(AS_OF, HOUR + 1), HOUR).isStale).toBe(true);
  });

  it("accepts offsets and keeps the asOf string as given", () => {
    const withOffset = "2026-09-09T17:00:00+07:00";
    const result = computeStaleness(withOffset, AS_OF, HOUR);
    expect(result.asOf).toBe(withOffset);
    expect(result.isStale).toBe(false);
  });

  it("throws on unparsable dates", () => {
    expect(() => computeStaleness("yesterday", AS_OF, HOUR)).toThrow(/asOf/);
    expect(() => computeStaleness(AS_OF, "", HOUR)).toThrow(/now/);
  });

  it("throws on a non-positive max age", () => {
    expect(() => computeStaleness(AS_OF, AS_OF, 0)).toThrow(/maxAgeSeconds/);
    expect(() => computeStaleness(AS_OF, AS_OF, -5)).toThrow(/maxAgeSeconds/);
  });
});

describe("isInsufficient", () => {
  it("is false at exactly the multiplier boundary", () => {
    expect(INSUFFICIENT_AGE_MULTIPLIER).toBe(2);
    expect(isInsufficient(AS_OF, plusSeconds(AS_OF, 2 * HOUR), HOUR)).toBe(false);
  });

  it("is true beyond twice the max age", () => {
    expect(isInsufficient(AS_OF, plusSeconds(AS_OF, 2 * HOUR + 1), HOUR)).toBe(true);
  });

  it("is false when merely stale", () => {
    expect(isInsufficient(AS_OF, plusSeconds(AS_OF, HOUR + 1), HOUR)).toBe(false);
  });

  it("throws on unparsable dates", () => {
    expect(() => isInsufficient("nope", AS_OF, HOUR)).toThrow();
  });
});
