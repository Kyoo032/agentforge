import { describe, expect, it } from "vitest";
import { GUIDE_OUTCOMES, guidePayload, isGuideOutcome, parseGuideRecord } from "./guide";

describe("guide outcomes", () => {
  it("are finished, skipped and closed, and nothing else", () => {
    expect([...GUIDE_OUTCOMES]).toEqual(["finished", "skipped", "closed"]);
    expect(isGuideOutcome("finished")).toBe(true);
    expect(isGuideOutcome("dismissed")).toBe(false);
    expect(isGuideOutcome(undefined)).toBe(false);
    expect(isGuideOutcome({ outcome: "closed" })).toBe(false);
  });
});

describe("parseGuideRecord", () => {
  it("keeps a well-formed record", () => {
    expect(parseGuideRecord({ outcome: "skipped", at: 1_790_000_000_000 })).toEqual({
      outcome: "skipped",
      at: 1_790_000_000_000,
    });
  });

  it("drops anything unreadable to null, which means the guide has not been seen", () => {
    for (const junk of [null, undefined, "finished", 3, [], {}, { outcome: "finished" }, { at: 5 }]) {
      expect(parseGuideRecord(junk)).toBeNull();
    }
    expect(parseGuideRecord({ outcome: "nope", at: 5 })).toBeNull();
    expect(parseGuideRecord({ outcome: "closed", at: Number.NaN })).toBeNull();
    expect(parseGuideRecord({ outcome: "closed", at: -1 })).toBeNull();
    expect(parseGuideRecord({ outcome: "closed", at: "5" })).toBeNull();
  });
});

describe("guidePayload", () => {
  it("is unseen with no record and seen with one", () => {
    expect(guidePayload(null)).toEqual({ seen: false, outcome: null, at: null });
    expect(guidePayload({ outcome: "finished", at: 7 })).toEqual({ seen: true, outcome: "finished", at: 7 });
  });
});
