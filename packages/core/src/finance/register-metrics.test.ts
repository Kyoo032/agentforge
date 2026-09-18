import { describe, expect, it } from "vitest";
import { computeFinance } from "./metrics";
import { commonLabelPrefix, median, readRegister, registerMetrics, registerTable } from "./register-metrics";
import type { LineItem } from "./types";

/** The same shape `financeFiguresFromSheet` writes and `readFiguresText` reads back. */
function employee(n: number, pokok: number, extra?: number): LineItem {
  const tunjangan = pokok * 0.2;
  const potongan = pokok * 0.05;
  return {
    label: `Karyawan ${n}`,
    period: "Oktober 2024",
    amount: pokok + tunjangan - potongan,
    currency: "",
    category: "other",
    columns: [
      { label: "Gaji Pokok", amount: pokok },
      { label: "Tunjangan", amount: tunjangan },
      { label: "Potongan BPJS", amount: potongan },
      { label: "Gaji Bersih", amount: pokok + tunjangan - potongan },
      ...(extra === undefined ? [] : [{ label: "Reimbursement Oktober 2024", amount: extra, extra: true }]),
    ],
  };
}

const PAYROLL: LineItem[] = [
  employee(1, 8_500_000, 1_250_000),
  employee(2, 12_000_000),
  employee(3, 6_750_000),
  employee(4, 9_250_000, 2_480_000),
  employee(5, 15_500_000),
  employee(6, 7_200_000),
  employee(7, 10_800_000, 980_000),
  employee(8, 5_900_000),
];

function metricValue(metrics: ReadonlyArray<{ key: string; value: number | null }>, key: string): number | null {
  return metrics.find((metric) => metric.key === key)?.value ?? null;
}

describe("median", () => {
  it("takes the middle value, or the mean of the two middle ones", () => {
    expect(median([3, 1, 2])).toBe(2);
    // Eight rows means a median no single row holds.
    expect(median([5_900_000, 6_750_000, 7_200_000, 8_500_000, 9_250_000, 10_800_000, 12_000_000, 15_500_000])).toBe(
      8_875_000,
    );
  });
});

describe("commonLabelPrefix", () => {
  it("names what the rows are each one of", () => {
    expect(commonLabelPrefix(["Karyawan 1", "Karyawan 2", "Karyawan 3"])).toBe("Karyawan");
    expect(commonLabelPrefix(["Cabang Bandung", "Cabang Medan"])).toBe("Cabang");
    expect(commonLabelPrefix(["Sewa", "Listrik"])).toBe("");
  });
});

describe("readRegister", () => {
  it("finds the column the rows settle on and the biggest component beside it", () => {
    const reading = readRegister(PAYROLL);
    expect(reading?.net?.label).toBe("Gaji Bersih");
    expect(reading?.base?.label).toBe("Gaji Pokok");
    expect(reading?.entity).toBe("Karyawan");
    expect(reading?.rows).toHaveLength(8);
  });

  it("adds a separate payment to the bottom line and nothing else to anything", () => {
    const reading = readRegister(PAYROLL);
    // 87.285.000 paid as salary + 4.710.000 reimbursed. The components are never in this number.
    expect(reading?.payout).toBe(91_995_000);
    expect(reading?.columns.find((column) => column.label === "Gaji Pokok")?.total).toBe(75_900_000);
    expect(reading?.columns.find((column) => column.label === "Gaji Bersih")?.total).toBe(87_285_000);
  });

  it("says nothing at all about a list whose rows carry no columns", () => {
    const items: LineItem[] = [
      { label: "Pendapatan", period: "2024", amount: 1000, currency: "IDR", category: "revenue" },
      { label: "Beban", period: "2024", amount: 400, currency: "IDR", category: "opex" },
    ];
    expect(readRegister(items)).toBeNull();
    expect(registerMetrics(items, "IDR", "id")).toEqual([]);
    expect(registerTable(items, "id")).toBeNull();
  });
});

