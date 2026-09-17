import { describe, expect, it } from "vitest";
import type { LineItem } from "../types";
import { appraisalFlowsFromItems, dropSubtotalRows, negativeYearsOf, netFlowsOf, outlayOf } from "./flows";
import { allPeriodsOrdinal, periodOrdinal } from "./periods";
import { MACHINE_ITEMS, MACHINE_NETS, SOLAR_ITEMS, SOLAR_NETS } from "./__fixtures__/plans";

function row(label: string, period: string, amount: number): LineItem {
  return { label, period, amount, currency: "", category: "cash" };
}

describe("period ordinals", () => {
  it("reads the ordinal a year header carries, in either language", () => {
    expect(periodOrdinal("Tahun 0")).toBe(0);
    expect(periodOrdinal("Year 10")).toBe(10);
    expect(periodOrdinal("Tahun ke-2")).toBe(2);
    expect(periodOrdinal("  Periode 3 ")).toBe(3);
    expect(periodOrdinal("2nd year")).toBe(2);
    expect(periodOrdinal("7")).toBe(7);
  });

  // A calendar year read as an ordinal would discount the flow by two thousand periods.
  it("refuses a calendar year and anything with no ordinal in it", () => {
    expect(periodOrdinal("2024")).toBeNull();
    expect(periodOrdinal("Q1 2026")).toBeNull();
    expect(periodOrdinal("")).toBeNull();
    expect(allPeriodsOrdinal(["Tahun 0", "2024"])).toBe(false);
    expect(allPeriodsOrdinal(["Year 0", "Year 1"])).toBe(true);
  });
});

describe("subtotal rows", () => {
  const parts = [row("Savings", "Year 1", 100), row("Cost", "Year 1", -40)];

  it("drops a row the importer already tagged as a total", () => {
    const tagged = [...parts, row("[subtotal] Net cash flow", "Year 1", 60)];
    expect(dropSubtotalRows(tagged)).toHaveLength(2);
  });

  it("drops a row that is named like a total AND totals its peers", () => {
    const named = [...parts, row("Arus kas bersih", "Year 1", 60)];
    expect(dropSubtotalRows(named).map((item) => item.label)).toEqual(["Savings", "Cost"]);
  });

  // Name alone would delete a real row; arithmetic alone would delete a coincidence.
  it("keeps a row named like a total whose amount is not the total", () => {
    const wrong = [...parts, row("Total", "Year 1", 999)];
    expect(dropSubtotalRows(wrong)).toHaveLength(3);
  });

  it("keeps a row that totals its peers but is not named like a total", () => {
    const coincidence = [...parts, row("Grant received", "Year 1", 60)];
    expect(dropSubtotalRows(coincidence)).toHaveLength(3);
  });
});

describe("appraisal flows", () => {
  it("combines the component rows into one net flow per year, keeping the components", () => {
    const flows = appraisalFlowsFromItems(MACHINE_ITEMS);
    expect(flows.map((flow) => flow.period)).toEqual([
      "Tahun 0",
      "Tahun 1",
      "Tahun 2",
      "Tahun 3",
      "Tahun 4",
      "Tahun 5",
      "Tahun 6",
    ]);
    expect(netFlowsOf(flows)).toEqual([...MACHINE_NETS]);
    expect(flows[6]?.components.map((part) => part.label)).toEqual([
      "Penghematan biaya & tambahan pendapatan",
      "Biaya operasi & perawatan",
      "Nilai sisa (salvage)",
    ]);
  });

  it("keeps the negative mid-life year at its own sign", () => {
    const flows = appraisalFlowsFromItems(SOLAR_ITEMS);
    expect(netFlowsOf(flows)).toEqual([...SOLAR_NETS]);
    expect(negativeYearsOf(flows).map((flow) => flow.period)).toEqual(["Year 5"]);
    expect(outlayOf(flows)).toBe(-820_000);
  });

  // "Year 10" sorts before "Year 2" as text; the ordinal is what the discounting needs.
  it("orders by the ordinal, not by the order the rows arrived in", () => {
    const shuffled = [row("A", "Year 10", 5), row("B", "Year 0", -100), row("C", "Year 2", 7)];
    expect(appraisalFlowsFromItems(shuffled).map((flow) => flow.year)).toEqual([0, 2, 10]);
  });

  it("falls back to first appearance when no period carries an ordinal", () => {
    const dated = [row("A", "2024", -100), row("B", "2025", 60), row("C", "2026", 70)];
    const flows = appraisalFlowsFromItems(dated);
    expect(flows.map((flow) => flow.period)).toEqual(["2024", "2025", "2026"]);
    expect(flows.map((flow) => flow.year)).toEqual([0, 1, 2]);
  });

  it("answers with nothing rather than a guess when there are no rows", () => {
    expect(appraisalFlowsFromItems([])).toEqual([]);
    expect(outlayOf([])).toBeNull();
  });
});
