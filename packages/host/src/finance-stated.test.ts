import { describe, expect, it } from "vitest";
import { computeFinance, guardNumbers, type LineItem } from "@agentforge/core/finance";
import { readStatedFacts, statedFactsBlock, withStatedFacts } from "./finance-stated";

const ITEMS: LineItem[] = [
  { label: "Pendapatan", period: "2024", amount: 21_965_000_000, currency: "IDR", category: "revenue" },
  { label: "HPP", period: "2024", amount: 12_960_350_000, currency: "IDR", category: "cogs" },
];

const FACTS = [
  {
    id: "S1#1",
    label: "Jumlah karyawan",
    sentence: "Perseroan mempekerjakan 148 karyawan.",
    value: 148,
    unit: "count" as const,
    currency: "",
  },
  {
    id: "S2#1",
    label: "Rasio lancar",
    sentence: "Rasio lancar 1,84 kali.",
    value: 1.84,
    unit: "ratio" as const,
    currency: "",
  },
  {
    id: "S3#1",
    label: "Dividen tunai",
    sentence: "Dividen Rp 250 juta.",
    value: 250_000_000,
    unit: "currency" as const,
    currency: "IDR",
  },
];

describe("readStatedFacts", () => {
  it("takes the confirmed facts and drops a malformed list rather than repairing it", () => {
    expect(readStatedFacts({ statedFacts: FACTS })).toHaveLength(3);
    expect(readStatedFacts({})).toEqual([]);
    expect(readStatedFacts({ statedFacts: [{ value: "not a number" }] })).toEqual([]);
  });
});

describe("withStatedFacts", () => {
  const computed = withStatedFacts(computeFinance(ITEMS, {}, { locale: "id" }), FACTS, "id");

  it("adds a table the reader can see, and leaves the computed metrics alone", () => {
    const table = computed.tables.find((entry) => entry.name === "Tertulis di dokumen");
    expect(table?.rows.map((row) => row[1])).toEqual([148, 1.84, 250_000_000]);
    expect(computed.metrics.some((metric) => metric.label.includes("karyawan"))).toBe(false);
  });

  it("lets the guard verify a figure that exists only in a sentence", () => {
    const before = guardNumbers("Perseroan punya 148 karyawan dan rasio lancar 1,84x.", computeFinance(ITEMS).allowed);
    expect(before.flagged.map((token) => token.text)).toContain("1,84x");
    const after = guardNumbers("Perseroan punya 148 karyawan dan rasio lancar 1,84x.", computed.allowed);
    expect(after.flagged).toEqual([]);
  });

  it("never lets a stated fact into a sum", () => {
    const revenue = computed.metrics.find((metric) => metric.key === "revenue 2024");
    expect(revenue?.value).toBe(21_965_000_000);
  });

  it("is a no-op when the document stated nothing", () => {
    const plain = computeFinance(ITEMS, {}, { locale: "id" });
    expect(withStatedFacts(plain, [], "id")).toBe(plain);
  });
});

describe("statedFactsBlock", () => {
  it("hands the model the finished spelling and tells it these are quotations", () => {
    const block = statedFactsBlock(FACTS, "id") ?? "";
    expect(block).toContain("jangan dijumlahkan");
    expect(block).toContain("Jumlah karyawan: 148");
    expect(block).toContain("Dividen tunai: Rp 250.000.000");
    expect(statedFactsBlock([], "en")).toBeNull();
  });
});
