import { describe, expect, it } from "vitest";
import { TASK_IDS, adapterFor } from "./adapters/index.mjs";
import { pairsWithAmounts } from "./adapters/budget.mjs";

const KASE = { id: "k", task: "brief", locale: "id", prompt: "Ringkas", params: { discountRate: 12 } };

describe("the adapter registry", () => {
  it("has one adapter per Finance task", () => {
    expect(TASK_IDS).toEqual(["brief", "cashflow", "budget", "appraisal", "ratios"]);
  });

  it("falls back to the brief for a task it does not know", () => {
    expect(adapterFor("nonesuch").id).toBe("brief");
  });
});

describe("brief", () => {
  it("scores the rows the parse proposed, unchanged", () => {
    const parse = { items: [{ label: "Pendapatan", period: "2024", amount: 1_000 }] };
    const rows = adapterFor("brief").extractionRows(parse);
    expect(rows.via).toBe("items");
    expect(rows.rows).toEqual([{ label: "Pendapatan", period: "2024", amount: 1_000 }]);
  });

  it("exports the brief, never a report", () => {
    const body = adapterFor("brief").exportBody(KASE, { brief: { title: "B" }, artifactId: "a1" }, "xlsx");
    expect(body).toEqual({ brief: { title: "B" }, format: "xlsx", artifactId: "a1", task: "brief" });
  });
});

describe("cashflow", () => {
  const parse = {
    items: [
      { label: "Total kas masuk", period: "Jan 2024", amount: 92_000_000 },
      { label: "Total kas keluar", period: "Jan 2024", amount: 88_750_000 },
    ],
    categories: [
      {
        label: "Penjualan kopi",
        amounts: [
          { period: "Jan 2024", amount: 70_000_000 },
          { period: "Feb 2024", amount: 71_000_000 },
        ],
      },
      { label: "Sewa", amounts: [{ period: "Jan 2024", amount: -18_000_000 }] },
    ],
    periods: ["Jan 2024", "Feb 2024"],
    openingCash: 45_000_000,
  };

  it("scores the folded period rows, which are the ones the confirm table holds", () => {
    const rows = adapterFor("cashflow").extractionRows(parse);
    expect(rows.via).toBe("items");
    expect(rows.rows).toEqual([
      { label: "Total kas masuk", period: "Jan 2024", amount: 92_000_000 },
      { label: "Total kas keluar", period: "Jan 2024", amount: 88_750_000 },
    ]);
  });

  it("falls back to the source categories and says so", () => {
    const rows = adapterFor("cashflow").extractionRows({ categories: parse.categories });
    expect(rows.via).toBe("categories");
    expect(rows.rows).toHaveLength(3);
    expect(rows.note).toContain("source");
  });

  it("says a shape with no labels cannot express the truth", () => {
    const rows = adapterFor("cashflow").extractionRows({ items: [], categories: [], periods: [] });
    expect(rows.rows).toBeNull();
    expect(rows.why).toContain("cannot express truth.lineItems");
    expect(rows.shapes).toMatchObject({ items: 0, categories: 0 });
  });

  it("lets the case's own opening balance win over the one the parse read", () => {
    const body = adapterFor("cashflow").generateBody({ ...KASE, params: { openingCash: 1 } }, parse);
    expect(body.params.openingCash).toBe(1);
    expect(body.items).toBe(parse.items);
  });

  it("exports the report a task computed", () => {
    const body = adapterFor("cashflow").exportBody(
      { ...KASE, task: "cashflow" },
      { report: { task: "cashflow" } },
      "pptx",
    );
    expect(body).toEqual({ report: { task: "cashflow" }, format: "pptx", task: "cashflow" });
  });
});

