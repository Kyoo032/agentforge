import { describe, expect, it } from "vitest";
import { scanPii } from "../security/pii";
import { classifyFinanceHeader, financeHeaderIsAmount } from "./pii-columns";
import { scanFinanceTablePii } from "./pii-scan";
import type { LineItem } from "./types";

/**
 * Every person in this file is invented and every number is made up. `99` is the province code the
 * scanner reserves for fixtures, and the two "real-format" NIKs below belong to nobody.
 */
const PAYROLL_HEADER = [
  "Nama Karyawan",
  "NIK",
  "NPWP",
  "No. Rekening",
  "No. HP",
  "Email",
  "Jabatan",
  "Gaji Pokok",
  "Tunjangan",
  "Total Gaji",
];

const PAYROLL_ROWS: string[][] = [
  PAYROLL_HEADER,
  [
    "Budi Santoso",
    "3273010101900001",
    "09.254.294.3-407.000",
    "1234567890",
    "081234567890",
    "budi@contoh.co.id",
    "Staf",
    "8.500.000",
    "1.500.000",
    "10.000.000",
  ],
  [
    "Siti Aminah",
    "3273014107950123",
    "07.118.552.6-091.000",
    "0987654321",
    "0812-9876-5432",
    "siti@contoh.co.id",
    "Supervisor",
    "12.000.000",
    "2.000.000",
    "14.000.000",
  ],
  [
    "Budi Santoso",
    "3273010101900001",
    "09.254.294.3-407.000",
    "1234567890",
    "081234567890",
    "budi@contoh.co.id",
    "Staf",
    "8.500.000",
    "0",
    "8.500.000",
  ],
];

const SECRETS = [
  "Budi Santoso",
  "Siti Aminah",
  "3273010101900001",
  "3273014107950123",
  "09.254.294.3-407.000",
  "07.118.552.6-091.000",
  "1234567890",
  "0987654321",
  "081234567890",
  "0812-9876-5432",
  "budi@contoh.co.id",
  "siti@contoh.co.id",
];

// ---------------------------------------------------------------------------------------------
// The money table: 200 amounts a real brief is made of. None of them may ever produce a hit.
// ---------------------------------------------------------------------------------------------

