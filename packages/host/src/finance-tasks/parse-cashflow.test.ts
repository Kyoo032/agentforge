import { describe, expect, it } from "vitest";
import type { TenantContext } from "@agentforge/core";
import type { CashflowItem } from "@agentforge/core/finance";
import { parseCashflowInput } from "./parse-cashflow";

const TENANT = { organizationId: "o", workspaceId: "w", userId: "u", role: "owner" } as unknown as TenantContext;

/** The importer's own output for an Indonesian cash book, months as columns, trimmed to two months. */
const WIDE = [
  "Sheet: Arus Kas 2024",
  "Saldo awal (1 Jan 2024): 45000000",
  "Keterangan | Jan 2024 | Feb 2024",
  "[KAS MASUK] Penjualan tunai | 54200000 | 51800000",
  "[KAS MASUK] Penjualan QRIS & transfer | 33600000 | 32100000",
  "[KAS MASUK] Pendapatan katering | 0 | 3500000",
  "[KAS MASUK] Penjualan biji kopi retail | 4200000 | 3900000",
  "[subtotal] [KAS MASUK] Total masuk | 92000000 | 91300000",
  "[KAS KELUAR] Pembelian bahan baku | 34100000 | 33000000",
  "[KAS KELUAR] Sewa tempat | 15000000 | 15000000",
  "[KAS KELUAR] Perlengkapan & kemasan | 4500000 | 4200000",
  "[KAS KELUAR] Perawatan mesin (overhaul) | 0 | 12000000",
  "[subtotal] [KAS KELUAR] Total keluar | 53600000 | 64200000",
  "[subtotal] [KAS KELUAR] Arus kas bersih | 38400000 | 27100000",
].join("\n");

/** The importer's output for a bank export it has already summed to month x category. */
const LEDGER = [
  "Sheet: bank-export-2024",
  "Ledger: 8 rows summed to one figure per month and category (signs as written)",
  "Note: Financing is financing, so it is outside operating cash in and cash out",
  "Cloud hosting (2024-01): -14200",
  "Payroll (2024-01): -196000",
  "Subscription revenue (2024-01): 44000",
  "Interest income (2024-01): 980",
  "Financing (2024-05): 2500000",
  "Subscription revenue (2024-05): 58120",
  "[subtotal] Operating cash in (2024-01): 44980",
  "[subtotal] Operating cash out (2024-01): 210200",
].join("\n");

/** A bank export nobody aggregated: one transaction per line, several on the same day. */
const RAW_LEDGER = [
  "Rent (2024-01-01): -12500",
  "Subscription revenue (2024-01-01): 31200",
  "Cloud hosting (2024-01-03): -14200",
  "Subscription revenue (2024-01-15): 12800",
  "Rent (2024-02-01): -12500",
].join("\n");

const parse = (figures: string) => parseCashflowInput(TENANT, { figures });
const rowAt = (items: readonly CashflowItem[], label: string, period: string) =>
  items.find((item) => item.label === label && item.period === period);