describe("budget", () => {
  const parse = {
    items: [],
    budget: [{ label: "Sewa kantor", amounts: [{ period: "Anggaran 2024", amount: 240_000_000 }] }],
    actual: [{ label: "Biaya sewa gedung", amounts: [{ period: "Realisasi 2024", amount: 262_000_000 }] }],
    pairs: [{ budgetLabel: "Sewa kantor", actualLabel: "Biaya sewa gedung", score: 0.82, stage: "embedding" }],
    budgetOnly: [],
    actualOnly: [],
  };

  it("scores both sides of the comparison", () => {
    const rows = adapterFor("budget").extractionRows(parse);
    expect(rows.via).toBe("budget+actual sides");
    expect(rows.rows).toEqual([
      { label: "Sewa kantor", period: "Anggaran 2024", amount: 240_000_000 },
      { label: "Biaya sewa gedung", period: "Realisasi 2024", amount: 262_000_000 },
    ]);
  });

  it("sends the proposed pairing back as the pairing the owner confirmed", () => {
    const body = adapterFor("budget").generateBody({ ...KASE, task: "budget", params: { flagPct: 10 } }, parse);
    expect(body.params.pairs).toEqual([{ budgetLabel: "Sewa kantor", actualLabel: "Biaya sewa gedung" }]);
    expect(body.params.flagPct).toBe(10);
  });

  it("attaches each side's figure to the pair it proposed", () => {
    const withAmounts = pairsWithAmounts(parse, null);
    expect(withAmounts[0]).toMatchObject({ planned: 240_000_000, actual: 262_000_000, variance: 22_000_000 });
  });

  it("leaves a one-sided pair's missing figure as NaN rather than zero", () => {
    const oneSided = {
      ...parse,
      pairs: [{ budgetLabel: "Cadangan", actualLabel: null }],
      budget: [{ label: "Cadangan", amounts: [{ period: "p", amount: 100 }] }],
    };
    const [pair] = pairsWithAmounts(oneSided, null);
    expect(pair.planned).toBe(100);
    expect(Number.isNaN(pair.actual)).toBe(true);
    expect(pair.variance).toBeUndefined();
  });
});

describe("ratios", () => {
  const parse = {
    items: [{ label: "Kas dan Setara Kas", period: "2024", amount: 2_340_000_000 }],
    buckets: [{ label: "Kas dan Setara Kas", period: "2024", amount: 2_340_000_000, bucket: "cash", confidence: 1 }],
    periods: ["2023", "2024"],
    stated: [{ label: "LABA USAHA (EBIT)", period: "2024", amount: 3_840_000_000 }],
  };

  it("scores the classified rows", () => {
    const rows = adapterFor("ratios").extractionRows(parse);
    expect(rows.via).toBe("buckets");
    expect(rows.rows[0]).toEqual({ label: "Kas dan Setara Kas", period: "2024", amount: 2_340_000_000 });
  });

  it("confirms the placement by sending no overrides at all", () => {
    const body = adapterFor("ratios").generateBody({ ...KASE, task: "ratios", params: {} }, parse);
    expect(body.params.buckets).toEqual([]);
    expect(body.params.bands).toEqual([]);
  });

  it("forwards the printed subtotals the way the step component does", () => {
    const body = adapterFor("ratios").generateBody({ ...KASE, task: "ratios", params: {} }, parse);
    expect(body.params.stated).toEqual([{ label: "LABA USAHA (EBIT)", period: "2024", amount: 3_840_000_000 }]);
  });

  it("sends an empty list rather than a broken one when the parse carried no subtotals", () => {
    const body = adapterFor("ratios").generateBody({ ...KASE, task: "ratios", params: {} }, { items: [] });
    expect(body.params.stated).toEqual([]);
  });
});

describe("appraisal", () => {
  const parse = {
    items: [{ label: "Investasi awal", period: "Tahun 0", amount: -1_450_000_000 }],
    flows: [{ period: "Tahun 0", year: 0, amount: -1_450_000_000, components: [] }],
    discountRatePercent: 12,
  };

  it("scores the component rows, which are the ones that carry a name", () => {
    const rows = adapterFor("appraisal").extractionRows(parse);
    expect(rows.via).toBe("items");
    expect(rows.rows).toHaveLength(1);
  });

  it("refuses to score netted flows rather than calling every row wrong", () => {
    const rows = adapterFor("appraisal").extractionRows({ items: [], flows: parse.flows });
    expect(rows.rows).toBeNull();
    expect(rows.why).toContain("no label");
  });

  it("prefills the rate the parse read only when the case names none", () => {
    const named = adapterFor("appraisal").generateBody(
      { ...KASE, task: "appraisal", params: { discountRate: 15 } },
      parse,
    );
    expect(named.params.discountRate).toBe(15);
    expect(named.params.discountRatePercent).toBeUndefined();
    const silent = adapterFor("appraisal").generateBody({ ...KASE, task: "appraisal", params: {} }, parse);
    expect(silent.params.discountRatePercent).toBe(12);
  });
});
