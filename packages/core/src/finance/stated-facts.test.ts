import { describe, expect, it } from "vitest";
import { factSentences, statedFactValues, statedFactsFromProse, withFactLabels } from "./stated-facts";

const PROSE = [
  "Sampai akhir 2024 Perseroan mempekerjakan 148 karyawan tetap.",
  "Jaringan ritel tumbuh dari 12 gerai pada 2023 menjadi 17 gerai pada 2024.",
  "Rasio lancar berada di 1,84 kali pada akhir periode.",
  "Belanja modal 2024 mencapai Rp 1,18 miliar dan utang bank jangka panjang tercatat Rp 3,42 miliar.",
  "Dividen tunai yang dibayarkan sebesar Rp 250 juta.",
].join(" ");

describe("statedFactsFromProse", () => {
  const facts = statedFactsFromProse(PROSE, "id");

  it("reads the figures a table importer never sees", () => {
    expect(statedFactValues(facts)).toEqual(
      expect.arrayContaining([148, 12, 17, 1.84, 1_180_000_000, 3_420_000_000, 250_000_000]),
    );
  });

  it("takes the unit from the words around the number", () => {
    const byValue = new Map(facts.map((fact) => [fact.value, fact]));
    expect(byValue.get(148)?.unit).toBe("count");
    expect(byValue.get(17)?.unit).toBe("count");
    expect(byValue.get(1.84)?.unit).toBe("ratio");
    expect(byValue.get(1_180_000_000)?.unit).toBe("currency");
    expect(byValue.get(1_180_000_000)?.currency).toBe("IDR");
  });

  it("leaves a bare calendar year out: 2024 is a date, not a figure", () => {
    expect(facts.some((fact) => fact.value === 2024 && fact.unit === "number")).toBe(false);
  });

  it("keeps the sentence with every figure, and never sends an amount to a label pass", () => {
    const asked = factSentences(facts);
    expect(asked[0]).toEqual({ id: facts[0]?.id, sentence: facts[0]?.sentence });
    expect(Object.keys(asked[0] ?? {})).toEqual(["id", "sentence"]);
  });

  it("does not split a sentence in the middle of a grouped figure", () => {
    const one = statedFactsFromProse("Pendapatan Rp 21.965.000.000 pada 2024.", "id");
    expect(one.map((fact) => fact.value)).toEqual([21_965_000_000]);
  });

  it("reads English prose on the same terms", () => {
    const facts = statedFactsFromProse("We ended the year with 148 employees across 17 stores.", "en");
    expect(facts.map((fact) => [fact.value, fact.unit])).toEqual([
      [148, "count"],
      [17, "count"],
    ]);
  });
});

describe("the same document twice", () => {
  it("lists a figure once, however many copies of the report were uploaded", () => {
    const once = "Perseroan mempekerjakan 148 karyawan tetap.";
    const twice = [once, once].join(String.fromCharCode(10));
    expect(statedFactsFromProse(twice, "id")).toHaveLength(statedFactsFromProse(once, "id").length);
    expect(statedFactsFromProse(twice, "id").map((fact) => fact.value)).toEqual([148]);
  });

  it("keeps two different figures that a sentence really does state twice", () => {
    const facts = statedFactsFromProse("Pendapatan Rp 21.965.000.000, naik dari Rp 18.420.000.000.", "id");
    expect(facts.map((fact) => fact.value)).toEqual([21_965_000_000, 18_420_000_000]);
  });
});

describe("withFactLabels", () => {
  const facts = statedFactsFromProse("Perseroan mempekerjakan 148 karyawan tetap.", "id");

  it("attaches a label by id and leaves the value alone", () => {
    const named = withFactLabels(facts, new Map([[facts[0]?.id ?? "", "Jumlah karyawan tetap"]]));
    expect(named[0]).toMatchObject({ label: "Jumlah karyawan tetap", value: 148 });
  });

  it("falls back to the sentence when nothing came back for that id", () => {
    const named = withFactLabels(facts, new Map([["nope", "Something else"]]));
    expect(named[0]?.label).toBe("Perseroan mempekerjakan 148 karyawan tetap.");
    expect(named[0]?.value).toBe(148);
  });
});
