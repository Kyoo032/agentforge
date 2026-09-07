import { z } from "zod";

export const LINE_ITEM_CATEGORIES = [
  "revenue",
  "cogs",
  "opex",
  "cash",
  "debt",
  "equity",
  "asset",
  "liability",
  "other",
] as const;

export type LineItemCategory = (typeof LINE_ITEM_CATEGORIES)[number];

/** One figure the user supplied. Everything the engine computes traces back to these. */
export const lineItemSchema = z.object({
  label: z.string().min(1),
  /** Free text: "2025", "Q1 2026", "Jan", "monthly". Empty means a single, undated figure. */
  period: z.string().default(""),
  amount: z.number().finite(),
  currency: z.string().default(""),
  category: z.enum(LINE_ITEM_CATEGORIES).default("other"),
});

export type LineItem = z.infer<typeof lineItemSchema>;

export const lineItemsSchema = z.array(lineItemSchema).min(1);

export type Metric = {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  period: string;
  formula: string;
};

export type CashFlow = { period: string; amount: number };
