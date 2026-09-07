import type { FinanceBrief } from "@agentforge/core/artifacts";
import type { FinanceParams, LineItem, LineItemCategory } from "@agentforge/core/finance";
import { apiFetch, isElectron } from "./api-client";
import { saveBlob } from "./artifacts-client";

export type { FinanceBrief, FinanceParams, LineItem, LineItemCategory };

export type GuardReport = { flagged: Array<{ section: number; text: string }>; total: number };

export type FinanceResult = {
  brief: FinanceBrief;
  artifactId: string | null;
  markdown: string;
  guard: GuardReport;
  items: LineItem[];
};

export const LINE_ITEM_CATEGORIES: LineItemCategory[] = [
  "revenue",
  "cogs",
  "opex",
  "cash",
  "debt",
  "equity",
  "asset",
  "liability",
  "other",
];

export const FINANCE_PARAM_FIELDS: Array<{ key: keyof FinanceParams; label: string; hint: string }> = [
  { key: "discountRatePercent", label: "Discount rate %", hint: "Enables NPV / IRR over cash line items by period" },
  { key: "fixedCosts", label: "Fixed costs", hint: "With price and variable cost, enables breakeven" },
  { key: "pricePerUnit", label: "Price per unit", hint: "" },
  { key: "variableCostPerUnit", label: "Variable cost per unit", hint: "" },
];

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(errorMessage(data, fallback));
  }
  return data as T;
}

/** Free text → line items the user must confirm before anything is computed. */
export async function parseFigures(figures: string, model?: string): Promise<LineItem[]> {
  const res = await apiFetch("/api/v1/finance/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ figures, model: model || undefined }),
  });
  const data = await readJson<{ items?: LineItem[] }>(res, "Could not read those figures");
  return Array.isArray(data.items) ? data.items : [];
}

export async function downloadFinanceDocx(brief: FinanceBrief): Promise<void> {
  const res = await apiFetch("/api/v1/finance/docx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief }),
  });
  if (!res.ok) {
    throw new Error(errorMessage(await res.json().catch(() => null), "Could not build the DOCX file"));
  }
  if (isElectron()) {
    return;
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "finance-brief.docx";
  saveBlob(await res.blob(), filename);
}

export function emptyLineItem(): LineItem {
  return { label: "", period: "", amount: 0, currency: "", category: "other" };
}

/** Only rows with a label and a finite amount are sent. */
export function usableLineItems(items: readonly LineItem[]): LineItem[] {
  return items.filter((item) => item.label.trim() !== "" && Number.isFinite(item.amount));
}
