/**
 * The shapes the cash-flow task agrees on: one confirmed row per period and side, the cost behaviour
 * behind each period's outflow, and the typed adjustments a what-if is allowed to make.
 *
 * Everything here is data. The arithmetic lives in `periods.ts`, `burn.ts`, `breakeven.ts` and
 * `scenario.ts`, and every one of those is a pure function over these shapes — no model, no I/O, no
 * clock. A what-if the user types in words is translated into `CashflowAdjustment` values *before* it
 * reaches the maths, and the translation is shown on screen, so the numbers are never a model's.
 */
import { z } from "zod";

/** What one confirmed row is: money in, money out, a funding line, or the balance the book opens on. */
export const CASHFLOW_ROW_KINDS = ["inflow", "outflow", "financing", "opening"] as const;
export type CashflowRowKind = (typeof CASHFLOW_ROW_KINDS)[number];

/**
 * How an outflow behaves when sales move. `variable` rides along with revenue, `fixed` does not, and
 * `oneOff` is a single event that must stay out of any per-period base — a machine overhaul is not a
 * monthly cost and putting it in the breakeven base overstates what the shop has to sell every month.
 */
export const COST_BEHAVIOURS = ["variable", "fixed", "oneOff"] as const;
export type CostBehaviour = (typeof COST_BEHAVIOURS)[number];

/**
 * The named slices a what-if may point at. A closed vocabulary on purpose: an adjustment never carries
 * a label the user typed into the maths, so nothing a reader wrote can widen what the engine touches.
 */
export const CASHFLOW_ROLES = ["rent", "payroll", "marketing", "utilities"] as const;
export type CashflowRole = (typeof CASHFLOW_ROLES)[number];

export const CASHFLOW_TARGETS = ["inflow", "outflow", ...COST_BEHAVIOURS, ...CASHFLOW_ROLES] as const;
export type CashflowTarget = (typeof CASHFLOW_TARGETS)[number];

const roleAmountsSchema = z.object({
  rent: z.number().finite().optional(),
  payroll: z.number().finite().optional(),
  marketing: z.number().finite().optional(),
  utilities: z.number().finite().optional(),
});

export type CashflowRoleAmounts = z.infer<typeof roleAmountsSchema>;

/**
 * The cost behaviour behind one period's cash out. `variable + fixed + oneOff` is that period's whole
 * outflow; `roles` names slices *inside* it (rent sits inside `fixed`), so the two never add up.
 */
export const cashflowBreakdownSchema = z.object({
  variable: z.number().finite().default(0),
  fixed: z.number().finite().default(0),
  oneOff: z.number().finite().default(0),
  roles: roleAmountsSchema.default({}),
});

export type CashflowBreakdown = z.infer<typeof cashflowBreakdownSchema>;

/** One source category and the behaviour the parse assigned it, for the user to confirm or change. */
export const cashflowCategorySchema = z.object({
  label: z.string().min(1),
  kind: z.enum(CASHFLOW_ROW_KINDS),
  behaviour: z.enum(COST_BEHAVIOURS).optional(),
  role: z.enum(CASHFLOW_ROLES).optional(),
  /** 0..1. Below `CASHFLOW_CONFIRM_BELOW` the studio asks before anything is computed. */
  confidence: z.number().min(0).max(1).default(1),
  /**
   * This category's own figure in each period, kept so the reader can move it between variable,
   * fixed and one-off in the studio and watch every derived figure move with it.
   */
  amounts: z
    .array(z.object({ period: z.string(), amount: z.number().finite() }))
    .max(600)
    .optional(),
});

export type CashflowCategory = z.infer<typeof cashflowCategorySchema>;

/** A classification the reader should look at rather than take on trust. */
export const CASHFLOW_CONFIRM_BELOW = 0.8;

/**
 * One confirmed row. It is a `LineItem` with three extra, optional facts the cash-flow flow needs:
 * which side it is, how its cost behaves, and — on the first row only — the classification list the
 * studio shows for confirmation. Extra fields ride along so the row the user confirmed is the row the
 * maths reads, without a second request.
 */
export const cashflowItemSchema = z.object({
  label: z.string().min(1),
  period: z.string().default(""),
  amount: z.number().finite(),
  currency: z.string().default(""),
  category: z.string().default("other"),
  kind: z.enum(CASHFLOW_ROW_KINDS).optional(),
  breakdown: cashflowBreakdownSchema.optional(),
  classification: z.array(cashflowCategorySchema).max(200).optional(),
});

export type CashflowItem = z.infer<typeof cashflowItemSchema>;

/** A percentage move on one slice. `scalesVariable` is the trap the café case is built around. */
const percentAdjustmentSchema = z.object({
  kind: z.literal("percent"),
  target: z.enum(CASHFLOW_TARGETS),
  changePct: z.number().finite(),
  /** True when raising sales also raises the cost of goods that ride along with them. */
  scalesVariable: z.boolean().default(false),
  label: z.string().max(200).optional(),
});

/** A flat amount added to (or taken off) one slice, every period. */
const absoluteAdjustmentSchema = z.object({
  kind: z.literal("absolute"),
  target: z.enum(CASHFLOW_TARGETS),
  amount: z.number().finite(),
  label: z.string().max(200).optional(),
});

/** A new cost that repeats: three engineers at 9k a month is one of these, not a percentage. */
const recurringAdjustmentSchema = z.object({
  kind: z.literal("recurring"),
  amountPerPeriod: z.number().finite(),
  label: z.string().max(200).optional(),
});

/** A single event. It moves the balance once and never enters a per-period burn. */
const oneOffAdjustmentSchema = z.object({
  kind: z.literal("oneOff"),
  amount: z.number().finite(),
  label: z.string().max(200).optional(),
});

export const cashflowAdjustmentSchema = z.discriminatedUnion("kind", [
  percentAdjustmentSchema,
  absoluteAdjustmentSchema,
  recurringAdjustmentSchema,
  oneOffAdjustmentSchema,
]);

export type CashflowAdjustment = z.infer<typeof cashflowAdjustmentSchema>;

export const cashflowScenarioSchema = z.object({
  label: z.string().max(400).default(""),
  adjustments: z.array(cashflowAdjustmentSchema).max(20).default([]),
});

export type CashflowScenario = z.infer<typeof cashflowScenarioSchema>;