describe("an Indonesian cash book with months as columns", () => {
  it("answers with one cash-in and one cash-out row per month, named for the book's language", async () => {
    const parsed = (await parse(WIDE)) as { items: CashflowItem[]; periods: string[] };
    expect(parsed.periods).toEqual(["Jan 2024", "Feb 2024"]);
    expect(rowAt(parsed.items, "Total kas masuk", "Jan 2024")?.amount).toBe(92_000_000);
    expect(rowAt(parsed.items, "Total kas keluar", "Jan 2024")?.amount).toBe(53_600_000);
    expect(rowAt(parsed.items, "Total kas masuk", "Feb 2024")?.amount).toBe(91_300_000);
  });

  it("never adds a subtotal row to the rows it totals", async () => {
    const parsed = (await parse(WIDE)) as { items: CashflowItem[] };
    // Total masuk is 92.000.000. Counting it as a category too would answer 184.000.000.
    expect(rowAt(parsed.items, "Total kas masuk", "Jan 2024")?.amount).toBe(92_000_000);
    expect(parsed.items.filter((item) => item.period === "Jan 2024")).toHaveLength(2);
  });

  it("picks the opening balance up from the fact line above the table", async () => {
    const parsed = (await parse(WIDE)) as { openingCash: number; items: CashflowItem[] };
    expect(parsed.openingCash).toBe(45_000_000);
    expect(parsed.items[0]).toMatchObject({ kind: "opening", amount: 45_000_000, period: "" });
  });

  it("splits each month's outflow into the cost behaviour the breakeven base needs", async () => {
    const parsed = (await parse(WIDE)) as { items: CashflowItem[] };
    expect(rowAt(parsed.items, "Total kas keluar", "Jan 2024")?.breakdown).toEqual({
      variable: 38_600_000,
      fixed: 15_000_000,
      oneOff: 0,
      roles: { rent: 15_000_000 },
    });
    // The overhaul is a single event and is held out of February's fixed base.
    expect(rowAt(parsed.items, "Total kas keluar", "Feb 2024")?.breakdown).toMatchObject({
      variable: 37_200_000,
      fixed: 15_000_000,
      oneOff: 12_000_000,
    });
  });

  it("shows the reader what each source row was read as, with a confidence", async () => {
    const parsed = (await parse(WIDE)) as { categories: { label: string; behaviour?: string }[]; items: CashflowItem[] };
    expect(parsed.categories.find((entry) => entry.label === "Pembelian bahan baku")?.behaviour).toBe("variable");
    expect(parsed.categories.find((entry) => entry.label === "Sewa tempat")?.behaviour).toBe("fixed");
    expect(parsed.items[0]?.classification?.length).toBe(parsed.categories.length);
  });

  it("says so when a subtotal row disagrees with the rows above it", async () => {
    const broken = WIDE.replace("Total keluar | 53600000", "Total keluar | 99000000");
    const parsed = (await parse(broken)) as { warnings: string[] };
    expect(parsed.warnings.some((warning) => warning.includes("Total keluar"))).toBe(true);
  });
});

describe("a bank export", () => {
  it("keeps the names the export used and the sign it wrote", async () => {
    const parsed = (await parse(LEDGER)) as { items: CashflowItem[]; periods: string[]; currency: string };
    expect(parsed.periods).toEqual(["2024-01", "2024-05"]);
    expect(rowAt(parsed.items, "Operating cash in", "2024-01")?.amount).toBe(44_980);
    expect(rowAt(parsed.items, "Operating cash out", "2024-01")?.amount).toBe(210_200);
    expect(parsed.currency).toBe("USD");
  });

  it("keeps the funding round out of operating cash in", async () => {
    const parsed = (await parse(LEDGER)) as { items: CashflowItem[] };
    expect(rowAt(parsed.items, "Financing", "2024-05")?.amount).toBe(2_500_000);
    expect(rowAt(parsed.items, "Operating cash in", "2024-05")?.amount).toBe(58_120);
  });

  it("sums a ledger nobody aggregated into months, several rows a day and all", async () => {
    const parsed = (await parse(RAW_LEDGER)) as { items: CashflowItem[]; periods: string[] };
    expect(parsed.periods).toEqual(["2024-01", "2024-02"]);
    expect(rowAt(parsed.items, "Operating cash in", "2024-01")?.amount).toBe(44_000);
    expect(rowAt(parsed.items, "Operating cash out", "2024-01")?.amount).toBe(26_700);
    expect(rowAt(parsed.items, "Operating cash out", "2024-02")?.amount).toBe(12_500);
  });
});

describe("what it refuses", () => {
  it("asks for figures rather than guessing", async () => {
    await expect(parse("")).rejects.toThrowError(/figures text is required/);
    await expect(parse("nothing to read here")).rejects.toThrowError(/No cash-flow rows/);
  });
});
