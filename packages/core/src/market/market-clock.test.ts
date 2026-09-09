import { describe, expect, it } from "vitest";
import { marketClock } from "./market-clock";
import { marketClockSchema } from "./watch-schemas";

function at(iso: string) {
  return marketClock(new Date(iso));
}

describe("marketClock (America/New_York sessions)", () => {
  it("validates against the schema and echoes runAt", () => {
    const clock = at("2026-09-09T13:25:00Z");
    expect(marketClockSchema.parse(clock)).toEqual(clock);
    expect(clock.runAt).toBe("2026-09-09T13:25:00.000Z");
  });

  it("is pre-market at 09:25 EDT on a weekday and says so in WIB and ET", () => {
    const clock = at("2026-09-09T13:25:00Z"); // Wednesday, EDT (UTC-4)
    expect(clock.usSession).toBe("pre");
    expect(clock.note).toContain("20:25 WIB");
    expect(clock.note).toContain("09:25 ET");
    expect(clock.note).toContain("pre-market");
  });

  it("handles standard time (EST, UTC-5) in January", () => {
    expect(at("2026-01-14T14:25:00Z").usSession).toBe("pre"); // 09:25 EST
    expect(at("2026-01-14T14:25:00Z").note).toContain("21:25 WIB = 09:25 ET");
    expect(at("2026-01-14T14:30:00Z").usSession).toBe("regular"); // 09:30 EST
    expect(at("2026-01-14T08:59:00Z").usSession).toBe("closed"); // 03:59 EST
    expect(at("2026-01-14T09:00:00Z").usSession).toBe("pre"); // 04:00 EST
  });

  it("opens regular at 09:30 and closes it at 16:00 ET", () => {
    expect(at("2026-09-09T13:30:00Z").usSession).toBe("regular");
    expect(at("2026-09-09T19:59:00Z").usSession).toBe("regular");
    expect(at("2026-09-09T20:00:00Z").usSession).toBe("post");
    expect(at("2026-09-09T23:59:00Z").usSession).toBe("post");
    expect(at("2026-09-10T00:00:00Z").usSession).toBe("closed"); // 20:00 EDT Wednesday
  });

  it("labels the regular and post sessions honestly (not pre-market)", () => {
    expect(at("2026-09-09T15:00:00Z").note).toMatch(/regular session/i);
    expect(at("2026-09-09T15:00:00Z").note).not.toMatch(/pre-market/i);
    expect(at("2026-09-09T21:00:00Z").note).toMatch(/after-hours/i);
  });

  it("reports a weekend as last close, not pre-market", () => {
    const saturday = at("2026-09-12T13:25:00Z");
    expect(saturday.usSession).toBe("closed");
    expect(saturday.note).toBe("Weekend: prices are last close, not pre-market.");
    expect(at("2026-09-13T13:25:00Z").usSession).toBe("closed"); // Sunday
  });

  it("uses the ET weekday, not the UTC one, at the week's edges", () => {
    expect(at("2026-09-12T00:30:00Z").usSession).toBe("closed"); // Friday 20:30 EDT
    expect(at("2026-09-12T00:30:00Z").note).not.toMatch(/weekend/i);
    expect(at("2026-09-11T23:30:00Z").usSession).toBe("post"); // Friday 19:30 EDT
    expect(at("2026-09-14T08:30:00Z").usSession).toBe("pre"); // Monday 04:30 EDT
    expect(at("2026-09-14T03:30:00Z").usSession).toBe("closed"); // Sunday 23:30 EDT
    expect(at("2026-09-14T03:30:00Z").note).toMatch(/weekend/i);
  });

  it("marks a closed weekday as last close", () => {
    expect(at("2026-09-10T00:00:00Z").note).toMatch(/closed/i);
    expect(at("2026-09-10T00:00:00Z").note).toMatch(/last close/i);
  });
});
