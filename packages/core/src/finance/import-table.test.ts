import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { writeWorkbook } from "../tabular/xlsx-write";
import {
  DERIVED_TAG,
  FINANCE_FIGURES_TEXT_MAX,
  FINANCE_IMPORT_MAX_BYTES,
  FINANCE_IMPORT_MAX_CELL_CHARS,
  FINANCE_IMPORT_MAX_COLS,
  FINANCE_IMPORT_MAX_ROWS,
  FinanceImportError,
  financeFiguresFromSheet,
  financeImportExtension,
  financePeriodColumns,
  financePeriodHeaders,
  financeWorkbookKind,
  isCurrencyCode,
  isDerivedLabel,
  isPeriodLabel,
  normalizeAmount,
  ordinalPeriod,
  readFinanceTable,
  sheetNumberStyle,
  sheetPointStyle,
  tableToFiguresText,
} from "./import-table";

const BOM = "﻿";

function csv(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof FinanceImportError ? error.code : `not-a-FinanceImportError:${String(error)}`;
  }
  return "no-throw";
}

describe("financeImportExtension", () => {
  it("accepts the three spreadsheet extensions, case-insensitively", () => {
    expect(financeImportExtension("budget.CSV")).toBe(".csv");
    expect(financeImportExtension("Q3 actuals.xlsx")).toBe(".xlsx");
    expect(financeImportExtension("legacy.xls")).toBe(".xls");
  });

  it("rejects anything else, including a double extension that only starts with a table type", () => {
    expect(financeImportExtension("figures.pdf")).toBeNull();
    expect(financeImportExtension("figures.csv.exe")).toBeNull();
    expect(financeImportExtension("csv")).toBeNull();
    expect(financeImportExtension("")).toBeNull();
  });
});

