import type { ReportChart } from "@agentforge/core/finance";
import { describe, expect, it } from "vitest";
import { buildBarLayout, plotArea } from "@/lib/chart-scale";
import {
  FINANCE_CHART_LAYOUT,
  GAUGE_START_DEGREES,
  gaugeArcPath,
  gaugeBands,
  gaugeFraction,
  heatCells,
  heatExtreme,
  heatIntensity,
  polarPoint,
  reportChartAsData,
} from "@/lib/finance-chart-geometry";

const heat: ReportChart = {
  id: "sensitivity",
  title: "Sensitivity",
  kind: "heat",
  categories: ["-10%", "0%", "+10%"],
  series: [
    { name: "8%", values: [-40, 10, 60] },
    { name: "12%", values: [-90, null, 30] },
  ],
};

describe("reportChartAsData", () => {
  it("keeps the categories and turns a gap into a value the shared scales skip", () => {
    const data = reportChartAsData(heat, "bar");
    expect(data.x.values).toEqual(["-10%", "0%", "+10%"]);
    expect(Number.isNaN(data.series[1]?.values[1] as number)).toBe(true);
    // The shared layout drops it rather than drawing a bar at zero.
    expect(buildBarLayout(data, FINANCE_CHART_LAYOUT).bars).toHaveLength(5);
  });
});

describe("heatExtreme and heatIntensity", () => {
  it("scales against the largest magnitude in the grid", () => {
    expect(heatExtreme(heat)).toBe(90);
    expect(heatIntensity(45, 90)).toBe(0.5);
    expect(heatIntensity(-45, 90)).toBe(-0.5);
  });

  it("clamps past the ends and answers zero for anything unusable", () => {
    expect(heatIntensity(400, 90)).toBe(1);
    expect(heatIntensity(-400, 90)).toBe(-1);
    expect(heatIntensity(Number.NaN, 90)).toBe(0);
    expect(heatIntensity(5, 0)).toBe(0);
  });

  it("falls back to one when the grid has no numbers at all", () => {
    expect(heatExtreme({ ...heat, series: [{ name: "8%", values: [null, null, null] }] })).toBe(1);
  });
});

describe("heatCells", () => {
  const cells = heatCells(heat);
  const plot = plotArea(FINANCE_CHART_LAYOUT);

  it("lays one cell per series and category inside the plot area", () => {
    expect(cells).toHaveLength(6);
    for (const cell of cells) {
      expect(cell.x).toBeGreaterThanOrEqual(plot.x0);
      expect(cell.y).toBeGreaterThanOrEqual(plot.y0);
      expect(cell.x + cell.width).toBeLessThanOrEqual(plot.x1);
      expect(cell.y + cell.height).toBeLessThanOrEqual(plot.y1);
      expect(cell.width).toBeGreaterThan(0);
      expect(cell.height).toBeGreaterThan(0);
    }
  });

  it("names both axes on every cell and leaves a gap at zero intensity", () => {
    expect(cells[0]).toMatchObject({ row: "8%", column: "-10%", value: -40 });
    expect(cells[4]).toMatchObject({ row: "12%", column: "0%", value: null, intensity: 0 });
  });

  it("returns nothing for an empty grid", () => {
    expect(heatCells({ ...heat, series: [] })).toEqual([]);
    expect(heatCells({ ...heat, categories: [] })).toEqual([]);
  });
});

describe("gaugeFraction", () => {
  it("places a reading between the ends of its range", () => {
    expect(gaugeFraction(8, 0, 24)).toBeCloseTo(1 / 3, 6);
    expect(gaugeFraction(-5, 0, 24)).toBe(0);
    expect(gaugeFraction(40, 0, 24)).toBe(1);
  });

  it("answers zero for a flat, inverted or unusable range", () => {
    expect(gaugeFraction(8, 10, 10)).toBe(0);
    expect(gaugeFraction(8, 20, 10)).toBe(0);
    expect(gaugeFraction(Number.NaN, 0, 24)).toBe(0);
  });
});

describe("polarPoint and gaugeArcPath", () => {
  it("starts the dial on the left, passes over the top and ends on the right", () => {
    expect(polarPoint(100, 100, 50, GAUGE_START_DEGREES)).toEqual({ x: 50, y: 100 });
    expect(polarPoint(100, 100, 50, GAUGE_START_DEGREES + 90)).toEqual({ x: 100, y: 50 });
    expect(polarPoint(100, 100, 50, GAUGE_START_DEGREES + 180)).toEqual({ x: 150, y: 100 });
  });

  it("draws a single sweep arc between two fractions", () => {
    expect(gaugeArcPath(100, 100, 50, 0, 0.5)).toBe("M 50 100 A 50 50 0 0 1 100 50");
    expect(gaugeArcPath(100, 100, 50, 0, 1)).toBe("M 50 100 A 50 50 0 0 1 150 100");
  });

  it("draws nothing for an empty or inverted span", () => {
    expect(gaugeArcPath(100, 100, 50, 0.4, 0.4)).toBe("");
    expect(gaugeArcPath(100, 100, 50, 0.8, 0.2)).toBe("");
  });
});

describe("gaugeBands", () => {
  it("splits the dial into risk, watch and good", () => {
    expect(gaugeBands(6, 12, 0, 24)).toEqual([
      { from: 0, to: 0.25, level: "risk" },
      { from: 0.25, to: 0.5, level: "watch" },
      { from: 0.5, to: 1, level: "good" },
    ]);
  });

  it("drops a band with no width at all", () => {
    expect(gaugeBands(0, 0, 0, 24)).toEqual([{ from: 0, to: 1, level: "good" }]);
  });
});
