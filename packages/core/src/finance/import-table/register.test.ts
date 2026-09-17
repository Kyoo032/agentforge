import { describe, expect, it } from "vitest";
import {
  DERIVED_TAG,
  isAmountColumn,
  isRowCounterColumn,
  registerNetAt,
  registerShape,
  registerSheetPeriod,
  sheetNumberStyle,
  tableToFiguresText,
} from "./index";

const PAYROLL_HEADER = ["No", "Nama", "Gaji Pokok", "Tunjangan", "Potongan", "Gaji Bersih"];
const PAYROLL_BODY = [
  ["1", "Karyawan 1", "8,000,000", "1,600,000", "400,000", "9,200,000"],
  ["2", "Karyawan 2", "6,000,000", "1,200,000", "300,000", "6,900,000"],
  ["3", "Karyawan 3", "10,000,000", "2,000,000", "500,000", "11,500,000"],
  ["", "TOTAL GAJI", "24,000,000", "4,800,000", "1,200,000", "27,600,000"],
];

const STATEMENT_HEADER = ["Keterangan", "2023", "2024"];
const STATEMENT_BODY = [
  ["Pendapatan", "1,000", "1,200"],
  ["Beban pokok", "600", "700"],
  ["Laba kotor", "400", "500"],
];

function styleOf(rows: ReadonlyArray<ReadonlyArray<string>>) {
  return sheetNumberStyle(rows);
}

describe("registerShape", () => {
  it("reads an entity-per-row table as a register, with the settled column as its bottom line", () => {
    const shape = registerShape(PAYROLL_HEADER, PAYROLL_BODY, styleOf([PAYROLL_HEADER, ...PAYROLL_BODY]));
    expect(shape).not.toBeNull();
    expect(shape?.entityAt).toBe(1);
    expect(shape?.amountAt).toEqual([2, 3, 4, 5]);
    // pokok + tunjangan - potongan = bersih, so the rightmost column is what the row settles on.
    expect(shape?.netAt).toBe(5);
  });

  it("leaves a statement alone: one label column and its periods is not a register", () => {
    expect(registerShape(STATEMENT_HEADER, STATEMENT_BODY, styleOf([STATEMENT_HEADER, ...STATEMENT_BODY]))).toBeNull();
  });

  it("leaves a label/value list alone: one amount column is the narrow shape, not a register", () => {
    const header = ["Keterangan", "Jumlah"];
    const body = [
      ["Sewa", "1,000"],
      ["Listrik", "2,000"],
      ["Gaji", "3,000"],
    ];
    expect(registerShape(header, body, styleOf([header, ...body]))).toBeNull();
  });

  it("never reads a 16-digit identifier column as an amount", () => {
    const header = ["Nama", "NIK", "Gaji Pokok", "Gaji Bersih"];
    const body = [
      ["Karyawan 1", "9971010101900001", "8,000,000", "9,200,000"],
      ["Karyawan 2", "9971010101880002", "6,000,000", "6,900,000"],
      ["Karyawan 3", "9971410101950003", "10,000,000", "11,500,000"],
    ];
    const shape = registerShape(header, body, styleOf([header, ...body]));
    expect(shape?.amountAt).toEqual([2, 3]);
  });
});

describe("registerNetAt", () => {
  it("finds the column the others settle into, whatever signs it took to get there", () => {
    const rows = [
      [8_000_000, 1_600_000, 400_000, 9_200_000],
      [6_000_000, 1_200_000, 300_000, 6_900_000],
    ];
    expect(registerNetAt(rows, 4)).toBe(3);
  });

  it("keeps the rightmost column when nothing settles anything", () => {
    expect(
      registerNetAt(
        [
          [10, 20, 31],
          [40, 50, 97],
        ],
        3,
      ),
    ).toBe(2);
  });
});

describe("isRowCounterColumn / isAmountColumn", () => {
  it("knows a row counter from an amount", () => {
    const style = styleOf([PAYROLL_HEADER, ...PAYROLL_BODY]);
    expect(isRowCounterColumn("No", PAYROLL_BODY, 0)).toBe(true);
    expect(isRowCounterColumn("Gaji Pokok", PAYROLL_BODY, 2)).toBe(false);
    expect(isAmountColumn(PAYROLL_BODY, 2, style)).toBe(true);
    expect(isAmountColumn(PAYROLL_BODY, 1, style)).toBe(false);
  });
});

describe("registerSheetPeriod", () => {
  it("takes the one period the sheet's own headings name", () => {
    expect(
      registerSheetPeriod([
        ["Reimbursement Oktober 2024", ""],
        ["TOTAL PEMBAYARAN OKTOBER 2024", "91,995,000"],
      ]),
    ).toBe("Oktober 2024");
  });

  it("says nothing when the sheet names two periods, rather than guessing one", () => {
    expect(
      registerSheetPeriod([
        ["Gaji September 2024", ""],
        ["Gaji Oktober 2024", ""],
      ]),
    ).toBe("");
  });

  it("says nothing when the sheet names none", () => {
    expect(registerSheetPeriod([["Daftar gaji"], ["TOTAL"]])).toBe("");
  });
});

describe("a register sheet written as figures text", () => {
  const sheet = {
    name: "Gaji",
    rows: [
      PAYROLL_HEADER,
      ...PAYROLL_BODY,
      ["Reimbursement Oktober 2024", "", "", "", "", ""],
      ["No", "Nama", "Keterangan", "Jumlah", "", ""],
      ["1", "Karyawan 1", "Perjalanan dinas", "500,000", "", ""],
      ["2", "Karyawan 3", "Pelatihan", "250,000", "", ""],
      ["", "TOTAL REIMBURSEMENT", "", "750,000", "", ""],
    ],
  };

  it("keeps one line per entity, its bottom line as the amount and every column beside it", () => {
    const text = tableToFiguresText(sheet);
    expect(text).toContain(
      "Karyawan 2 (Oktober 2024): 6900000 {Gaji Pokok=6000000; Tunjangan=1200000; Potongan=300000; Gaji Bersih=6900000}",
    );
  });

  it("folds a second block about the same people onto their rows, marked as a separate payment", () => {
    const text = tableToFiguresText(sheet);
    expect(text).toContain("+Reimbursement Oktober 2024=500000}");
    expect(text).toContain("+Reimbursement Oktober 2024=250000}");
    // The folded rows are not rows of their own any more.
    expect(text.split("\n").filter((line) => line.startsWith("Karyawan"))).toHaveLength(3);
  });

  it("keeps every total the sheet printed, tagged so nothing sums them", () => {
    const text = tableToFiguresText(sheet);
    expect(text).toContain(`${DERIVED_TAG} TOTAL GAJI (Oktober 2024): 27600000`);
    expect(text).toContain(`${DERIVED_TAG} TOTAL REIMBURSEMENT (Oktober 2024): 750000`);
  });

  it("writes a statement exactly as it did before", () => {
    const text = tableToFiguresText({ name: "Laba Rugi", rows: [STATEMENT_HEADER, ...STATEMENT_BODY] });
    expect(text.split("\n")).toEqual([
      "Sheet: Laba Rugi",
      "Keterangan | 2023 | 2024",
      "Pendapatan | 1000 | 1200",
      "Beban pokok | 600 | 700",
      `${DERIVED_TAG} Laba kotor | 400 | 500`,
    ]);
  });
});