function group(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

const MANTISSAS = ["1", "7", "12", "45", "125", "350", "999", "1234", "5678", "87654"];
const EXPONENTS = [3, 5, 7, 9, 11, 13];

/** 60 plain rupiah magnitudes, then the same 60 grouped the Indonesian way and the English way. */
const MAGNITUDES = MANTISSAS.flatMap((mantissa) => EXPONENTS.map((zeros) => `${mantissa}${"0".repeat(zeros)}`));

const DECIMALS = [
  "3.500.000,50",
  "3,500,000.50",
  "1.250,75",
  "1,250.75",
  "12.500,00",
  "12,500.00",
  "0,5",
  "0.5",
  "1.234.567,89",
  "1,234,567.89",
];

/** Sixteen-digit grand totals — the exact length a NIK has, which is why they are pinned here. */
const SIXTEEN_DIGIT = [
  "1250000000000000",
  "9876500000000000",
  "1.250.000.000.000.000",
  "1,250,000,000,000,000",
  "8000000000000000",
];

const YEARS_AND_RATES = ["2024", "2025", "41,6%", "41.6%", "1234567890123456"];

const AMOUNTS = [
  ...MAGNITUDES,
  ...MAGNITUDES.map((value) => group(value, ".")),
  ...MAGNITUDES.map((value) => group(value, ",")),
  ...DECIMALS,
  ...SIXTEEN_DIGIT,
  ...YEARS_AND_RATES,
];

/**
 * How a sheet writes the same figure when it is a cost: accounting brackets, a sign, a currency in
 * front of it or around the bracket. The bracketed form is the one that broke — `(23.960.000.000)`
 * reached the parser as `[phone])` — so every amount above is pinned in every wrapper below too.
 */
const WRAPPERS: ReadonlyArray<(amount: string) => string> = [
  (amount) => `(${amount})`,
  (amount) => `( ${amount} )`,
  (amount) => `-${amount}`,
  (amount) => `+${amount}`,
  (amount) => `Rp ${amount}`,
  (amount) => `Rp (${amount})`,
  (amount) => `(Rp${amount})`,
  (amount) => `USD ${amount}`,
  (amount) => `USD (${amount})`,
  (amount) => `${amount} IDR`,
];

const WRAPPED = AMOUNTS.flatMap((amount) => WRAPPERS.map((wrap) => wrap(amount)));

describe("finance amounts are never masked", () => {
  it("covers 200 realistic amounts, each in ten written forms", () => {
    expect(AMOUNTS).toHaveLength(200);
    expect(WRAPPED).toHaveLength(2000);
  });

  it("produces no hit for a bracketed, signed or currency-wrapped figure either", () => {
    const offenders: Array<{ amount: string; where: string }> = [];
    for (const amount of WRAPPED) {
      if (scanPii(amount).length > 0) {
        offenders.push({ amount, where: "scanPii" });
      }
      const line = `Harga Pokok Penjualan 2024: ${amount}`;
      if (scanFinanceTablePii({ figuresText: line }).redacted !== line) {
        offenders.push({ amount, where: "figuresText" });
      }
      const rows = [
        ["Keterangan", "2024"],
        ["Harga Pokok Penjualan", amount],
      ];
      const table = scanFinanceTablePii({ rows });
      if (table.hits.length > 0 || table.redacted[1]?.[1] !== amount) {
        offenders.push({ amount, where: "rows" });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("produces no hit in the shared scanner, in figures text, or under an amount header", () => {
    const offenders: Array<{ amount: string; where: string }> = [];
    for (const amount of AMOUNTS) {
      if (scanPii(amount).length > 0) {
        offenders.push({ amount, where: "scanPii" });
      }
      for (const line of [`Pendapatan 2024: ${amount}`, `Total: ${amount}`, `Grand total ${amount}`]) {
        if (scanFinanceTablePii({ figuresText: line }).hits.length > 0) {
          offenders.push({ amount, where: line });
        }
      }
      const rows = [
        ["Keterangan", "Jumlah"],
        ["Pendapatan", amount],
      ];
      const table = scanFinanceTablePii({ rows });
      if (table.hits.length > 0 || table.redacted[1]?.[1] !== amount) {
        offenders.push({ amount, where: "rows" });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps a payroll row's own salary columns byte-for-byte", () => {
    const { redacted } = scanFinanceTablePii({ rows: PAYROLL_ROWS });
    expect(redacted[1]?.slice(7)).toEqual(["8.500.000", "1.500.000", "10.000.000"]);
    expect(redacted[2]?.slice(7)).toEqual(["12.000.000", "2.000.000", "14.000.000"]);
    expect(redacted[3]?.slice(7)).toEqual(["8.500.000", "0", "8.500.000"]);
  });
});

// ---------------------------------------------------------------------------------------------
// F: 2024 cost of sales, written `(23.960.000.000)` under a column headed `2024`. No word in that
// header says "money", so the cell fell through to free-text masking and came back `[phone])`.
// ---------------------------------------------------------------------------------------------

const RATIOS_ROWS: string[][] = [
  ["Keterangan", "2024", "2023"],
  ["Pendapatan", "31.240.000.000", "26.180.000.000"],
  ["Harga Pokok Penjualan", "(23.960.000.000)", "(4.025.000.000)"],
  ["Beban Bunga", "(3.310.000.000)", "(2.870.000.000)"],
];

describe("a cell that reads as a figure is never rewritten", () => {
  it("keeps an accounting negative under a period header", () => {
    const { redacted, hits } = scanFinanceTablePii({ rows: RATIOS_ROWS });
    expect(redacted).toEqual(RATIOS_ROWS);
    expect(hits).toEqual([]);
  });

  it("reads every period header shape as a column of figures", () => {
    for (const header of ["2024", "Jan 2024", "Q1 Budget", "Tahun 3", "FY2025", "Periode", "Bulan"]) {
      expect({ header, amount: financeHeaderIsAmount(header) }).toEqual({ header, amount: true });
    }
  });

  it("keeps a figure under a header nobody classified at all", () => {
    const rows = [
      ["Pos", "Catatan"],
      ["Kas", "(1.250.000.000)"],
      ["Piutang", "Rp (23.960.000.000)"],
    ];
    expect(scanFinanceTablePii({ rows }).redacted).toEqual(rows);
  });

  it("still redacts an identifying column whether or not its cells read as figures", () => {
    const rows = [
      ["Nama", "NIK", "No. HP", "2024"],
      ["Budi Santoso", "3273010101900001", "081234567890", "(23.960.000.000)"],
    ];
    const amount = "(23.960.000.000)";
    expect(scanFinanceTablePii({ rows }).redacted[1]).toEqual(["Karyawan 1", "[nik]", "[phone]", amount]);
  });
});

describe("classifyFinanceHeader", () => {
  it("reads the identifying headers", () => {
    expect(classifyFinanceHeader("Nama Karyawan")).toBe("name");
    expect(classifyFinanceHeader("Employee Name")).toBe("name");
    expect(classifyFinanceHeader("Penerima")).toBe("name");
    expect(classifyFinanceHeader("Payee")).toBe("name");
    expect(classifyFinanceHeader("NIK")).toBe("nik");
    expect(classifyFinanceHeader("Nomor Pokok Wajib Pajak")).toBe("npwp");
    expect(classifyFinanceHeader("No. Rekening")).toBe("account");
    expect(classifyFinanceHeader("No. HP")).toBe("phone");
    expect(classifyFinanceHeader("Email")).toBe("email");
  });

  it("never calls a money column identifying", () => {
    for (const header of ["Gaji Karyawan", "Total Gaji", "Jumlah", "Amount", "Saldo Rekening", "Nilai"]) {
      expect({ header, kind: classifyFinanceHeader(header) }).toEqual({ header, kind: null });
      expect(financeHeaderIsAmount(header)).toBe(true);
    }
  });

  it("leaves a ledger's own label column alone", () => {
    for (const header of ["Nama Akun", "Account Name", "Nama Barang", "Keterangan", "Nama Proyek"]) {
      expect({ header, kind: classifyFinanceHeader(header) }).toEqual({ header, kind: null });
    }
  });

  it("reads a bank NAME column as a label and a bank NUMBER column as an account", () => {
    for (const header of ["Bank", "Nama Bank", "Bank Tujuan", "Bank Name"]) {
      expect({ header, kind: classifyFinanceHeader(header) }).toEqual({ header, kind: null });
    }
    for (const header of ["No. Rekening", "Bank Account", "Bank No.", "Nomor Rekening", "A/C"]) {
      expect({ header, kind: classifyFinanceHeader(header) }).toEqual({ header, kind: "account" });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Two tables on one sheet. Column D is the tax number above and the reimbursement amount below, so
// reading the whole sheet through the first header masked real money as `[npwp]`.
// ---------------------------------------------------------------------------------------------

/** Invented people, invented banks, invented numbers; `99` is the fixture province code again. */
const TWO_BLOCK_ROWS: string[][] = [
  ["No", "Nama Karyawan", "NPWP", "Bank", "No. Rekening", "Gaji Pokok", "Gaji Bersih"],
  ["1", "Dewi Anggraini", "09.999.888.7-999.001", "Bank Nusantara", "9000-1234-0001", "8.500.000", "9.775.000"],
  ["2", "Andi Kurniawan", "09.999.888.7-999.004", "Bank Cakrawala Timur", "9000-5678-0004", "9.250.000", "10.637.500"],
  ["3", "Nadia Puspita", "09.999.888.7-999.007", "Bank Cakrawala Timur", "9000-5678-0007", "10.800.000", "12.420.000"],
  ["", "TOTAL GAJI", "", "", "", "28.550.000", "32.832.500"],
  ["Reimbursement Oktober 2024", "", "", "", "", "", ""],
  ["No", "Nama Karyawan", "Keterangan", "Jumlah", "", "", ""],
  ["1", "Dewi Anggraini", "Perjalanan dinas Surabaya", "1.250.000", "", "", ""],
  ["2", "Andi Kurniawan", "Pembelian perlengkapan gudang", "2.480.000", "", "", ""],
  ["3", "Nadia Puspita", "Biaya pelatihan eksternal", "980.000", "", "", ""],
  ["", "TOTAL REIMBURSEMENT", "", "4.710.000", "", "", ""],
];

const TWO_BLOCK_SECRETS = [
  "Dewi Anggraini",
  "Andi Kurniawan",
  "Nadia Puspita",
  "09.999.888.7-999.001",
  "09.999.888.7-999.004",
  "09.999.888.7-999.007",
  "9000-1234-0001",
  "9000-5678-0004",
  "9000-5678-0007",
];

describe("scanFinanceTablePii(rows) classifies each block on its own header", () => {
  it("keeps every amount of the second block, whatever the first block called that column", () => {
    const { redacted } = scanFinanceTablePii({ rows: TWO_BLOCK_ROWS });
    expect(redacted[7]).toEqual(["1", "Karyawan 1", "Perjalanan dinas Surabaya", "1.250.000", "", "", ""]);
    expect(redacted[8]?.[3]).toBe("2.480.000");
    expect(redacted[9]?.[3]).toBe("980.000");
    expect(redacted[10]?.[3]).toBe("4.710.000");
  });

  it("never redacts a header cell, in either block", () => {
    const { redacted } = scanFinanceTablePii({ rows: TWO_BLOCK_ROWS });
    expect(redacted[0]).toEqual(TWO_BLOCK_ROWS[0]);
    expect(redacted[6]).toEqual(TWO_BLOCK_ROWS[6]);
  });

  it("gives the same person the same pseudonym in both blocks", () => {
    const { redacted } = scanFinanceTablePii({ rows: TWO_BLOCK_ROWS });
    expect(redacted.slice(1, 4).map((row) => row[1])).toEqual(["Karyawan 1", "Karyawan 2", "Karyawan 3"]);
    expect(redacted.slice(7, 10).map((row) => row[1])).toEqual(["Karyawan 1", "Karyawan 2", "Karyawan 3"]);
  });

  it("masks the account number but leaves the bank's name, and keeps a row's own total label", () => {
    const { redacted } = scanFinanceTablePii({ rows: TWO_BLOCK_ROWS });
    expect(redacted[1]?.slice(2, 5)).toEqual(["[npwp]", "Bank Nusantara", "[account]"]);
    expect(redacted[4]?.[1]).toBe("TOTAL GAJI");
    expect(redacted[10]?.[1]).toBe("TOTAL REIMBURSEMENT");
  });

  it("leaves nothing of the originals anywhere in the scan", () => {
    const scanned = scanFinanceTablePii({ rows: TWO_BLOCK_ROWS });
    const serialized = JSON.stringify(scanned);
    for (const secret of TWO_BLOCK_SECRETS) {
      expect({ secret, leaked: serialized.includes(secret) }).toEqual({ secret, leaked: false });
    }
  });

  it("keeps every figure on the sheet, so the totals still add up after redaction", () => {
    const { redacted } = scanFinanceTablePii({ rows: TWO_BLOCK_ROWS });
    const amounts = redacted.flatMap((row) => row.filter((cell) => /^\d[\d.]*$/.test(cell) && cell.includes(".")));
    const before = TWO_BLOCK_ROWS.flatMap((row) => row.filter((cell) => /^\d[\d.]*$/.test(cell) && cell.includes(".")));
    expect(amounts).toEqual(before);
  });
});

describe("scanFinanceTablePii(rows)", () => {
  it("catches every kind in the payroll fixture", () => {
    const { hits } = scanFinanceTablePii({ rows: PAYROLL_ROWS });
    expect([...new Set(hits.map((hit) => hit.kind))].sort()).toEqual([
      "account",
      "email",
      "name",
      "nik",
      "npwp",
      "phone",
    ]);
  });

  it("redacts identifying columns wholesale and leaves nothing of the originals", () => {
    const { redacted, hits } = scanFinanceTablePii({ rows: PAYROLL_ROWS });
    const serialized = JSON.stringify({ redacted, hits });
    for (const secret of SECRETS) {
      expect({ secret, leaked: serialized.includes(secret) }).toEqual({ secret, leaked: false });
    }
    expect(redacted[1]?.slice(1, 7)).toEqual([
      "[nik]",
      "[npwp]",
      "[account]",
      "[phone]",
      "[email]",
      "Staf",
    ]);
  });

  it("gives each person a stable pseudonym so their rows still add up", () => {
    const { redacted } = scanFinanceTablePii({ rows: PAYROLL_ROWS });
    expect(redacted[0]?.[0]).toBe("Nama Karyawan");
    expect(redacted[1]?.[0]).toBe("Karyawan 1");
    expect(redacted[2]?.[0]).toBe("Karyawan 2");
    expect(redacted[3]?.[0]).toBe("Karyawan 1");
  });

  it("does not mutate the rows it was given", () => {
    const before = JSON.stringify(PAYROLL_ROWS);
    scanFinanceTablePii({ rows: PAYROLL_ROWS });
    expect(JSON.stringify(PAYROLL_ROWS)).toBe(before);
  });

  it("reports where a hit was, never what it said", () => {
    const { hits } = scanFinanceTablePii({ rows: PAYROLL_ROWS });
    const nik = hits.find((hit) => hit.kind === "nik");
    expect(nik?.cell).toEqual({ row: 1, column: 1, header: "NIK" });
    expect(nik?.preview).toBe("[nik]");
  });
});

describe("scanFinanceTablePii(figuresText)", () => {
  it("reads a pipe table with the same column rules and keeps the preamble line", () => {
    const text = [
      "Sheet: Payroll",
      "Nama | NIK | Gaji Pokok | Total",
      "Budi Santoso | 3273010101900001 | 8500000 | 10000000",
      "Siti Aminah | 3273014107950123 | 12000000 | 14000000",
    ].join("\n");
    const { redacted, hits } = scanFinanceTablePii({ figuresText: text });
    expect(redacted.split("\n")[0]).toBe("Sheet: Payroll");
    expect(redacted).toContain("Karyawan 1 | [nik] | 8500000 | 10000000");
    expect(redacted).toContain("Karyawan 2 | [nik] | 12000000 | 14000000");
    expect(redacted).not.toContain("Budi");
    expect(hits.some((hit) => hit.kind === "name")).toBe(true);
  });

  it("redacts a labelled line but never a labelled amount", () => {
    expect(scanFinanceTablePii({ figuresText: "Nama karyawan: Budi Santoso" }).redacted).toBe(
      "Nama karyawan: [name]",
    );
    // The label says "karyawan" and the value is money: the digits stay, because they are the brief.
    expect(scanFinanceTablePii({ figuresText: "Karyawan 1 (Jan): 12000000" }).redacted).toBe(
      "Karyawan 1 (Jan): 12000000",
    );
    expect(scanFinanceTablePii({ figuresText: "Penerima: 5000000" }).redacted).toBe("Penerima: 5000000");
  });

  it("leaves a pipe row's figures alone and scans only its label", () => {
    const text = [
      "Keterangan | 2024 | 2023",
      "Harga Pokok Penjualan | (23.960.000.000) | (4.025.000.000)",
      "Beban Bunga | (3.310.000.000) | (2.870.000.000)",
    ].join("\n");
    const { redacted, hits } = scanFinanceTablePii({ figuresText: text });
    expect(redacted).toBe(text);
    expect(hits).toEqual([]);
  });

  it("leaves a labelled figure alone and scans only the words before the colon", () => {
    for (const line of [
      "Harga Pokok Penjualan 2024: (23.960.000.000)",
      "Beban Bunga 2024: -3.310.000.000",
      "Kas: Rp (1.250.000.000)",
      "(23.960.000.000)",
    ]) {
      expect({ line, redacted: scanFinanceTablePii({ figuresText: line }).redacted }).toEqual({
        line,
        redacted: line,
      });
    }
  });

  it("still reads the label of a line whose value is a figure", () => {
    expect(scanFinanceTablePii({ figuresText: "Gaji budi@contoh.co.id: (8.500.000)" }).redacted).toBe(
      "Gaji [email]: (8.500.000)",
    );
  });

  it("masks free-text identifiers the shared scanner already knows", () => {
    const { redacted } = scanFinanceTablePii({
      figuresText: "Transfer ke budi@contoh.co.id, No. Rekening: 1234567890, HP 081234567890",
    });
    expect(redacted).toBe("Transfer ke [email], No. Rekening: [account], HP [phone]");
  });
});

describe("scanFinanceTablePii(lineItems)", () => {
  const items: LineItem[] = [
    { label: "Gaji Karyawan 1 (081234567890)", period: "Jan 2025", amount: 8500000, currency: "IDR", category: "opex" },
    { label: "Pendapatan", period: "2025", amount: 1250000000, currency: "IDR", category: "revenue" },
  ];

  it("masks labels and leaves every amount untouched", () => {
    const { redacted, hits } = scanFinanceTablePii({ lineItems: items });
    expect(redacted[0]?.label).toBe("Gaji Karyawan 1 ([phone])");
    expect(redacted[0]?.amount).toBe(8500000);
    expect(redacted[1]).toBe(items[1]);
    expect(hits.map((hit) => hit.kind)).toEqual(["phone"]);
  });

  it("does not mutate the items it was given", () => {
    const before = JSON.stringify(items);
    scanFinanceTablePii({ lineItems: items });
    expect(JSON.stringify(items)).toBe(before);
  });
});
