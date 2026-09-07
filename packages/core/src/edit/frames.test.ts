import { describe, expect, it } from "vitest";
import { clampFrame, formatTimecode, framesToSeconds, secondsToFrames } from "./frames";

describe("frames", () => {
  it("converts frames to seconds", () => {
    expect(framesToSeconds(30, 30)).toBe(1);
    expect(framesToSeconds(45, 30)).toBe(1.5);
    expect(framesToSeconds(0, 24)).toBe(0);
  });

  it("converts seconds to frames with round-half-up", () => {
    expect(secondsToFrames(1, 30)).toBe(30);
    expect(secondsToFrames(1.5, 24)).toBe(36);
    expect(secondsToFrames(0.5 / 30, 30)).toBe(1);
    expect(secondsToFrames(1.4, 10)).toBe(14);
    expect(secondsToFrames(1.5, 10)).toBe(15);
    expect(secondsToFrames(1.49, 10)).toBe(15);
  });

  it("clamps frames into an inclusive integer range", () => {
    expect(clampFrame(12.9, 0, 10)).toBe(10);
    expect(clampFrame(-3, 0, 10)).toBe(0);
    expect(clampFrame(4, 0, 10)).toBe(4);
  });

  it("formats timecode as HH:MM:SS.mmm", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00.000");
    expect(formatTimecode(30, 30)).toBe("00:00:01.000");
    expect(formatTimecode(45, 30)).toBe("00:00:01.500");
    expect(formatTimecode(30 * 3600, 30)).toBe("01:00:00.000");
  });
});
