import { describe, expect, it } from "vitest";
import { briefAdapter } from "./adapters/brief.mjs";
import { parseBodyFor } from "./stages.mjs";

const KASE = {
  id: "doc-laporan-tahunan",
  task: "brief",
  locale: "id",
  prompt: "Ringkas laporan ini",
  params: { discountRate: 12 },
  figuresText: "Pendapatan | 2024 | 1250000000",
  proseText: "Per 31 Desember 2024 perseroan mempekerjakan 1.240 karyawan tetap.",
};

const FACT = {
  id: "S3#1",
  label: "Jumlah karyawan tetap",
  sentence: "Per 31 Desember 2024 perseroan mempekerjakan 1.240 karyawan tetap.",
  value: 1_240,
  unit: "count",
  currency: "",
};

describe("the brief's parse body", () => {
  it("sends the document's prose, the way the Read button does", () => {
    expect(briefAdapter.parseBody(KASE)).toEqual({
      figures: KASE.figuresText,
      task: "brief",
      proseText: KASE.proseText,
    });
  });

  it("leaves `proseText` out for a spreadsheet, which has no sentences", () => {
    const body = briefAdapter.parseBody({ ...KASE, proseText: "   " });
    expect(body).toEqual({ figures: KASE.figuresText, task: "brief" });
    expect("proseText" in body).toBe(false);
  });
});

describe("the brief's generate body", () => {
  it("posts the prose figures the parse proposed as `statedFacts`, confirmed as they came", () => {
    const body = briefAdapter.generateBody(KASE, { items: [], proseFacts: [FACT] });
    expect(body.statedFacts).toEqual([FACT]);
    expect(body.task).toBe("brief");
  });

  it("drops a fact with no finite figure and one with no name at all", () => {
    const body = briefAdapter.generateBody(KASE, {
      items: [],
      proseFacts: [
        FACT,
        { ...FACT, id: "S4#1", value: Number.NaN },
        { ...FACT, id: "S5#1", label: "  ", sentence: "  " },
      ],
    });
    expect(body.statedFacts.map((fact) => fact.id)).toEqual(["S3#1"]);
  });

  it("says nothing about stated facts when the document stated none", () => {
    const body = briefAdapter.generateBody(KASE, { items: [], proseFacts: [] });
    expect("statedFacts" in body).toBe(false);
  });

  it("names an unknown unit `number` rather than passing it through", () => {
    const body = briefAdapter.generateBody(KASE, { items: [], proseFacts: [{ ...FACT, unit: "bushels" }] });
    expect(body.statedFacts[0].unit).toBe("number");
  });
});

describe("the brief's extraction rows", () => {
  const items = [
    { label: "Pendapatan", period: "2024", amount: 1_000 },
    { label: "Beban pokok", period: "2024", amount: -400 },
  ];
  const derived = [
    { label: "Laba kotor", period: "2024", amount: 600, derived: true },
    { label: "Jumlah aset", period: "2024", amount: 9_999, derived: true },
  ];
  const truth = {
    lineItems: [
      { label: "Pendapatan", period: "2024", amount: 1_000, category: "revenue" },
      { label: "Beban pokok", period: "2024", amount: -400, category: "cost" },
      { label: "Laba kotor", period: "2024", amount: 600, category: "subtotal" },
    ],
  };
  const kase = { ...KASE, truth };

  it("answers a truth subtotal from the parse's derived list", () => {
    const rows = briefAdapter.extractionRows({ items, derived }, kase);
    expect(rows.rows).toEqual([
      { label: "Pendapatan", period: "2024", amount: 1_000 },
      { label: "Beban pokok", period: "2024", amount: -400 },
      { label: "Laba kotor", period: "2024", amount: 600 },
    ]);
    expect(rows.via).toBe("items+derived");
  });

  it("never counts a derived row as an extra: an unlisted total is left out", () => {
    const rows = briefAdapter.extractionRows({ items, derived }, kase);
    expect(rows.rows.some((row) => row.label === "Jumlah aset")).toBe(false);
  });

  it("records in the trace how many truth rows came from `derived`", () => {
    const rows = briefAdapter.extractionRows({ items, derived }, kase);
    expect(rows.note).toContain("1");
    expect(rows.note).toContain("derived");
  });

  it("keeps a subtotal the app got wrong out of the rows, so it is a miss and not a second wrong row", () => {
    const wrong = [{ label: "Laba kotor", period: "2024", amount: 610, derived: true }];
    const rows = briefAdapter.extractionRows({ items, derived: wrong }, kase);
    expect(rows.rows).toHaveLength(2);
  });

  it("matches a truth row the case does not file as a subtotal against `items` alone", () => {
    const plain = {
      ...kase,
      truth: { lineItems: [{ label: "Laba kotor", period: "2024", amount: 600, category: "revenue" }] },
    };
    const rows = briefAdapter.extractionRows({ items, derived }, plain);
    expect(rows.rows.some((row) => row.label === "Laba kotor")).toBe(false);
  });

  it("scores the rows the parse proposed, unchanged, when nothing is derived", () => {
    const rows = briefAdapter.extractionRows({ items }, kase);
    expect(rows.via).toBe("items");
    expect(rows.rows).toEqual(items);
    expect(rows.note).toBeUndefined();
  });

  it("still says so when the parse answered with rows it cannot score", () => {
    const rows = briefAdapter.extractionRows({ items: [{ label: "", amount: 1 }] }, kase);
    expect(rows.rows).toBeNull();
    expect(rows.why).toContain("no label");
  });

  it("works for a case that declares no truth at all", () => {
    const rows = briefAdapter.extractionRows({ items, derived }, { ...KASE, truth: undefined });
    expect(rows.rows).toEqual(items);
  });
});

describe("the parse body the stage sends", () => {
  it("is the brief adapter's own, prose and all", () => {
    expect(parseBodyFor(KASE, briefAdapter)).toEqual({
      figures: KASE.figuresText,
      task: "brief",
      proseText: KASE.proseText,
    });
  });

  it("is the body every task has always sent when the adapter names none", () => {
    expect(parseBodyFor({ ...KASE, task: "cashflow" }, { id: "cashflow" })).toEqual({
      figures: KASE.figuresText,
      task: "cashflow",
      prompt: KASE.prompt,
      params: KASE.params,
    });
  });
});
