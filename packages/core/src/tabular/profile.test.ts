import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatNumber, profileColumn, profileTable, profileToMarkdown } from "./profile";
import { summarizeNumbers } from "./stats";
import type { TabularTable } from "./types";

describe("profileColumn", () => {
  it("computes numeric statistics and counts nulls", () => {
    const profile = profileColumn("price", ["1", "2", "3", "4", "NA", ""]);
    expect(profile.type).toBe("number");
    expect(profile.nulls).toBe(2);
    expect(profile.distinct).toBe(4);
    expect(profile.min).toBe(1);
    expect(profile.max).toBe(4);
    expect(profile.mean).toBe(2.5);
    expect(profile.median).toBe(2.5);
    expect(profile.stddev).toBeCloseTo(Math.sqrt(1.25), 10);
  });

  it("uses the middle value for an odd count and the midpoint for an even count", () => {
    expect(profileColumn("n", ["5", "1", "3"]).median).toBe(3);
    expect(profileColumn("n", ["10", "1", "3", "4"]).median).toBe(3.5);
  });

  it("orders topK by count then first appearance and respects the limit", () => {
    const profile = profileColumn("tag", ["b", "a", "a", "c", "b", "d"], { topK: 3 });
    expect(profile.topK).toEqual([
      { value: "b", count: 2 },
      { value: "a", count: 2 },
      { value: "c", count: 1 },
    ]);
  });

  it("defaults topK to five entries", () => {
    const profile = profileColumn("tag", ["a", "b", "c", "d", "e", "f", "g"]);
    expect(profile.topK).toHaveLength(5);
  });

  it("reports ISO min and max for date columns", () => {
    const profile = profileColumn("when", ["31/01/2024", "2023-12-25", "Jan 5, 2024", ""]);
    expect(profile.type).toBe("date");
    expect(profile.min).toBe("2023-12-25");
    expect(profile.max).toBe("2024-01-31");
    expect(profile.mean).toBeUndefined();
  });

  it("omits stats for string columns", () => {
    const profile = profileColumn("name", ["x", "y"]);
    expect(profile.type).toBe("string");
    expect(profile.min).toBeUndefined();
    expect(profile.max).toBeUndefined();
    expect(profile.stddev).toBeUndefined();
  });
});

const table: TabularTable = {
  headers: ["city", "temp"],
  rows: [
    ["Oslo", "-3"],
    ["Rome", "12"],
    ["Oslo", ""],
  ],
  delimiter: ",",
  ragged: false,
};

describe("profileTable", () => {
  it("profiles every column and counts rows", () => {
    const profile = profileTable(table);
    expect(profile.rowCount).toBe(3);
    expect(profile.columnCount).toBe(2);
    expect(profile.columns.map((column) => column.name)).toEqual(["city", "temp"]);
    expect(profile.columns[1]?.type).toBe("number");
    expect(profile.columns[1]?.nulls).toBe(1);
  });
});

describe("profileToMarkdown", () => {
  it("renders a header row and one row per column", () => {
    const markdown = profileToMarkdown(profileTable(table));
    const lines = markdown.split("\n");
    expect(lines[0]).toBe("| Column | Type | Nulls | Distinct | Min | Max | Mean | Top values |");
    expect(lines[1]).toMatch(/^\| --- \| --- /);
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain("| city | string | 0 | 2 |");
    expect(lines[2]).toContain("Oslo (2)");
    expect(lines[3]).toContain("| temp | number | 1 | 2 | -3 | 12 | 4.5 |");
  });

  it("escapes pipes in values", () => {
    const markdown = profileToMarkdown(profileTable({ ...table, rows: [["a|b", "1"]] }));
    expect(markdown).toContain("a\\|b (1)");
  });
});

describe("formatNumber", () => {
  it("prints up to four decimals without trailing zeros", () => {
    expect(formatNumber(2)).toBe("2");
    expect(formatNumber(2.5)).toBe("2.5");
    expect(formatNumber(1 / 3)).toBe("0.3333");
    expect(formatNumber(1.10000001)).toBe("1.1");
    expect(formatNumber(-0.00001)).toBe("0");
  });
});

describe("summarizeNumbers", () => {
  it("returns null for an empty list", () => {
    expect(summarizeNumbers([])).toBeNull();
  });

  it("keeps the mean between min and max and a non-negative stddev", () => {
    const finite = fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 });
    fc.assert(
      fc.property(fc.array(finite, { minLength: 1, maxLength: 40 }), (numbers) => {
        const stats = summarizeNumbers(numbers);
        expect(stats).not.toBeNull();
        if (!stats) return;
        const slack = 1e-9 * Math.max(1, Math.abs(stats.min), Math.abs(stats.max));
        expect(stats.mean).toBeGreaterThanOrEqual(stats.min - slack);
        expect(stats.mean).toBeLessThanOrEqual(stats.max + slack);
        expect(stats.median).toBeGreaterThanOrEqual(stats.min);
        expect(stats.median).toBeLessThanOrEqual(stats.max);
        expect(stats.stddev).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 500 },
    );
  });
});
