import { describe, expect, it } from "vitest";
import { parseDelimited } from "../tabular/parse-delimited";
import { guessCategory, lineItemsFromTable, parseLineItems } from "./line-items";
import { computeFinance } from "./metrics";
import { guardNumbers } from "./number-guard";
import type { LineItem } from "./types";

const items: LineItem[] = [
  { label: "Subscriptions", period: "2025", amount: 120_000, currency: "USD", category: "revenue" },
  { label: "Subscriptions", period: "2026", amount: 150_000, currency: "USD", category: "revenue" },
  { label: "Hosting", period: "2025", amount: 30_000, currency: "USD", category: "cogs" },
  { label: "Hosting", period: "2026", amount: 33_000, currency: "USD", category: "cogs" },
  { label: "Payroll", period: "2025", amount: 100_000, currency: "USD", category: "opex" },
  { label: "Payroll", period: "2026", amount: 110_000, currency: "USD", category: "opex" },
  { label: "Bank balance", period: "", amount: 90_000, currency: "USD", category: "cash" },
];

describe("computeFinance", () => {
  it("derives per-period margins, growth, burn, runway, and tables from the line items", () => {
    const computed = computeFinance(items);
    const byKey = new Map(computed.metrics.map((entry) => [entry.key, entry]));
    expect(byKey.get("gross_margin 2025")?.value).toBe(75);
    expect(byKey.get("net_profit 2025")?.value).toBe(-10_000);
    expect(byKey.get("revenue_growth 2026")?.value).toBe(25);
    // Revenue exceeds costs here, so there is no burn and no runway metric.
    expect(byKey.get("burn")).toBeUndefined();
    expect(byKey.get("runway")).toBeUndefined();
    expect(byKey.get("cash")?.value).toBe(90_000);
    expect(computed.tables.map((table) => table.name)).toEqual(["Line items", "Totals by period"]);
    expect(computed.tables[1]?.columns).toEqual(["Category", "2025", "2026", "(none)"]);
    expect(computed.allowed).toContain(75);
    expect(computed.allowed).toContain(150_000);
    // A per-category subtotal shown in "Totals by period" must be citable.
    const twoCogs = computeFinance([
      ...items,
      { label: "Hardware", period: "2025", amount: 10_000, currency: "USD", category: "cogs" },
    ]);
    expect(twoCogs.allowed).toContain(40_000);
  });

  it("reports burn and runway when costs exceed revenue and skips ratios without balance items", () => {
    const loss = items.map((item) => (item.category === "opex" ? { ...item, amount: 200_000 } : item));
    const byKey = new Map(computeFinance(loss).metrics.map((entry) => [entry.key, entry]));
    // Two annual periods cover 24 months; runway is in months, so the burn it divides by is monthly.
    expect(byKey.get("burn")?.value).toBeCloseTo((400_000 - 270_000) / 24, 6);
    expect(byKey.get("runway")?.value).toBeCloseTo(90_000 / ((400_000 - 270_000) / 24), 6);
    expect(byKey.get("current_ratio")).toBeUndefined();
  });

  it("adds breakeven and npv/irr when params and cash flows allow", () => {
    const flows: LineItem[] = [
      { label: "Outlay", period: "Y0", amount: -1000, currency: "", category: "cash" },
      { label: "Return", period: "Y1", amount: 600, currency: "", category: "cash" },
      { label: "Return", period: "Y2", amount: 600, currency: "", category: "cash" },
    ];
    const byKey = new Map(
      computeFinance(flows, {
        discountRatePercent: 10,
        fixedCosts: 1000,
        pricePerUnit: 25,
        variableCostPerUnit: 15,
      }).metrics.map((entry) => [entry.key, entry]),
    );
    expect(byKey.get("breakeven_units")?.value).toBe(100);
    expect(byKey.get("breakeven_revenue")?.value).toBe(2500);
    expect(byKey.get("npv")?.value).toBeCloseTo(41.32, 1);
    expect(byKey.get("irr")?.value).toBeCloseTo(13.07, 1);
  });

  it("feeds the number guard so invented figures are caught", () => {
    const computed = computeFinance(items);
    const prose = "Gross margin held at 75% while payroll rose to $110,000; churn was 4.5% and runway is 18 months.";
    const result = guardNumbers(prose, computed.allowed);
    expect(result.flagged.map((token) => token.text)).toEqual(["4.5%", "18"]);
  });
});

describe("line items from tables and model output", () => {
  it("maps a table to line items with label, period, amount, and guessed category", () => {
    const table = parseDelimited("Item,Quarter,Amount\nSales,Q1,1000\nRent,Q1,300\nLoan,Q1,5000\n");
    expect(table).not.toBeNull();
    const out = lineItemsFromTable(table as NonNullable<typeof table>);
    expect(out).toEqual([
      { label: "Sales", period: "Q1", amount: 1000, currency: "", category: "revenue" },
      { label: "Rent", period: "Q1", amount: 300, currency: "", category: "opex" },
      { label: "Loan", period: "Q1", amount: 5000, currency: "", category: "debt" },
    ]);
    expect(lineItemsFromTable(parseDelimited("a,b\nx,y\n") as NonNullable<typeof table>)).toEqual([]);
    const yearFirst = lineItemsFromTable(
      parseDelimited("Year,Item,Amount\n2025,Sales,1000\n2026,Sales,1200\n") as NonNullable<typeof table>,
    );
    expect(yearFirst.map((item) => [item.period, item.amount])).toEqual([
      ["2025", 1000],
      ["2026", 1200],
    ]);
    expect(guessCategory("Marketing spend")).toBe("opex");
    expect(guessCategory("Misc")).toBe("other");
  });

  it("validates model-parsed items and drops bad rows", () => {
    const out = parseLineItems({
      items: [
        { label: "Rent", period: "Sep", amount: "5.000.000", currency: "idr", category: "opex" },
        { label: "Salary", amount: 14000000 },
        { label: "", amount: 1 },
        { label: "Bad", amount: "n/a" },
      ],
    });
    expect(out).toEqual([
      { label: "Rent", period: "Sep", amount: 5_000_000, currency: "IDR", category: "opex" },
      { label: "Salary", period: "", amount: 14_000_000, currency: "", category: "opex" },
    ]);
    expect(parseLineItems("nope")).toEqual([]);
  });
});