describe("financeWorkbookKind", () => {
  it("tells a zip container from an OLE compound file and from plain text", () => {
    expect(financeWorkbookKind(writeWorkbook([{ name: "S", rows: [["a"], ["1"]] }]))).toBe("zip");
    expect(financeWorkbookKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toBe("cfb");
    expect(financeWorkbookKind(csv("label,amount\n"))).toBeNull();
  });
});

describe("readFinanceTable - csv", () => {
  it("reads a BOM-prefixed comma file into one sheet named after the file", () => {
    const file = readFinanceTable(csv(`${BOM}Label,Amount\nRevenue,120000\nRent,-12000\n`), "Q3 figures.csv");
    expect(file.sheets).toHaveLength(1);
    expect(file.sheets[0]?.name).toBe("Q3 figures");
    expect(file.sheets[0]?.rows).toEqual([
      ["Label", "Amount"],
      ["Revenue", "120000"],
      ["Rent", "-12000"],
    ]);
  });

  it("sniffs a semicolon file and keeps Indonesian amounts as written", () => {
    const file = readFinanceTable(csv("Label;Jumlah\nPendapatan;Rp 1.250.000,50\nSewa;(750.000)\n"), "anggaran.csv");
    expect(file.sheets[0]?.rows).toEqual([
      ["Label", "Jumlah"],
      ["Pendapatan", "Rp 1.250.000,50"],
      ["Sewa", "(750.000)"],
    ]);
  });

  it("drops empty rows, empty columns and the merged title rows above the header", () => {
    const file = readFinanceTable(
      csv("PT Toko Token,,\nMonthly figures,,\n,,\nLabel,,Amount\nRevenue,,120000\n,,\nRent,,-12000\n"),
      "junk.csv",
    );
    expect(file.sheets[0]?.rows).toEqual([
      ["Label", "Amount"],
      ["Revenue", "120000"],
      ["Rent", "-12000"],
    ]);
  });

  it("strips control characters and caps a very long cell", () => {
    const long = "x".repeat(FINANCE_IMPORT_MAX_CELL_CHARS + 50);
    const file = readFinanceTable(csv(`Label,Amount\n"Rent ${long}",1000\n`), "long.csv");
    const cell = file.sheets[0]?.rows[1]?.[0] ?? "";
    expect(cell.length).toBeLessThanOrEqual(FINANCE_IMPORT_MAX_CELL_CHARS);
    expect(cell).not.toContain("");
    expect(cell.startsWith("Rent")).toBe(true);
  });

  it("refuses a csv whose bytes are a container, a file over the byte cap and a file with no rows", () => {
    expect(codeOf(() => readFinanceTable(writeWorkbook([{ name: "S", rows: [["a"], ["1"]] }]), "sneaky.csv"))).toBe(
      "unsupported_type",
    );
    expect(codeOf(() => readFinanceTable(new Uint8Array(FINANCE_IMPORT_MAX_BYTES + 1), "big.csv"))).toBe("too_large");
    expect(codeOf(() => readFinanceTable(csv("\n \n"), "blank.csv"))).toBe("empty");
    expect(codeOf(() => readFinanceTable(csv("Label,Amount\n"), "header-only.csv"))).toBe("empty");
  });

  it("refuses a sheet with more rows or columns than the caps allow", () => {
    const wide = [...Array(FINANCE_IMPORT_MAX_COLS + 1).keys()].map(String).join(",");
    expect(codeOf(() => readFinanceTable(csv(`${wide}\n${wide}\n`), "wide.csv"))).toBe("too_large");
    const tall = `Label,Amount\n${"Rent,1\n".repeat(FINANCE_IMPORT_MAX_ROWS + 1)}`;
    expect(codeOf(() => readFinanceTable(csv(tall), "tall.csv"))).toBe("too_large");
  });
});

describe("readFinanceTable - workbooks", () => {
  it("reads every sheet of an .xlsx with its tab name", () => {
    const bytes = writeWorkbook([
      {
        name: "Summary",
        rows: [
          ["Label", "Amount"],
          ["Revenue", 120000],
        ],
      },
      {
        name: "Budget",
        rows: [
          ["Label", "Plan"],
          ["Rent", 12000],
        ],
      },
    ]);
    const file = readFinanceTable(bytes, "book.xlsx");
    expect(file.sheets.map((sheet) => sheet.name)).toEqual(["Summary", "Budget"]);
    expect(file.sheets[1]?.rows[1]).toEqual(["Rent", "12000"]);
  });

  it("reads the cached value of a formula cell and never the formula itself", () => {
    const worksheet: XLSX.WorkSheet = {
      "!ref": "A1:B3",
      A1: { t: "s", v: "Label" },
      B1: { t: "s", v: "Amount" },
      A2: { t: "s", v: "Revenue" },
      B2: { t: "n", v: 120000 },
      A3: { t: "s", v: "Total" },
      B3: { t: "n", v: 120000, f: "SUM(B2:B2)" },
    };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, worksheet, "Calc");
    const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
    const rows = readFinanceTable(bytes, "calc.xlsx").sheets[0]?.rows ?? [];
    expect(rows[2]).toEqual(["Total", "120000"]);
    expect(JSON.stringify(rows)).not.toContain("SUM");
  });

  it("refuses a workbook extension whose bytes are not a container or cannot be opened", () => {
    expect(codeOf(() => readFinanceTable(csv("Label,Amount\nRent,1\n"), "renamed.xlsx"))).toBe("unsupported_type");
    expect(codeOf(() => readFinanceTable(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), "broken.xlsx"))).toBe(
      "unreadable",
    );
  });

  it("refuses an unknown extension before it looks at the bytes", () => {
    expect(codeOf(() => readFinanceTable(csv("Label,Amount\nRent,1\n"), "figures.txt"))).toBe("unsupported_type");
  });
});

