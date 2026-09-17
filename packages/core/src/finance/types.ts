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

/**
 * One amount column of an entity-per-row register, kept on the row it came from.
 *
 * A payroll row is `gaji pokok`, `tunjangan`, `potongan` and `gaji bersih` — four columns describing
 * ONE payment, so they are facts about the row and never rows of their own. `extra` marks a column
 * that is a separate payment (a reimbursement paid on top), which is the only kind that adds to what
 * the entity was actually paid.
 */
export const registerCellSchema = z.object({
  label: z.string().min(1),
  amount: z.number().finite(),
  extra: z.boolean().optional(),
});

export type RegisterCell = z.infer<typeof registerCellSchema>;

/** One figure the user supplied. Everything the engine computes traces back to these. */
export const lineItemSchema = z.object({
  label: z.string().min(1),
  /** Free text: "2025", "Q1 2026", "Jan", "monthly". Empty means a single, undated figure. */
  period: z.string().default(""),
  amount: z.number().finite(),
  currency: z.string().default(""),
  category: z.enum(LINE_ITEM_CATEGORIES).default("other"),
  /** True when the row is a subtotal of the other rows: kept for display, never summed. */
  derived: z.boolean().optional(),
  /** Every amount column the row had, when it came from an entity-per-row register. */
  columns: z.array(registerCellSchema).optional(),
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
