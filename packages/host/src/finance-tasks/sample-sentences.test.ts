import { describe, expect, it } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { financeTaskMeta, readFiguresText, type FinanceTask } from "@agentforge/core/finance";
import { parseAppraisalInput, type ParsedAppraisal } from "./parse-appraisal";
import { parseBudgetInput, type BudgetParseResult } from "./parse-budget";
import { parseCashflowInput, type CashflowParseResult } from "./parse-cashflow";
import { parseRatiosInput } from "./parse-ratios";

/** Keyless on purpose: a catalog sentence must become rows without a gateway. */
const TENANT = {} as TenantContext;

function sample(task: FinanceTask, language: "en" | "id"): string {
  const text = financeTaskMeta(task).sampleFigures;
  return language === "en" ? text.en : text.id;
}

function amount(
  rows: readonly { period: string; amount: number; kind?: string }[],
  period: string,
  kind: string,
): number {
  const row = rows.find((entry) => entry.period === period && entry.kind === kind);
  return row?.amount ?? Number.NaN;
}

describe("finance catalog samples", () => {
  it("reads the brief sample into rows, in both languages", () => {
    const english = readFiguresText(sample("brief", "en"));
    expect(english.deterministic).toBe(true);
    expect(english.rows.map((row) => [row.label, row.amount])).toEqual([
      ["Revenue", 120_000],
      ["Hosting", 30_000],
      ["Payroll", 100_000],
      ["Cash", 90_000],
    ]);
    const indonesian = readFiguresText(sample("brief", "id"));
    expect(indonesian.deterministic).toBe(true);
    expect(indonesian.rows.map((row) => [row.label, row.amount])).toEqual([
      ["Pendapatan", 1_200_000_000],
      ["Hosting", 300_000_000],
      ["Gaji", 1_000_000_000],
      ["Kas", 900_000_000],
    ]);
  });

  it("reads the cash-flow sample into opening cash and two periods", async () => {
    const english = (await parseCashflowInput(TENANT, { figures: sample("cashflow", "en") })) as CashflowParseResult;
    expect(english.openingCash).toBe(90_000);
    expect(amount(english.items, "Jan", "inflow")).toBe(20_000);
    expect(amount(english.items, "Jan", "outflow")).toBe(26_000);
    expect(amount(english.items, "Feb", "inflow")).toBe(21_000);
    expect(amount(english.items, "Feb", "outflow")).toBe(25_500);

    const indonesian = (await parseCashflowInput(TENANT, { figures: sample("cashflow", "id") })) as CashflowParseResult;
    expect(indonesian.openingCash).toBe(900_000_000);
    expect(amount(indonesian.items, "Jan", "inflow")).toBe(200_000_000);
    expect(amount(indonesian.items, "Jan", "outflow")).toBe(260_000_000);
    expect(amount(indonesian.items, "Feb", "inflow")).toBe(210_000_000);
    expect(amount(indonesian.items, "Feb", "outflow")).toBe(255_000_000);
  });

  it("reads a cash-flow sentence with no currency mark", async () => {
    const parsed = (await parseCashflowInput(TENANT, {
      figures: "Opening cash 90,000. Jan in 20,000, out 26,000. Feb in 21,000, out 25,500.",
    })) as CashflowParseResult;
    expect(parsed.openingCash).toBe(90_000);
    expect(amount(parsed.items, "Jan", "inflow")).toBe(20_000);
    expect(amount(parsed.items, "Feb", "outflow")).toBe(25_500);
  });

  it("reads the budget sample into paired sides", async () => {
    const english = (await parseBudgetInput(TENANT, { figures: sample("budget", "en") })) as BudgetParseResult;
    expect(english.matching.embedding).toBe("not-needed");
    expect(english.budget.map((line) => [line.label, line.amounts[0]?.amount])).toEqual([
      ["Marketing", 10_000],
      ["Payroll", 50_000],
    ]);
    expect(english.actual.map((line) => [line.label, line.amounts[0]?.amount])).toEqual([
      ["Marketing", 14_000],
      ["Payroll", 49_000],
    ]);

    const indonesian = (await parseBudgetInput(TENANT, { figures: sample("budget", "id") })) as BudgetParseResult;
    expect(indonesian.matching.embedding).toBe("not-needed");
    expect(indonesian.budget.map((line) => [line.label, line.amounts[0]?.amount])).toEqual([
      ["Pemasaran", 100_000_000],
      ["Gaji", 500_000_000],
    ]);
    expect(indonesian.actual.map((line) => [line.label, line.amounts[0]?.amount])).toEqual([
      ["Pemasaran", 140_000_000],
      ["Gaji", 490_000_000],
    ]);
  });

  it("reads the appraisal sample into an outlay and yearly flows", async () => {
    const english = (await parseAppraisalInput(TENANT, { figures: sample("appraisal", "en") })) as ParsedAppraisal;
    expect(english.discountRatePercent).toBe(12);
    expect(english.outlay).toBe(-200_000);
    expect(english.flows.map((flow) => [flow.year, flow.amount])).toEqual([
      [0, -200_000],
      [1, 60_000],
      [2, 75_000],
      [3, 90_000],
    ]);

    const indonesian = (await parseAppraisalInput(TENANT, { figures: sample("appraisal", "id") })) as ParsedAppraisal;
    expect(indonesian.discountRatePercent).toBe(12);
    expect(indonesian.outlay).toBe(-2_000_000_000);
    expect(indonesian.flows.map((flow) => [flow.year, flow.amount])).toEqual([
      [0, -2_000_000_000],
      [1, 600_000_000],
      [2, 750_000_000],
      [3, 900_000_000],
    ]);
  });

  it("reads the ratio sample into classified rows", async () => {
    const english = await parseRatiosInput(TENANT, { figures: sample("ratios", "en") });
    expect(english.modelAssist).toBeNull();
    expect(english.buckets.map((row) => [row.label, row.bucket, row.amount])).toEqual([
      ["Current assets", "other-current-asset", 150_000],
      ["current liabilities", "current-liability", 90_000],
      ["debt", "long-term-debt", 200_000],
      ["equity", "equity", 250_000],
      ["EBITDA", "ebitda", 80_000],
    ]);

    const indonesian = await parseRatiosInput(TENANT, { figures: sample("ratios", "id") });
    expect(indonesian.modelAssist).toBeNull();
    expect(indonesian.buckets.map((row) => [row.label, row.bucket, row.amount])).toEqual([
      ["Aset lancar", "other-current-asset", 1_500_000_000],
      ["liabilitas lancar", "current-liability", 900_000_000],
      ["utang", "long-term-debt", 2_000_000_000],
      ["ekuitas", "equity", 2_500_000_000],
      ["EBITDA", "ebitda", 800_000_000],
    ]);
  });
});