describe("registerMetrics", () => {
  const metrics = registerMetrics(PAYROLL, "", "id");

  it("counts the rows and totals every column on its own", () => {
    expect(metricValue(metrics, "register_count Oktober 2024")).toBe(8);
    expect(metricValue(metrics, "register_total Gaji Pokok Oktober 2024")).toBe(75_900_000);
    expect(metricValue(metrics, "register_total Tunjangan Oktober 2024")).toBe(15_180_000);
    expect(metricValue(metrics, "register_total Potongan BPJS Oktober 2024")).toBe(3_795_000);
    expect(metricValue(metrics, "register_total Gaji Bersih Oktober 2024")).toBe(87_285_000);
  });

  it("describes the typical row and the two ends of it", () => {
    expect(metricValue(metrics, "register_average Gaji Pokok Oktober 2024")).toBe(9_487_500);
    expect(metricValue(metrics, "register_average Gaji Bersih Oktober 2024")).toBe(10_910_625);
    expect(metricValue(metrics, "register_median Gaji Pokok Oktober 2024")).toBe(8_875_000);
    expect(metricValue(metrics, "register_max Gaji Pokok Oktober 2024")).toBe(15_500_000);
    expect(metricValue(metrics, "register_min Gaji Pokok Oktober 2024")).toBe(5_900_000);
  });

  it("reads each component against the biggest one, and counts a column only the odd row fills", () => {
    expect(metricValue(metrics, "register_share Tunjangan Oktober 2024")).toBeCloseTo(20, 9);
    expect(metricValue(metrics, "register_share Potongan BPJS Oktober 2024")).toBeCloseTo(5, 9);
    expect(metricValue(metrics, "register_rows Reimbursement Oktober 2024 Oktober 2024")).toBe(3);
    // Every row has a basic salary, so saying "8 rows have one" would be noise.
    expect(metricValue(metrics, "register_rows Gaji Pokok Oktober 2024")).toBeNull();
  });

  it("states what was actually paid out, and never a sum across two views of it", () => {
    expect(metricValue(metrics, "register_payout Oktober 2024")).toBe(91_995_000);
    const totals = metrics.filter((metric) => metric.key.startsWith("register_total ")).map((metric) => metric.value);
    expect(totals).not.toContain(75_900_000 + 15_180_000);
  });

  it("names the figures in the reader's own language", () => {
    const id = registerMetrics(PAYROLL, "", "id").map((metric) => metric.label);
    const en = registerMetrics(PAYROLL, "", "en").map((metric) => metric.label);
    expect(id).toContain("Median Gaji Pokok Oktober 2024");
    expect(id).toContain("Gaji Pokok tertinggi Oktober 2024");
    expect(id).toContain("Total pembayaran Oktober 2024");
    expect(en).toContain("Highest Gaji Pokok Oktober 2024");
    expect(en).toContain("Total paid out Oktober 2024");
  });
});

describe("registerTable", () => {
  it("puts the whole register in front of the reader, one row per entity", () => {
    const table = registerTable(PAYROLL, "id");
    expect(table?.columns).toEqual([
      "Karyawan",
      "Gaji Pokok",
      "Tunjangan",
      "Potongan BPJS",
      "Gaji Bersih",
      "Reimbursement Oktober 2024",
    ]);
    expect(table?.rows).toHaveLength(8);
    expect(table?.rows[0]).toEqual(["Karyawan 1", 8_500_000, 1_700_000, 425_000, 9_775_000, 1_250_000]);
    // A row with no reimbursement says so, rather than reading as a zero.
    expect(table?.rows[1]?.at(-1)).toBeNull();
  });
});

describe("computeFinance over a register", () => {
  it("carries the register's own figures and never climbs a profit ladder it does not have", () => {
    const computed = computeFinance(PAYROLL, {}, { locale: "id" });
    expect(computed.metrics.map((metric) => metric.key)).toContain("register_payout Oktober 2024");
    expect(computed.metrics.some((metric) => metric.key.startsWith("gross_margin"))).toBe(false);
    expect(computed.tables.map((table) => table.name)).toContain("Rincian per baris");
    expect(computed.allowed).toContain(91_995_000);
  });
});
