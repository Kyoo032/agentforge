/**
 * The shared case contract, checked at the boundary.
 *
 * Case authors and the runner are different people working in parallel, so a
 * malformed `case.json` has to fail loudly at load time with the field named —
 * not halfway through a five-minute run, and never as a silently missing figure
 * that quietly improves a score.
 */
import { z } from "zod";

export const FINANCE_TASKS = ["brief", "cashflow", "budget", "appraisal", "ratios"];
export const FIGURE_UNITS = ["percent", "currency", "ratio", "months", "years", "count", "number"];

const lineItemSchema = z.object({
  label: z.string().min(1),
  period: z.string().default(""),
  amount: z.number().finite(),
  category: z.string().optional(),
  currency: z.string().optional(),
});

const figureSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  /**
   * `null` is a real expectation and not a gap in the case: there is no such
   * number — a variance percentage against a budget of zero, a ratio with no
   * denominator — so the report must report it as n/a and must not state a value.
   * These are scored in their own `naFigures` block, out of the headline accuracy,
   * and a number stated for one of them fails the case outright.
   */
  value: z.number().finite().nullable(),
  /** One of FIGURE_UNITS; anything else is scored as a plain number. */
  unit: z.string().default("number"),
  /**
   * ABSOLUTE tolerance, in the figure's own unit. The product's own guard
   * tolerance is always the floor underneath it, so a case can tighten nothing
   * below what the app itself calls verified — see README.
   */
  tolerance: z.number().min(0).optional(),
  /** `prose` figures are argued in the narrative on purpose and tallied separately. */
  source: z.string().default("structured"),
});

const budgetPairSchema = z.object({
  label: z.string().min(1),
  planned: z.number().finite(),
  actual: z.number().finite(),
  variance: z.number().finite().optional(),
});

/**
 * Planned-vs-actual as the budget case authors write it: a budget row paired with
 * its actual.
 *
 * Every field here is nullable on purpose. A budget-only line has `actualLabel:
 * null`; an actual-only line has `budgetLabel: null`; and a line whose budget is
 * zero has `variancePct: null`, because a percentage of nothing is not a number.
 * The scorer reads each null as "the report must not state a value here", which is
 * the only reading that keeps an honest n/a apart from a missing figure.
 */
const varianceSchema = z
  .object({
    slug: z.string().optional(),
    label: z.string().nullable().optional(),
    budgetLabel: z.string().nullable().optional(),
    actualLabel: z.string().nullable().optional(),
    budget: z.number().finite().nullable().optional(),
    actual: z.number().finite().nullable().optional(),
    variance: z.number().finite().nullable().optional(),
    variancePct: z.number().finite().nullable().optional(),
    direction: z.string().optional(),
    flagged: z.boolean().optional(),
    fullYear: z
      .object({
        budget: z.number().finite(),
        actual: z.number().finite(),
        variance: z.number().finite().optional(),
      })
      .optional(),
  })
  .passthrough();

const piiSchema = z
  .object({
    /** Free text: cases carry Indonesian kinds (`nik`, `npwp`) the product's scanner has no rule for. */
    kind: z.string().min(1),
    value: z.string().optional(),
    match: z.string().optional(),
  })
  .passthrough();

const truthSchema = z
  .object({
    lineItems: z.array(lineItemSchema).default([]),
    figures: z.array(figureSchema).default([]),
    budgetPairs: z.array(budgetPairSchema).optional(),
    variances: z.array(varianceSchema).optional(),
    /**
     * Budget lines the case says cross the flag threshold, by slug or by label.
     * A yearly case writes one list; a quarterly one writes a list per period
     * (`{ "Q1": [...], "Q2": [...] }`). Both are accepted and flattened.
     */
    flagged: z.union([z.array(z.string()), z.record(z.array(z.string()))]).optional(),
    pii: z.array(piiSchema).optional(),
    /**
     * Values that are NOT personal data and must survive redaction — a bank's
     * name on a payroll sheet, a vendor. Absent means the retention half of the
     * privacy check is reported as "not asked" rather than silently passed.
     */
    piiMustRemain: z.array(z.string()).optional(),
    mustMention: z.array(z.string()).default([]),
    mustNotContain: z.array(z.string()).default([]),
  })
  .passthrough();

export const caseSchema = z
  .object({
    id: z.string().min(1),
    task: z.enum(FINANCE_TASKS),
    locale: z.enum(["id", "en"]).default("en"),
    currency: z.string().default(""),
    description: z.string().default(""),
    files: z.array(z.object({ path: z.string().min(1), sheet: z.string().optional() })).default([]),
    /** A case with no file may carry its figures inline; the import stage is then skipped. */
    figuresText: z.string().optional(),
    prompt: z.string().min(1),
    /**
     * Whatever the case's own generator needed. Only the numeric keys the host
     * knows (`discountRatePercent`, `fixedCosts`, …) reach the engine; the rest
     * rides along as documentation of how the truth was built.
     */
    params: z.record(z.any()).default({}),
    exports: z.array(z.enum(["xlsx", "pptx", "docx", "md"])).optional(),
    /** Some cases carry their planted personal data at the top level rather than under `truth`. */
    pii: z.array(piiSchema).optional(),
    truth: truthSchema,
  })
  .passthrough();

/** Parse one case, naming the file and the field when it is wrong. */
export function readCase(raw, dir, file) {
  const parsed = caseSchema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`${file} is not a valid case:\n  - ${where.join("\n  - ")}`);
  }
  return { ...parsed.data, dir };
}