describe("isPeriodLabel / financePeriodColumns", () => {
  it("knows English and Indonesian month names, quarters and years", () => {
    for (const label of ["Jan", "Feb 2024", "Mei", "Agu", "Des-24", "Q1", "Q4 2023", "TW2", "2023", "FY2024"]) {
      expect(isPeriodLabel(label)).toBe(true);
    }
  });

  it("does not take a label, an amount or a plain word as a period", () => {
    for (const label of ["Label", "Amount", "Revenue", "Jumlah", "120000", "12.5", "Marketing", "Management"]) {
      expect(isPeriodLabel(label)).toBe(false);
    }
  });

  it("returns the indexes of the period columns in a header row", () => {
    expect(financePeriodColumns(["Label", "Jan", "Feb", "Mar", "Total"])).toEqual([1, 2, 3]);
    expect(financePeriodColumns(["Label", "Amount"])).toEqual([]);
  });
});

describe("sheetPointStyle", () => {
  it("reads the sheet as point-thousands once any cell can only be written that way", () => {
    expect(sheetPointStyle([["Rp 1.250.000,50"], ["750.000"]])).toBe("thousands");
    expect(sheetPointStyle([["12,5"], ["300"]])).toBe("thousands");
  });

  it("keeps the decimal point when the sheet writes decimals or comma thousands", () => {
    expect(sheetPointStyle([["1,250.75"], ["12.500"]])).toBe("decimal");
    expect(sheetPointStyle([["12.5"], ["120.000"]])).toBe("decimal");
    expect(sheetPointStyle([["0.250"], ["0.500"]])).toBe("decimal");
  });

  it("falls back to thousands for a bare three-digit group, which money never writes as decimals", () => {
    expect(sheetPointStyle([["120.000"], ["130.000"]])).toBe("thousands");
    expect(
      sheetPointStyle([
        ["Label", "Amount"],
        ["Rent", "1200"],
      ]),
    ).toBe("decimal");
  });
});

describe("normalizeAmount", () => {
  it("only reads a bare point group as thousands when the sheet says so", () => {
    expect(normalizeAmount("120.000", "thousands")).toBe("120000");
    expect(normalizeAmount("120.000", "decimal")).toBe("120");
    expect(normalizeAmount("Rp 1.250", "decimal")).toBe("Rp 1250");
    expect(normalizeAmount("IDR 1.250", "decimal")).toBe("IDR 1250");
    expect(normalizeAmount("USD 1,250.50", "decimal")).toBe("USD 1250.5");
    expect(normalizeAmount("Rent", "thousands")).toBeNull();
    expect(normalizeAmount("", "thousands")).toBeNull();
  });
});

