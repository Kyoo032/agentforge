import { describe, expect, it, vi } from "vitest";
import type { FinanceSheet, LineItem } from "@agentforge/core/finance";
import {
  EMPTY_FINANCE_PII,
  FINANCE_PII_SAMPLE_MAX,
  guardFinanceInput,
  mergeFinancePii,
  redactFinanceRows,
  redactFinanceSheets,
  restoreFinanceAmounts,
} from "./finance-privacy";

/**
 * A deliberately over-eager masker, off unless a test turns it on. It eats an accounting negative
 * exactly the way the phone pattern used to — `(23.960.000.000)` out, `[phone])` in, and a hit
 * claimed for the figure it just destroyed — so the guard's safety net is tested against the real
 * failure rather than against a description of it.
 */
const overEager = vi.hoisted(() => ({ on: false }));

vi.mock("@agentforge/core/finance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentforge/core/finance")>();
  return {
    ...actual,
    scanFinanceTablePii: (input: { rows: string[][] }) => {
      const scanned = actual.scanFinanceTablePii(input);
      if (!overEager.on || !("rows" in input)) {
        return scanned;
      }
      const eaten: Array<{ row: number; column: number }> = [];
      const redacted = scanned.redacted.map((row, rowIndex) =>
        row.map((cell, column) => {
          if (!cell.startsWith("(")) {
            return cell;
          }
          eaten.push({ row: rowIndex, column });
          return "[phone])";
        }),
      );
      const hits = eaten.map(({ row, column }) => ({
        kind: "phone" as const,
        cell: { row, column, header: "" },
        preview: "[phone])",
      }));
      return { hits: [...scanned.hits, ...hits], redacted };
    },
  };
});

/** Invented people, invented numbers. `99` is the province code the scanner reserves for fixtures. */
const PAYROLL: FinanceSheet = {
  name: "Gaji Januari",
  rows: [
    ["Nama Karyawan", "NIK", "No. Rekening", "No. HP", "Email", "Gaji Pokok", "Total Gaji"],
    [
      "Budi Santoso",
      "3273010101900001",
      "1234567890",
      "081234567890",
      "budi@contoh.co.id",
      "8500000",
      "10000000",
    ],
    [
      "Siti Aminah",
      "9901011505880042",
      "0987654321",
      "0812-9876-5432",
      "siti@contoh.co.id",
      "12000000",
      "14000000",
    ],
  ],
};

const RAW = [
  "Budi Santoso",
  "Siti Aminah",
  "3273010101900001",
  "9901011505880042",
  "1234567890",
  "0987654321",
  "081234567890",
  "budi@contoh.co.id",
  "siti@contoh.co.id",
];

function leaked(value: string): string[] {
  return RAW.filter((secret) => value.includes(secret));
}

describe("guardFinanceInput(sheet)", () => {
  it("answers figures text written from the redacted rows, not the originals", () => {
    const guarded = guardFinanceInput({ sheet: PAYROLL });
    expect(leaked(guarded.figuresText)).toEqual([]);
    expect(guarded.figuresText).toContain("Karyawan 1");
    expect(guarded.figuresText).toContain("Karyawan 2");
  });

  it("keeps every salary figure exactly as the sheet wrote it", () => {
    const { figuresText, sheet } = guardFinanceInput({ sheet: PAYROLL });
    expect(sheet.rows[1]?.slice(5)).toEqual(["8500000", "10000000"]);
    expect(sheet.rows[2]?.slice(5)).toEqual(["12000000", "14000000"]);
    expect(sheet.name).toBe("Gaji Januari");
    // Redaction also fixes which column reads as the amount: before it, the NIK, the account number
    // and the phone were all "numeric" columns competing with the salary for the value slot.
    expect(figuresText).toBe(["Sheet: Gaji Januari", "Karyawan 1: 10000000", "Karyawan 2: 14000000"].join("\n"));
  });

  it("summarises what it hid without repeating any of it", () => {
    const { pii } = guardFinanceInput({ sheet: PAYROLL });
    expect(pii.count).toBe(10);
    expect([...pii.kinds].sort()).toEqual(["account", "email", "name", "nik", "phone"]);
    expect(pii.samples.length).toBeLessThanOrEqual(FINANCE_PII_SAMPLE_MAX);
    expect(leaked(pii.samples.join(" "))).toEqual([]);
  });

  it("does not mutate the sheet it was given", () => {
    const before = JSON.stringify(PAYROLL);
    guardFinanceInput({ sheet: PAYROLL });
    expect(JSON.stringify(PAYROLL)).toBe(before);
  });
});

/**
 * The shape a real payroll file has: a reimbursement list under the payroll run, with its own header
 * and its own columns. Column 3 is the tax number above and the reimbursement amount below, which is
 * exactly the cell the old first-row-only classifier masked as `[npwp]`.
 */
