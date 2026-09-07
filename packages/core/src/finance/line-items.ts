import type { TabularTable } from "../tabular/types";
import { classifyCell, parseNumber } from "../tabular/infer-types";
import { LINE_ITEM_CATEGORIES, lineItemSchema, type LineItem, type LineItemCategory } from "./types";

export const LINE_ITEMS_MAX = 500;
const PERIOD_HEADER = /period|date|month|quarter|year|fy|q\d/i;

const CATEGORY_HINTS: Array<[RegExp, LineItemCategory]> = [
  [/revenue|sales|income|turnover|receipt|subscription|mrr|arr/i, "revenue"],
  [/cogs|cost of (goods|sales|revenue)|direct cost|materials/i, "cogs"],
  [/opex|operating|salar|payroll|rent|marketing|expense|overhead|utilit|insurance|software/i, "opex"],
  [/cash|bank|balance|treasury/i, "cash"],
  [/loan|debt|borrow|note payable|mortgage/i, "debt"],
  [/equity|capital|retained/i, "equity"],
  [/receivable|inventory|asset/i, "asset"],
  [/payable|liabilit|accrued/i, "liability"],
];

/** Best-effort category from a label such as "Rent" or "Q3 sales". */
export function guessCategory(label: string): LineItemCategory {
  return CATEGORY_HINTS.find(([pattern]) => pattern.test(label))?.[1] ?? "other";
}

function findColumn(table: TabularTable, predicate: (header: string, index: number) => boolean): number {
  return table.headers.findIndex((header, index) => predicate(header, index));
}

function columnCells(table: TabularTable, index: number): string[] {
  return table.rows.map((row) => row[index] ?? "");
}

function mostlyNumeric(cells: readonly string[]): boolean {
  const filled = cells.filter((cell) => cell.trim() !== "");
  return filled.length > 0 && filled.filter((cell) => classifyCell(cell) === "number").length / filled.length >= 0.9;
}

/**
 * Turn a parsed table into line items: first text column = label, a period / date
 * column when present, first numeric column = amount. Category comes from headers or labels.
 */
export function lineItemsFromTable(table: TabularTable): LineItem[] {
  // A Year / Quarter column is numeric too; it must never be taken as the amount.
  const numericIndex = findColumn(
    table,
    (header, index) => !PERIOD_HEADER.test(header) && mostlyNumeric(columnCells(table, index)),
  );
  if (numericIndex < 0) {
    return [];
  }
  const periodIndex = findColumn(table, (header, index) => index !== numericIndex && PERIOD_HEADER.test(header));
  const labelIndex = findColumn(
    table,
    (_, index) => index !== numericIndex && index !== periodIndex && !mostlyNumeric(columnCells(table, index)),
  );
  const categoryIndex = findColumn(table, (header) => /category|type|kind|class/i.test(header));
  const amountHeader = table.headers[numericIndex] ?? "";
  return table.rows
    .slice(0, LINE_ITEMS_MAX)
    .map((row) => {
      const amount = parseNumber(row[numericIndex] ?? "");
      const label = (labelIndex >= 0 ? row[labelIndex] : amountHeader) || amountHeader || "Amount";
      const rawCategory = categoryIndex >= 0 ? (row[categoryIndex] ?? "").toLowerCase() : "";
      const category = (LINE_ITEM_CATEGORIES as readonly string[]).includes(rawCategory)
        ? (rawCategory as LineItemCategory)
        : guessCategory(`${label} ${rawCategory} ${amountHeader}`);
      return amount === null
        ? null
        : { label, period: periodIndex >= 0 ? (row[periodIndex] ?? "") : "", amount, currency: "", category };
    })
    .filter((item): item is LineItem => item !== null);
}

/** Validate model-parsed line items (from free text). Bad rows are dropped, not repaired. */
export function parseLineItems(value: unknown): LineItem[] {
  const list = Array.isArray(value) ? value : (value as { items?: unknown })?.items;
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .slice(0, LINE_ITEMS_MAX)
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      const amount = typeof record.amount === "number" ? record.amount : parseNumber(String(record.amount ?? ""));
      const parsed = lineItemSchema.safeParse({
        label: typeof record.label === "string" ? record.label.trim() : "",
        period: typeof record.period === "string" ? record.period.trim() : "",
        amount,
        currency: typeof record.currency === "string" ? record.currency.trim().toUpperCase().slice(0, 8) : "",
        category:
          typeof record.category === "string" && (LINE_ITEM_CATEGORIES as readonly string[]).includes(record.category)
            ? record.category
            : guessCategory(typeof record.label === "string" ? record.label : ""),
      });
      return parsed.success ? parsed.data : null;
    })
    .filter((item): item is LineItem => item !== null);
}