describe("tableToFiguresText", () => {
  it("keeps a decimal point a decimal when the sheet writes numbers the English way", () => {
    const text = tableToFiguresText({
      name: "US",
      rows: [
        ["Label", "Amount"],
        ["Revenue", "1,250.75"],
        ["Rent", "12.500"],
      ],
    });
    expect(text).toContain("Revenue: 1250.75");
    expect(text).toContain("Rent: 12.5");
  });

  it("writes label: value lines for a narrow table with normalised amounts", () => {
    const sheet = {
      name: "P&L",
      rows: [
        ["Label", "Jumlah"],
        ["Pendapatan", "Rp 1.250.000,50"],
        ["Sewa", "(750.000)"],
        ["Marjin", "12,5%"],
      ],
    };
    const text = tableToFiguresText(sheet);
    expect(text).toContain("Sheet: P&L");
    expect(text).toContain("Pendapatan: Rp 1250000.5");
    expect(text).toContain("Sewa: -750000");
    expect(text).toContain("Marjin: 12.5%");
  });

  it("adds the period when a narrow table carries one period column", () => {
    const text = tableToFiguresText({
      name: "Yearly",
      rows: [
        ["Label", "Year", "Amount"],
        ["Revenue", "2024", "120000"],
      ],
    });
    expect(text).toContain("Revenue (2024): 120000");
  });

  it("keeps the period headers of a wide table so later tasks can read the columns", () => {
    const text = tableToFiguresText({
      name: "Monthly",
      rows: [
        ["", "Jan", "Feb", "Mar"],
        ["Revenue", "120.000", "130.000", "140.000"],
        ["Rent", "(12.000)", "(12.000)", "(12.000)"],
      ],
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Sheet: Monthly");
    expect(lines).toContain("Label | Jan | Feb | Mar");
    expect(lines).toContain("Revenue | 120000 | 130000 | 140000");
    expect(lines).toContain("Rent | -12000 | -12000 | -12000");
  });

  it("keeps a row that has no number out of the wide table body", () => {
    const text = tableToFiguresText({
      name: "Monthly",
      rows: [
        ["Label", "Jan", "Feb"],
        ["Operating costs", "", ""],
        ["Rent", "1200", "1200"],
      ],
    });
    expect(text).not.toContain("Operating costs");
    expect(text).toContain("Rent | 1200 | 1200");
  });

  it("falls back to the raw row when no column is numeric, and answers empty for an empty sheet", () => {
    const text = tableToFiguresText({
      name: "Notes",
      rows: [
        ["Label", "Owner"],
        ["Rent", "Finance"],
      ],
    });
    expect(text).toContain("Rent | Finance");
    expect(tableToFiguresText({ name: "Blank", rows: [] })).toBe("");
  });

  it("truncates on a line boundary at the figures-text cap", () => {
    const rows = [["Label", "Amount"], ...[...Array(4000).keys()].map((n) => [`Line item number ${n}`, String(n)])];
    const text = tableToFiguresText({ name: "Long", rows });
    expect(text.length).toBeLessThanOrEqual(FINANCE_FIGURES_TEXT_MAX);
    expect(text.endsWith("\n")).toBe(false);
    expect(text.split("\n").at(-1)).toMatch(/^Line item number \d+: \d+$/);
  });
});

/** The month columns of a cash book that opens with a "saldo awal" key/value row above the header. */
const CASH_BOOK = [
  ["Saldo awal (1 Jan 2024)", "45.000.000", "", ""],
  ["Keterangan", "Jan 2024", "Feb 2024", "Des 2024"],
  ["KAS MASUK", "", "", ""],
  ["Penjualan tunai", "54.200.000", "51.800.000", "42.300.000"],
  ["Penjualan QRIS", "33.600.000", "32.100.000", "26.400.000"],
  ["Total masuk", "87.800.000", "83.900.000", "68.700.000"],
];

describe("header detection", () => {
  it("scores the month row as the header instead of the key/value row above it", () => {
    const file = readFinanceTable(csv(CASH_BOOK.map((row) => row.join(";")).join("\n")), "buku-kas.csv");
    const sheet = file.sheets[0];
    expect(sheet?.rows[0]).toEqual(["Keterangan", "Jan 2024", "Feb 2024", "Des 2024"]);
    expect(sheet?.facts).toEqual([{ label: "Saldo awal (1 Jan 2024)", value: "45000000" }]);
  });

  it("keeps every month column instead of the last one, and writes the pre-table row as a fact", () => {
    const file = readFinanceTable(csv(CASH_BOOK.map((row) => row.join(";")).join("\n")), "buku-kas.csv");
    const text = tableToFiguresText(file.sheets[0] ?? { name: "", rows: [] });
    expect(text).toContain("Saldo awal (1 Jan 2024): 45000000");
    expect(text).toContain("Keterangan | Jan 2024 | Feb 2024 | Des 2024");
    expect(text).toContain("54200000 | 51800000 | 42300000");
  });

  it("still drops a merged title row that carries no figure", () => {
    const file = readFinanceTable(csv("PT Toko Token,,\nLabel,,Amount\nRevenue,,120000\n"), "title.csv");
    expect(file.sheets[0]?.rows[0]).toEqual(["Label", "Amount"]);
    expect(file.sheets[0]?.facts ?? []).toEqual([]);
  });
});

describe("ISO currency codes", () => {
  it("takes only real ISO-4217 codes, and never a month name", () => {
    expect(isCurrencyCode("IDR")).toBe(true);
    expect(isCurrencyCode("usd")).toBe(true);
    for (const month of ["Des", "Mei", "Agu", "Okt", "Jan", "Feb", "Sep", "Nov", "Dec"]) {
      expect(isCurrencyCode(month)).toBe(false);
    }
  });

  it("does not read an Indonesian month header as a currency plus a year", () => {
    for (const label of ["Des 2024", "Mei 2024", "Agu 2024", "Okt 2024"]) {
      expect(normalizeAmount(label, "thousands")).toBeNull();
    }
  });

  it("keeps the month header out of the figures of a narrow sheet", () => {
    const text = tableToFiguresText({
      name: "Kas",
      rows: [
        ["Keterangan", "Des 2024"],
        ["Penjualan tunai", "42.300.000"],
      ],
    });
    expect(text).not.toContain("DES 2024");
    expect(text).toContain("Penjualan tunai");
  });
});

describe("ordinal period headers", () => {
  it("reads Tahun / Year / Bulan / Q headers as periods and splits off the scenario", () => {
    for (const label of ["Tahun 0", "Tahun 6", "Year 0", "Year 10", "Bulan 1", "Month 3", "Q1 Budget"]) {
      expect(isPeriodLabel(label)).toBe(true);
    }
    expect(ordinalPeriod("Q1 Budget")).toEqual({ period: "Q 1", scenario: "Budget" });
    expect(ordinalPeriod("Tahun 0")).toEqual({ period: "Tahun 0", scenario: "" });
    expect(ordinalPeriod("Revenue")).toBeNull();
    expect(financePeriodHeaders(["Line item", "Q1 Budget", "Q1 Actual"]).map((column) => column.scenario)).toEqual([
      "Budget",
      "Actual",
    ]);
  });

  it("normalises every cell of a Tahun 0..n projection instead of dumping it raw", () => {
    const text = tableToFiguresText({
      name: "Kelayakan",
      rows: [
        ["Komponen", "Tahun 0", "Tahun 1", "Tahun 2"],
        ["Investasi awal", "(1,450,000,000)", "0", "0"],
        ["Penghematan biaya", "0", "345,000,000", "412,000,000"],
      ],
    });
    expect(text).toContain("Komponen | Tahun 0 | Tahun 1 | Tahun 2");
    expect(text).toContain("Investasi awal | -1450000000 | 0 | 0");
    expect(text).not.toContain("(1,450,000,000)");
  });

  it("keeps both budget and actual columns of a Q1 Budget / Q1 Actual sheet", () => {
    const text = tableToFiguresText({
      name: "Budget vs Actual",
      rows: [
        ["Line item", "Q1 Budget", "Q1 Actual", "Q2 Budget", "Q2 Actual"],
        ["Net sales", "420,000", "398,000", "435,000", "452,000"],
        ["Operating income", "(76,000)", "(114,450)", "(34,500)", "(35,225)"],
      ],
    });
    expect(text).toContain("Line item | Q1 Budget | Q1 Actual | Q2 Budget | Q2 Actual");
    expect(text).toContain("420000 | 398000 | 435000 | 452000");
    expect(text).toContain("-76000 | -114450 | -34500 | -35225");
  });
});

describe("warnings", () => {
  it("names the columns a narrow sheet could not import", () => {
    const { warnings } = financeFiguresFromSheet({
      name: "Gaji",
      rows: [
        ["Nama", "Bank", "Catatan singkat", "Gaji Bersih"],
        ["Dewi", "Bank Nusantara", "tetap", "9,775,000"],
        ["Bagus", "Bank Cakrawala", "tetap", "13,800,000"],
      ],
    });
    const dropped = warnings.find((warning) => warning.code === "dropped_columns");
    expect(dropped?.detail).toEqual(["Bank", "Catatan singkat"]);
    expect(dropped?.message).toContain("2 columns");
  });

  it("answers with an empty warning list when nothing was left out", () => {
    const file = readFinanceTable(csv("Label,Amount\nRevenue,120000\n"), "clean.csv");
    expect(file.warnings).toEqual([]);
    expect(financeFiguresFromSheet(file.sheets[0] ?? { name: "", rows: [] }).warnings).toEqual([]);
  });

  it("reports the rows of a wide sheet that carried no figure at all", () => {
    const { warnings } = financeFiguresFromSheet({
      name: "Monthly",
      rows: [
        ["Label", "Jan", "Feb"],
        ["Owner", "Finance", "Finance"],
        ["Rent", "1200", "1200"],
      ],
    });
    expect(warnings.find((warning) => warning.code === "dropped_rows")?.detail).toEqual(["Owner"]);
  });
});

describe("derived rows", () => {
  it("tags a subtotal that equals the rows above it, and leaves the parts alone", () => {
    const text = tableToFiguresText({
      name: "Anggaran",
      rows: [
        ["Uraian", "2024"],
        ["Donasi individu", "1,850,000,000"],
        ["Hibah korporasi", "1,200,000,000"],
        ["Pendapatan jasa", "450,000,000"],
        ["Subtotal Pendapatan", "3,500,000,000"],
      ],
    });
    expect(text).toContain(`${DERIVED_TAG} Subtotal Pendapatan`);
    expect(text).not.toContain(`${DERIVED_TAG} Donasi individu`);
  });

  it("follows a total of totals up a balance sheet", () => {
    const text = tableToFiguresText({
      name: "Neraca",
      rows: [
        ["Keterangan", "2024"],
        ["Kas", "2,340,000,000"],
        ["Piutang", "5,180,000,000"],
        ["Jumlah Aset Lancar", "7,520,000,000"],
        ["Tanah", "8,500,000,000"],
        ["Mesin", "7,180,000,000"],
        ["Jumlah Aset Tidak Lancar", "15,680,000,000"],
        ["JUMLAH ASET", "23,200,000,000"],
      ],
    });
    expect(text).toContain(`${DERIVED_TAG} Jumlah Aset Lancar`);
    expect(text).toContain(`${DERIVED_TAG} Jumlah Aset Tidak Lancar`);
    expect(text).toContain(`${DERIVED_TAG} JUMLAH ASET`);
    expect(text).not.toContain(`${DERIVED_TAG} Kas`);
  });

  it("leaves a counted row alone, with its unit beside the name or without one", () => {
    const text = tableToFiguresText({
      name: "Operasional",
      rows: [
        ["Keterangan", "2024"],
        ["Jumlah Gerai Aktif (unit)", "18"],
        ["Jumlah Karyawan Tetap", "46"],
        ["Jumlah Karyawan Harian", "29"],
      ],
    });
    expect(text).not.toContain(DERIVED_TAG);
  });

  it("does not tag a line item whose name only starts with 'Net'", () => {
    const text = tableToFiguresText({
      name: "Retail",
      rows: [
        ["Line item", "Q1 Budget", "Q1 Actual"],
        ["Net sales - flagship store", "420,000", "398,000"],
        ["Net sales - mall kiosks", "185,000", "171,000"],
      ],
    });
    expect(text).not.toContain(DERIVED_TAG);
  });
});

describe("isDerivedLabel", () => {
  it("reads a total prefix in front of a counted thing as a count, not a sum", () => {
    expect(isDerivedLabel("Jumlah Karyawan Tetap (orang)")).toBe(false);
    expect(isDerivedLabel("Jumlah Karyawan Harian (orang)")).toBe(false);
    expect(isDerivedLabel("Jumlah Gerai Aktif (unit)")).toBe(false);
  });

  it("still reads a total prefix in front of money as a total", () => {
    expect(isDerivedLabel("Total pendapatan")).toBe(true);
    expect(isDerivedLabel("Jumlah aset lancar")).toBe(true);
    expect(isDerivedLabel("JUMLAH LIABILITAS DAN EKUITAS")).toBe(true);
    expect(isDerivedLabel("Subtotal Pendapatan")).toBe(true);
    // A countable noun with no unit beside it is not evidence on its own.
    expect(isDerivedLabel("Total staff cost")).toBe(true);
  });

  it("keeps calling a named result derived", () => {
    expect(isDerivedLabel("Laba kotor")).toBe(true);
    expect(isDerivedLabel("Net cash flow")).toBe(true);
    expect(isDerivedLabel("Penjualan toko utama")).toBe(false);
  });
});

describe("section headings", () => {
  it("keeps the grouping a heading row carries instead of dropping the row and the context", () => {
    const text = tableToFiguresText({
      name: "Laba Rugi",
      rows: [
        ["Keterangan", "2023", "2024"],
        ["PENDAPATAN USAHA", "", ""],
        ["Penjualan Produk", "5,400,000,000", "6,900,000,000"],
        ["BEBAN USAHA", "", ""],
        ["Penyusutan", "145,000,000", "168,000,000"],
      ],
    });
    expect(text).toContain("[PENDAPATAN USAHA] Penjualan Produk | 5400000000 | 6900000000");
    expect(text).toContain("[BEBAN USAHA] Penyusutan | 145000000 | 168000000");
  });

  it("nests a mixed-case heading under the ALL-CAPS one above it", () => {
    const text = tableToFiguresText({
      name: "Neraca",
      rows: [
        ["Keterangan", "2024"],
        ["ASET", ""],
        ["Aset Lancar", ""],
        ["Kas dan Setara Kas", "2,340,000,000"],
      ],
    });
    expect(text).toContain("[ASET / Aset Lancar] Kas dan Setara Kas | 2340000000");
  });

  it("keeps a note row as a note rather than losing the sentence", () => {
    const text = tableToFiguresText({
      name: "Laba Rugi",
      rows: [
        ["Keterangan", "2024"],
        ["Penjualan", "6,900,000,000"],
        ["Catatan: retur dan potongan penjualan disajikan sebagai pengurang pendapatan, bukan beban.", ""],
      ],
    });
    expect(text).toContain("Note: Catatan: retur dan potongan penjualan");
  });
});

describe("a second table on the same sheet", () => {
  it("reads a block with its own header rather than merging it into the one above", () => {
    const text = tableToFiguresText({
      name: "Gaji",
      rows: [
        ["No", "Nama Karyawan", "Gaji Bersih", ""],
        ["1", "Dewi", "9,775,000", ""],
        ["2", "Bagus", "13,800,000", ""],
        ["Reimbursement Oktober", "", "", ""],
        ["No", "Nama", "Keterangan", "Jumlah"],
        ["1", "Dewi", "Perjalanan dinas", "1,250,000"],
        ["2", "Andi", "Perlengkapan", "2,480,000"],
      ],
    });
    expect(text).toContain("1250000");
    expect(text).toContain("2480000");
    expect(text).toContain("9775000");
  });
});

describe("mixed number conventions in one sheet", () => {
  it("reads comma groups and point groups in the same sheet as thousands", () => {
    const style = sheetNumberStyle([
      ["Penjualan", "5,400,000,000"],
      ["Overhead", "512.000.000"],
      ["Retur", "(245.000.000)"],
    ]);
    expect(style).toEqual({ point: "thousands", comma: "thousands" });
    const text = tableToFiguresText({
      name: "Laba Rugi",
      rows: [
        ["Keterangan", "2024"],
        ["Penjualan", "5,400,000,000"],
        ["Overhead", "512.000.000"],
        ["Retur", "(245.000.000)"],
      ],
    });
    expect(text).toContain("Penjualan | 5400000000");
    expect(text).toContain("Overhead | 512000000");
    expect(text).toContain("Retur | -245000000");
  });

  it("does not let a US sheet's '33,000' vote on what its points mean", () => {
    // "33,000" used to count as definite point-thousands evidence, so "12.5" read as 12,500.
    const style = sheetNumberStyle([
      ["Operating income", "33,000"],
      ["Rate", "12.5"],
    ]);
    expect(style).toEqual({ point: "decimal", comma: "thousands" });
    expect(normalizeAmount("12.5", style)).toBe("12.5");
    expect(normalizeAmount("33,000", style)).toBe("33000");
  });

  it("normalises the accounting format's padding and its gapless Rp", () => {
    expect(normalizeAmount(" Rp7,570,000,000 ", { point: "thousands", comma: "thousands" })).toBe("Rp 7570000000");
    expect(normalizeAmount("Rp 1.180.000.000", { point: "thousands", comma: "thousands" })).toBe("Rp 1180000000");
  });
});

describe("long-format ledgers", () => {
  const ledgerRows = [
    ["date", "category", "direction", "amount"],
    ...[...Array(6).keys()].flatMap((index) => [
      [`2024-01-0${index + 1}`, "Subscription revenue", "in", "10000"],
      [`2024-01-1${index}`, "Payroll", "out", "-98000"],
    ]),
    ["2024-02-01", "Subscription revenue", "in", "12000"],
    ["2024-02-03", "Cloud hosting", "out", "3400"],
    ["2024-05-02", "Financing", "in", "2500000"],
  ];

  it("aggregates to month x category with signed amounts", () => {
    const text = tableToFiguresText({ name: "bank-export", rows: ledgerRows });
    expect(text).toContain("Subscription revenue (2024-01): 60000");
    expect(text).toContain("Payroll (2024-01): -588000");
    expect(text).toContain("Subscription revenue (2024-02): 12000");
  });

  it("keeps the financing inflow as its own category and out of operating cash in", () => {
    const text = tableToFiguresText({ name: "bank-export", rows: ledgerRows });
    expect(text).toContain("Financing (2024-05): 2500000");
    expect(text).toContain(`${DERIVED_TAG} Operating cash in (2024-05): 0`);
  });

  it("keeps the sign of the amount and reports every row whose direction disagrees", () => {
    const { text, warnings } = financeFiguresFromSheet({ name: "bank-export", rows: ledgerRows });
    // The 3,400 refund is booked "out" with a positive amount: the sign wins, the row is reported.
    expect(text).toContain("Cloud hosting (2024-02): 3400");
    const mismatch = warnings.find((warning) => warning.code === "direction_mismatch");
    expect(mismatch?.detail).toHaveLength(1);
    expect(mismatch?.detail[0]).toContain("Cloud hosting");
  });
});

describe("the figures-text cap", () => {
  const months = [...Array(60).keys()].map((index) => `2024-${String((index % 12) + 1).padStart(2, "0")}`);

  it("writes a wide sheet as period=value pairs before it has to cut lines", () => {
    const rows = [
      ["Label", ...months],
      ...[...Array(120).keys()].map((index) => [
        `Line item number ${index}`,
        ...months.map((_month, at) => (at === index % 60 ? String(1000 + index) : "")),
      ]),
    ];
    const { text, warnings } = financeFiguresFromSheet({ name: "Wide", rows });
    expect(text.length).toBeLessThanOrEqual(FINANCE_FIGURES_TEXT_MAX);
    expect(warnings.some((warning) => warning.code === "compacted")).toBe(true);
    expect(text).toContain("Line item number 0 | 2024-01=1000");
  });

  it("warns when lines still had to be cut", () => {
    const rows = [["Label", "Amount"], ...[...Array(4000).keys()].map((n) => [`Line item number ${n}`, String(n)])];
    const { text, warnings } = financeFiguresFromSheet({ name: "Long", rows });
    expect(text.length).toBeLessThanOrEqual(FINANCE_FIGURES_TEXT_MAX);
    expect(warnings.some((warning) => warning.code === "truncated")).toBe(true);
  });
});