const TWO_BLOCKS: FinanceSheet = {
  name: "Gaji Oktober",
  rows: [
    ["No", "Nama Karyawan", "NPWP", "Gaji Pokok", "Gaji Bersih"],
    ["1", "Dewi Anggraini", "09.999.888.7-999.001", "8500000", "9775000"],
    ["2", "Andi Kurniawan", "09.999.888.7-999.004", "9250000", "10637500"],
    ["", "TOTAL GAJI", "", "17750000", "20412500"],
    ["Reimbursement Oktober", "", "", "", ""],
    ["No", "Nama Karyawan", "Keterangan", "Jumlah", ""],
    ["1", "Dewi Anggraini", "Perjalanan dinas", "1250000", ""],
    ["2", "Andi Kurniawan", "Perlengkapan gudang", "2480000", ""],
    ["", "TOTAL REIMBURSEMENT", "", "3730000", ""],
  ],
};

describe("guardFinanceInput(sheet) reads each block on its own header", () => {
  it("keeps the second block's amounts instead of masking them as the first block's tax column", () => {
    const { figuresText, sheet } = guardFinanceInput({ sheet: TWO_BLOCKS });
    expect(sheet.rows[6]).toEqual(["1", "Karyawan 1", "Perjalanan dinas", "1250000", ""]);
    expect(sheet.rows[7]?.[3]).toBe("2480000");
    // Both blocks are about the same two people, so the reimbursement is a payment ON their row
    // rather than two more rows: `+` says it adds to what each of them was actually paid.
    expect(figuresText).toContain("+Reimbursement Oktober=1250000");
    expect(figuresText).toContain("+Reimbursement Oktober=2480000");
  });

  it("leaves both header rows and every total label as written", () => {
    const { sheet, figuresText } = guardFinanceInput({ sheet: TWO_BLOCKS });
    expect(sheet.rows[0]).toEqual(TWO_BLOCKS.rows[0]);
    expect(sheet.rows[5]).toEqual(TWO_BLOCKS.rows[5]);
    expect(figuresText).toContain("TOTAL GAJI: 20412500");
    expect(figuresText).toContain("TOTAL REIMBURSEMENT: 3730000");
  });

  it("gives a person who reappears further down the sheet the same pseudonym", () => {
    const { sheet, pii } = guardFinanceInput({ sheet: TWO_BLOCKS });
    expect(sheet.rows.map((row) => row[1])).toEqual([
      "Nama Karyawan",
      "Karyawan 1",
      "Karyawan 2",
      "TOTAL GAJI",
      "",
      "Nama Karyawan",
      "Karyawan 1",
      "Karyawan 2",
      "TOTAL REIMBURSEMENT",
    ]);
    expect([...pii.kinds].sort()).toEqual(["name", "npwp"]);
    for (const secret of ["Dewi Anggraini", "Andi Kurniawan", "09.999.888.7-999.001", "09.999.888.7-999.004"]) {
      expect({ secret, leaked: JSON.stringify(sheet.rows).includes(secret) }).toEqual({ secret, leaked: false });
    }
  });

  it("drops no column of a register, so there is nothing left to warn about", () => {
    const { warnings, figuresText } = guardFinanceInput({ sheet: TWO_BLOCKS });
    // `Gaji Pokok` used to be dropped on the floor beside `Gaji Bersih`; both are on the row now.
    expect(warnings).toEqual([]);
    expect(figuresText).toContain("Gaji Pokok=8500000");
    expect(figuresText).toContain("Gaji Bersih=9775000");
    // The tax number is still redacted rather than carried out as one of the row's figures.
    expect(figuresText).not.toContain("NPWP=");
  });

  it("reports no warnings for a sheet the reader kept whole", () => {
    const { warnings } = guardFinanceInput({
      sheet: { name: "Ringkas", rows: [["Label", "2024"], ["Pendapatan", "1250000000"], ["HPP", "730000000"]] },
    });
    expect(warnings).toEqual([]);
  });
});

describe("guardFinanceInput(figuresText)", () => {
  it("redacts a pasted payroll block and leaves the amounts", () => {
    const guarded = guardFinanceInput({
      figuresText: "Nama: Budi Santoso\nNIK: 3273010101900001\nGaji Januari: 8500000",
    });
    expect(guarded.figuresText).toBe("Nama: [name]\nNIK: [nik]\nGaji Januari: 8500000");
    expect(guarded.pii.count).toBe(2);
  });

  it("reports nothing for a clean block of figures", () => {
    const guarded = guardFinanceInput({ figuresText: "Pendapatan 2024: 1.250.000.000\nCOGS 2024: 730.000.000" });
    expect(guarded.pii).toEqual(EMPTY_FINANCE_PII);
    expect(guarded.figuresText).toContain("1.250.000.000");
  });
});

describe("guardFinanceInput(lineItems)", () => {
  const items: LineItem[] = [
    { label: "Gaji (081234567890)", period: "Jan 2025", amount: 8500000, currency: "IDR", category: "opex" },
    { label: "Pendapatan", period: "2025", amount: 1250000000, currency: "IDR", category: "revenue" },
  ];

  it("redacts labels and never an amount", () => {
    const guarded = guardFinanceInput({ lineItems: items });
    expect(guarded.lineItems[0]?.label).toBe("Gaji ([phone])");
    expect(guarded.lineItems.map((item) => item.amount)).toEqual([8500000, 1250000000]);
    expect(guarded.pii.kinds).toEqual(["phone"]);
  });
});

