import type { DataChart } from "@agentforge/core/artifacts";
import { describe, expect, it } from "vitest";
import {
  CHART_PALETTE,
  DEFAULT_CHART_LAYOUT,
  bandScale,
  buildBarLayout,
  buildLineLayout,
  buildScatterLayout,
  chartPalette,
  formatTick,
  linearScale,
  niceTicks,
  plotArea,
  seriesExtent,
  truncateLabel,
} from "@/lib/chart-scale";

const plot = plotArea(DEFAULT_CHART_LAYOUT);

function spacingOf(ticks: number[]): number[] {
  return ticks.slice(1).map((tick, index) => Number((tick - (ticks[index] ?? 0)).toFixed(6)));
}

describe("niceTicks", () => {
  it("covers 0..100 with a nice step", () => {
    expect(niceTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("includes zero when the domain crosses it", () => {
    const ticks = niceTicks(-5, 5);
    expect(ticks).toContain(0);
    expect(ticks[0]).toBeLessThanOrEqual(-5);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(5);
    expect(new Set(spacingOf(ticks)).size).toBe(1);
  });

  it("handles small decimal domains without float drift", () => {
    expect(niceTicks(0.001, 0.004)).toEqual([0.001, 0.002, 0.003, 0.004]);
  });

  it("returns the single value when min equals max", () => {
    expect(niceTicks(7, 7)).toEqual([7]);
  });

  it("always returns at least two ticks for a real span", () => {
    expect(niceTicks(3, 3.0001).length).toBeGreaterThanOrEqual(2);
    expect(niceTicks(1, 1_000_000).length).toBeGreaterThanOrEqual(2);
  });
});

describe("linearScale", () => {
  it("maps the domain onto the range", () => {
    const scale = linearScale([0, 10], [100, 0]);
    expect(scale(0)).toBe(100);
    expect(scale(5)).toBe(50);
    expect(scale(10)).toBe(0);
  });

  it("centers a zero-width domain", () => {
    const scale = linearScale([4, 4], [0, 200]);
    expect(scale(4)).toBe(100);
    expect(scale(99)).toBe(100);
  });
});

describe("bandScale", () => {
  it("spaces bands evenly with padding", () => {
    const scale = bandScale(4, [0, 400], 0.2);
    expect(scale.bandWidth).toBeCloseTo(80);
    expect(scale.position(0)).toBeCloseTo(10);
    expect(scale.position(1)).toBeCloseTo(110);
    expect(scale.position(3)).toBeCloseTo(310);
  });

  it("degrades to a zero-width band for an empty count", () => {
    const scale = bandScale(0, [10, 50]);
    expect(scale.bandWidth).toBe(0);
    expect(scale.position(0)).toBe(10);
  });
});

describe("seriesExtent", () => {
  it("ignores NaN and infinities", () => {
    expect(seriesExtent([{ values: [3, Number.NaN, 9] }, { values: [Number.POSITIVE_INFINITY, 5] }], false)).toEqual([
      3, 9,
    ]);
  });

  it("includes zero by default", () => {
    expect(seriesExtent([{ values: [3, 9] }])).toEqual([0, 9]);
    expect(seriesExtent([{ values: [-3, -9] }])).toEqual([-9, 0]);
  });

  it("falls back to [0, 1] when nothing is finite", () => {
    expect(seriesExtent([])).toEqual([0, 1]);
    expect(seriesExtent([{ values: [Number.NaN] }])).toEqual([0, 1]);
  });
});

describe("formatTick", () => {
  it("formats compact magnitudes", () => {
    expect(formatTick(1234567)).toBe("1.23M");
    expect(formatTick(12345)).toBe("12.3k");
    expect(formatTick(1500000000)).toBe("1.5B");
    expect(formatTick(-12345)).toBe("-12.3k");
  });

  it("keeps integers and trims decimals", () => {
    expect(formatTick(7)).toBe("7");
    expect(formatTick(2000)).toBe("2000");
    expect(formatTick(0.5)).toBe("0.5");
    expect(formatTick(1.23456)).toBe("1.23");
    expect(formatTick(0.001)).toBe("0.001");
    expect(formatTick(Number.NaN)).toBe("");
  });
});

describe("chartPalette", () => {
  it("wraps around the fixed palette", () => {
    expect(chartPalette(0)).toBe(CHART_PALETTE[0]);
    expect(chartPalette(CHART_PALETTE.length)).toBe(CHART_PALETTE[0]);
    expect(chartPalette(-1)).toBe(CHART_PALETTE[CHART_PALETTE.length - 1]);
  });
});

describe("truncateLabel", () => {
  it("shortens long labels with an ellipsis", () => {
    expect(truncateLabel("short")).toBe("short");
    expect(truncateLabel("a very long category name")).toBe("a very long c…");
  });
});

const barChart: DataChart = {
  type: "bar",
  title: "Spend by vendor",
  x: { label: "Vendor", values: ["Acme", "Beta", "Gamma"] },
  series: [
    { name: "2024", values: [100, 50, 25] },
    { name: "2025", values: [80, 60, 10] },
  ],
};

describe("buildBarLayout", () => {
  it("draws one bar per series per category inside the plot area", () => {
    const layout = buildBarLayout(barChart);
    expect(layout.bars).toHaveLength(6);
    expect(layout.xLabels.map((label) => label.label)).toEqual(["Acme", "Beta", "Gamma"]);
    for (const bar of layout.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(plot.x0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(plot.x1 + 1e-6);
      expect(bar.y).toBeGreaterThanOrEqual(plot.y0);
      expect(bar.y + bar.height).toBeLessThanOrEqual(plot.y1 + 1e-6);
    }
  });

  it("makes bar heights proportional to values", () => {
    const layout = buildBarLayout(barChart);
    const acme2024 = layout.bars.find((bar) => bar.label === "Acme" && bar.seriesIndex === 0);
    const beta2024 = layout.bars.find((bar) => bar.label === "Beta" && bar.seriesIndex === 0);
    expect(acme2024).toBeDefined();
    expect(beta2024).toBeDefined();
    expect((acme2024?.height ?? 0) / (beta2024?.height ?? 1)).toBeCloseTo(2);
    expect(layout.ticks[0]?.label).toBe("0");
  });

  it("never produces NaN for all-zero or empty series", () => {
    const flat = buildBarLayout({ ...barChart, series: [{ name: "zero", values: [0, 0, 0] }] });
    const empty = buildBarLayout({ ...barChart, x: { label: "", values: [] }, series: [{ name: "none", values: [] }] });
    for (const bar of [...flat.bars, ...empty.bars]) {
      expect([bar.x, bar.y, bar.width, bar.height].every(Number.isFinite)).toBe(true);
    }
    expect(flat.ticks.every((tick) => Number.isFinite(tick.y))).toBe(true);
    expect(empty.bars).toHaveLength(0);
  });
});

describe("buildLineLayout", () => {
  it("builds one M and one L per extra point", () => {
    const layout = buildLineLayout({ ...barChart, type: "line" });
    expect(layout.lines).toHaveLength(2);
    for (const line of layout.lines) {
      expect(line.path.startsWith("M")).toBe(true);
      expect(line.path.match(/L/g)?.length ?? 0).toBe(line.points.length - 1);
    }
    expect(layout.lines[0]?.points[0]?.x).toBeCloseTo(plot.x0);
    expect(layout.lines[0]?.points[2]?.x).toBeCloseTo(plot.x1);
  });

  it("centers a single point", () => {
    const layout = buildLineLayout({ ...barChart, type: "line", x: { label: "", values: ["only"] } });
    expect(layout.lines[0]?.points[0]?.x).toBeCloseTo((plot.x0 + plot.x1) / 2);
  });
});

describe("buildScatterLayout", () => {
  it("skips non-numeric x values and yields finite coordinates", () => {
    const layout = buildScatterLayout({
      type: "scatter",
      title: "",
      x: { label: "Size", values: [1, "2", "n/a", 4.5, ""] },
      series: [{ name: "Cost", values: [10, 20, 30, 40, 50] }],
    });
    expect(layout.points).toHaveLength(3);
    expect(layout.points.map((point) => point.xValue)).toEqual([1, 2, 4.5]);
    const coordinates = [
      ...layout.points.flatMap((point) => [point.x, point.y]),
      ...layout.xTicks.map((tick) => tick.x),
      ...layout.yTicks.map((tick) => tick.y),
    ];
    expect(coordinates.every(Number.isFinite)).toBe(true);
    expect(layout.xTicks.length).toBeGreaterThanOrEqual(2);
  });

  it("handles identical x values without NaN", () => {
    const layout = buildScatterLayout({
      type: "scatter",
      title: "",
      x: { label: "", values: [5, 5, 5] },
      series: [{ name: "y", values: [1, 2, 3] }],
    });
    expect(layout.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });
});
