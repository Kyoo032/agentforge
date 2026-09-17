import { describe, expect, it } from "vitest";
import { addCalendarMonths, formatCalendarMonth, monthCashRunsOut, parseCalendarMonth } from "./calendar";

describe("reading a period label as a month", () => {
  it("takes Indonesian and English, abbreviated or written out", () => {
    expect(parseCalendarMonth("Des 2024")).toEqual({ year: 2024, month: 12 });
    expect(parseCalendarMonth("Desember 2024")).toEqual({ year: 2024, month: 12 });
    expect(parseCalendarMonth("Agu 2024")).toEqual({ year: 2024, month: 8 });
    expect(parseCalendarMonth("Okt 2024")).toEqual({ year: 2024, month: 10 });
    expect(parseCalendarMonth("Mei 2024")).toEqual({ year: 2024, month: 5 });
    expect(parseCalendarMonth("Dec 2024")).toEqual({ year: 2024, month: 12 });
  });

  it("takes an ISO month or a dated ISO day", () => {
    expect(parseCalendarMonth("2024-09")).toEqual({ year: 2024, month: 9 });
    expect(parseCalendarMonth("2024-09-30")).toEqual({ year: 2024, month: 9 });
    expect(parseCalendarMonth("09/2024")).toEqual({ year: 2024, month: 9 });
  });

  it("answers null rather than guessing", () => {
    expect(parseCalendarMonth("Q1 2024")).toBeNull();
    expect(parseCalendarMonth("monthly")).toBeNull();
    expect(parseCalendarMonth("")).toBeNull();
  });
});

describe("walking the calendar", () => {
  it("rolls over the year end", () => {
    expect(addCalendarMonths({ year: 2024, month: 12 }, 1)).toEqual({ year: 2025, month: 1 });
    expect(addCalendarMonths({ year: 2024, month: 12 }, 9)).toEqual({ year: 2025, month: 9 });
    expect(addCalendarMonths({ year: 2025, month: 1 }, -2)).toEqual({ year: 2024, month: 11 });
  });

  it("writes the month the way a sentence needs it", () => {
    expect(formatCalendarMonth({ year: 2025, month: 9 }, "id")).toBe("September 2025");
    expect(formatCalendarMonth({ year: 2025, month: 2 }, "en")).toBe("February 2025");
    expect(formatCalendarMonth({ year: 2025, month: 2 }, "id")).toBe("Februari 2025");
  });
});

describe("the month the till empties", () => {
  it("rounds a part month up: 8,28 months after Des 2024 is September 2025", () => {
    expect(monthCashRunsOut("Des 2024", 8.283870967741935, "id")).toEqual({
      label: "September 2025",
      monthsAhead: 9,
    });
  });

  it("counts from the last period of a bank export too", () => {
    expect(monthCashRunsOut("2024-09", 4.056254136333553, "en")?.label).toBe("February 2025");
  });

  it("has no answer when there is no burn or no readable period", () => {
    expect(monthCashRunsOut("Des 2024", null, "id")).toBeNull();
    expect(monthCashRunsOut("monthly", 4, "id")).toBeNull();
  });
});
