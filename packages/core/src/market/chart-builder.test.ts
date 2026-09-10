import { describe, expect, it } from "vitest";
import { dataChartSchema } from "../artifacts/data-analysis";
import {
  CHART_BARS_DEFAULT,
  CHART_RANGE_DEFAULT,
  CHART_RANGES,
  buildPriceChart,
  buildRangeChart,
  chartRange,
} from "./chart-builder";
import { makeHistory } from "./watch-fixtures";

describe("buildPriceChart", () => {
  it("keeps the last 120 bars and adds SMA50 and SMA200 when the whole window is computable", () => {
    // 120 + 199 = 319 bars is the minimum for a NaN-free SMA200 over the window (fetch 2y, not 1y).
    const chart = buildPriceChart(makeHistory("MU", 320));
    expect(dataChartSchema.parse(chart)).toEqual(chart);
    expect(chart.type).toBe("line");
    expect(CHART_BARS_DEFAULT).toBe(120);
    expect(chart.x.values).toHaveLength(120);
    expect(chart.x.values[0]).toBe("2026-05-13");
    expect(chart.x.values[119]).toBe("2026-09-09");
    expect(chart.series.map((s) => s.name)).toEqual(["close", "SMA50", "SMA200"]);
    for (const series of chart.series) {
      expect(series.values).toHaveLength(120);
      expect(series.values.every((v) => Number.isFinite(v))).toBe(true);
    }
    // closes 100..419; last close 419; SMAs over the full list, then sliced
    expect(chart.series[0].values[119]).toBe(419);
    expect(chart.series[1].values[119]).toBeCloseTo((419 + 370) / 2, 10);
    expect(chart.series[2].values[119]).toBeCloseTo((419 + 220) / 2, 10);
    // first point of the window (bar index 200) averages closes[1..200]
    expect(chart.series[2].values[0]).toBeCloseTo((101 + 300) / 2, 10);
  });

  it("drops any moving average whose window would contain a null", () => {
    const chart = buildPriceChart(makeHistory("MU", 60));
    expect(chart.x.values).toHaveLength(60);
    expect(chart.series.map((s) => s.name)).toEqual(["close"]);
  });

  it("includes SMA50 but not SMA200 for a one-year (250 bar) history", () => {
    const chart = buildPriceChart(makeHistory("MU", 250));
    expect(chart.x.values).toHaveLength(120);
    expect(chart.series.map((s) => s.name)).toEqual(["close", "SMA50"]);
  });

  it("honours bars and title options and labels the x axis", () => {
    const chart = buildPriceChart(makeHistory("BBCA.JK", 320), { bars: 30, title: "BBCA 30 hari" });
    expect(chart.title).toBe("BBCA 30 hari");
    expect(chart.x.label).toBe("date");
    expect(chart.x.values).toHaveLength(30);
    expect(chart.series).toHaveLength(3);
  });

  it("defaults the title to the symbol and tolerates an empty history", () => {
    expect(buildPriceChart(makeHistory("MU", 250)).title).toContain("MU");
    const empty = buildPriceChart(makeHistory("MU", 0));
    expect(empty.x.values).toEqual([]);
    expect(empty.series).toEqual([{ name: "close", values: [] }]);
  });

  it("sorts bars by date and does not mutate the input", () => {
    const history = makeHistory("MU", 10);
    const reversed = { ...history, bars: [...history.bars].reverse() };
    const snapshot = JSON.stringify(reversed);
    expect(buildPriceChart(reversed).x.values).toEqual(history.bars.map((b) => b.date));
    expect(JSON.stringify(reversed)).toBe(snapshot);
  });
});

describe("chart ranges", () => {
  it("offers 1M to 2Y, ascending, with 6M as the default", () => {
    expect(CHART_RANGES.map((range) => range.id)).toEqual(["1m", "3m", "6m", "1y", "2y"]);
    const bars = CHART_RANGES.map((range) => range.bars);
    expect([...bars].sort((a, b) => a - b)).toEqual(bars);
    expect(CHART_RANGES.some((range) => range.id === CHART_RANGE_DEFAULT)).toBe(true);
  });

  it("looks a range up by id and falls back to the default for an unknown one", () => {
    expect(chartRange("1m").bars).toBe(22);
    expect(chartRange("nope").id).toBe(CHART_RANGE_DEFAULT);
  });

  it("cuts the chart to the requested window", () => {
    const history = makeHistory("MU", 600);
    expect(buildRangeChart(history, "1m").x.values).toHaveLength(22);
    expect(buildRangeChart(history, "1y").x.values).toHaveLength(252);
  });

  it("returns every bar it has when the history is shorter than the window", () => {
    expect(buildRangeChart(makeHistory("MU", 30), "2y").x.values).toHaveLength(30);
  });

  it("passes the title through", () => {
    expect(buildRangeChart(makeHistory("MU", 300), "6m", "MU close").title).toBe("MU close");
  });
});