describe("summaries and previews", () => {
  it("merges two guarded inputs into one count", () => {
    const left = { count: 2, kinds: ["nik" as const], samples: ["[nik]"] };
    const right = { count: 3, kinds: ["name" as const], samples: ["Karyawan 1"] };
    expect(mergeFinancePii(left, right)).toEqual({
      count: 5,
      kinds: ["nik", "name"],
      samples: ["[nik]", "Karyawan 1"],
    });
    expect(mergeFinancePii(left, EMPTY_FINANCE_PII)).toBe(left);
    expect(mergeFinancePii(EMPTY_FINANCE_PII, right)).toBe(right);
  });

  it("redacts preview rows and every sheet in the picker", () => {
    expect(leaked(JSON.stringify(redactFinanceRows(PAYROLL.rows)))).toEqual([]);
    expect(leaked(JSON.stringify(redactFinanceSheets([PAYROLL])))).toEqual([]);
    expect(redactFinanceSheets([PAYROLL])[0]?.name).toBe("Gaji Januari");
  });
});

/**
 * The safety net. F: 2024 cost of sales, written `(23.960.000.000)` under a column headed `2024`,
 * reached the parser as `[phone])` and every ratio built on it was wrong. The pattern that did it is
 * fixed; this is the rule that makes the next one survivable — a figure that goes missing between
 * the sheet and its redacted copy is put back, in any column nobody named as an identifier.
 */
const RATIOS: FinanceSheet = {
  name: "Laba Rugi",
  rows: [
    ["Keterangan", "2024", "2023"],
    ["Pendapatan", "31.240.000.000", "26.180.000.000"],
    ["Harga Pokok Penjualan", "(23.960.000.000)", "(4.025.000.000)"],
  ],
};

describe("restoreFinanceAmounts", () => {
  it("puts back every cell whose figure did not survive redaction", () => {
    const eaten = RATIOS.rows.map((row) => row.map((cell) => (cell.startsWith("(") ? "[phone])" : cell)));
    const healed = restoreFinanceAmounts(RATIOS.rows, eaten);
    expect(healed.rows[2]).toEqual(["Harga Pokok Penjualan", "(23.960.000.000)", "(4.025.000.000)"]);
    expect(healed.restored).toEqual([
      { row: 2, column: 1 },
      { row: 2, column: 2 },
    ]);
  });

  it("leaves an identifying column redacted, whether or not its cells read as figures", () => {
    const rows = [
      ["Nama", "NIK", "No. Rekening", "2024"],
      ["Budi Santoso", "3273010101900001", "1234567890", "1250000000"],
    ];
    const redacted = [
      ["Nama", "NIK", "No. Rekening", "2024"],
      ["Karyawan 1", "[nik]", "[account]", "1250000000"],
    ];
    const healed = restoreFinanceAmounts(rows, redacted);
    expect(healed.rows).toEqual(redacted);
    expect(healed.restored).toEqual([]);
  });

  it("restores nothing when the figure is the same number written another way", () => {
    const rows = [
      ["Label", "2024"],
      ["Kas", "Rp 1.250.000"],
    ];
    const healed = restoreFinanceAmounts(rows, [
      ["Label", "2024"],
      ["Kas", "1250000"],
    ]);
    expect(healed.restored).toEqual([]);
  });
});

describe("guardFinanceInput heals a masker that eats figures", () => {
  it("restores the figures, warns with a count, and never repeats the value", () => {
    overEager.on = true;
    try {
      const guarded = guardFinanceInput({ sheet: RATIOS });
      expect(guarded.sheet.rows[2]).toEqual(["Harga Pokok Penjualan", "(23.960.000.000)", "(4.025.000.000)"]);
      expect(guarded.figuresText).toContain("23960000000");
      expect(guarded.figuresText).not.toContain("[phone]");
      const restored = guarded.warnings.filter((warning) => warning.code === "pii_amount_restored");
      expect(restored).toHaveLength(1);
      expect(restored[0]?.detail).toEqual(["2 cells"]);
      expect(JSON.stringify(restored)).not.toContain("23.960");
      // The scanner claimed two identifiers it did not get to keep, so neither is counted.
      expect(guarded.pii).toEqual(EMPTY_FINANCE_PII);
    } finally {
      overEager.on = false;
    }
  });

  it("warns about nothing when redaction kept every figure", () => {
    const guarded = guardFinanceInput({ sheet: RATIOS });
    expect(guarded.warnings.map((warning) => warning.code)).not.toContain("pii_amount_restored");
    expect(guarded.figuresText).toContain("23960000000");
  });
});

describe("there is no way to turn the guard off", () => {
  it("takes no options at all", () => {
    // The signature is the proof: no flag, no settings read, no `injectionGuardBypass` path.
    expect(guardFinanceInput.length).toBe(1);
    expect(guardFinanceInput({ figuresText: "NIK: 3273010101900001" }).figuresText).toBe("NIK: [nik]");
  });
});
