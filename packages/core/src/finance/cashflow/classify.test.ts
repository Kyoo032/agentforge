import { describe, expect, it } from "vitest";
import { classifyCashflowLabel, lowConfidenceCategories } from "./classify";
import { CASHFLOW_CONFIRM_BELOW } from "./types";

describe("the café's own rows", () => {
  const under = (label: string, section: string) => classifyCashflowLabel(label, { section });

  it("puts the goods and the packaging on the variable side", () => {
    expect(under("Pembelian bahan baku", "KAS KELUAR")).toMatchObject({ kind: "outflow", behaviour: "variable" });
    expect(under("Perlengkapan & kemasan", "KAS KELUAR")).toMatchObject({ kind: "outflow", behaviour: "variable" });
  });

  it("holds the overhaul out as a single event", () => {
    expect(under("Perawatan mesin (overhaul)", "KAS KELUAR")).toMatchObject({ behaviour: "oneOff" });
  });

  it("names the fixed rows and the slice each belongs to", () => {
    expect(under("Sewa tempat", "KAS KELUAR")).toMatchObject({ behaviour: "fixed", role: "rent" });
    expect(under("Gaji & upah", "KAS KELUAR")).toMatchObject({ behaviour: "fixed", role: "payroll" });
    expect(under("Pemasaran & promosi", "KAS KELUAR")).toMatchObject({ behaviour: "fixed", role: "marketing" });
    expect(under("Listrik & air", "KAS KELUAR")).toMatchObject({ behaviour: "fixed", role: "utilities" });
  });

  it("reads the section heading for the side", () => {
    expect(under("Penjualan tunai", "KAS MASUK").kind).toBe("inflow");
    expect(under("Pendapatan katering", "KAS MASUK").kind).toBe("inflow");
  });

  it("asks about a row no rule recognises rather than deciding quietly", () => {
    const row = under("Pajak & retribusi", "KAS KELUAR");
    expect(row.behaviour).toBe("fixed");
    expect(row.confidence).toBeLessThan(CASHFLOW_CONFIRM_BELOW);
    expect(lowConfidenceCategories([row], CASHFLOW_CONFIRM_BELOW)).toHaveLength(1);
  });
});

describe("a bank export with no sections", () => {
  it("reads the side from the sign, because that is the only evidence there is", () => {
    expect(classifyCashflowLabel("Professional services", { amount: 18_000 }).kind).toBe("inflow");
    expect(classifyCashflowLabel("Professional services", { amount: -18_000 }).kind).toBe("outflow");
  });

  it("keeps a funding round out of trade whatever the sign says", () => {
    expect(classifyCashflowLabel("Financing", { amount: 2_500_000 }).kind).toBe("financing");
  });
});
