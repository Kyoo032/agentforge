/**
 * Investment appraisal as a task module.
 *
 * The flow it serves: an outlay and the yearly flows, one discount rate, the rows confirmed, then
 * NPV, IRR, both paybacks and a sensitivity grid computed in code, and a memo written over those
 * figures and nothing else. Everything arithmetic lives in `../appraisal/**`; this file is the seam
 * — a schema at the boundary, the four pieces the runner asks for, and no pipeline of its own.
 *
 * The IRR is the part worth naming here: it is reported only after a scan confirms NPV(r) crosses
 * zero exactly once. A plan with a negative year mid-life can have three roots, and a bisection
 * answers just as confidently in that case as in this one.
 */
import { z } from "zod";
import { computeAppraisal, type AppraisalComputed, type AppraisalParams } from "../appraisal/compute";
import { appraisalAllowedNumbers, appraisalPromptFacts } from "../appraisal/facts";
import { APPRAISAL_SECTIONS } from "../appraisal/labels";
import { appraisalReport } from "../appraisal/report";
import type { FinanceReport, ReportLocale } from "../report";
import { lineItemsSchema } from "../types";
import type { FinanceTaskModule, FinanceTaskProse, FinanceTaskReportOptions } from "./types";

/** Used only when the request carries no rate at all; the report says so in its own subtitle. */
export const DEFAULT_APPRAISAL_RATE_PERCENT = 10;
/** More axes than this is not a grid a reader can hold, and not a request we honour silently. */
export const APPRAISAL_AXIS_MAX = 12;

const ratePercent = z.number().finite().gt(-100).lt(1000);
const shiftPercent = z.number().finite().gte(-100).lte(1000);

/**
 * The knobs an appraisal takes. The rate arrives as `discountRate` from the prompt bar and as
 * `discountRatePercent` from the parameters panel, and both mean the same thing — so both are
 * accepted rather than one of them being silently dropped.
 */
export const appraisalParamsSchema = z.object({
  discountRatePercent: ratePercent.optional(),
  discountRate: ratePercent.optional(),
  rateScenarios: z.array(ratePercent).max(APPRAISAL_AXIS_MAX).optional(),
  ratePercents: z.array(ratePercent).max(APPRAISAL_AXIS_MAX).optional(),
  cashFlowShifts: z.array(shiftPercent).max(APPRAISAL_AXIS_MAX).optional(),
  shiftPercents: z.array(shiftPercent).max(APPRAISAL_AXIS_MAX).optional(),
  financeRatePercent: ratePercent.optional(),
  reinvestRatePercent: ratePercent.optional(),
  currency: z.string().trim().max(16).optional(),
});

/** Confirmed rows plus the optional parameters. Free text never reaches a task module. */
export const appraisalInputSchema = z.object({
  items: lineItemsSchema,
  params: appraisalParamsSchema.default({}),
});

export type AppraisalTaskInput = z.infer<typeof appraisalInputSchema>;

/** The two spellings of every axis, resolved once, so `compute` sees one shape. */
export function appraisalParamsFrom(params: AppraisalTaskInput["params"]): AppraisalParams {
  const rates = params.ratePercents ?? params.rateScenarios;
  const shifts = params.shiftPercents ?? params.cashFlowShifts;
  return {
    discountRatePercent: params.discountRatePercent ?? params.discountRate ?? DEFAULT_APPRAISAL_RATE_PERCENT,
    ...(rates && rates.length > 0 ? { ratePercents: rates } : {}),
    ...(shifts && shifts.length > 0 ? { shiftPercents: shifts } : {}),
    ...(params.financeRatePercent === undefined ? {} : { financeRatePercent: params.financeRatePercent }),
    ...(params.reinvestRatePercent === undefined ? {} : { reinvestRatePercent: params.reinvestRatePercent }),
    ...(params.currency ? { currency: params.currency } : {}),
  };
}

export const appraisalTaskModule: FinanceTaskModule<AppraisalTaskInput, AppraisalComputed> = {
  id: "appraisal",
  inputSchema: appraisalInputSchema,
  compute(input: AppraisalTaskInput): AppraisalComputed {
    return computeAppraisal(input.items, appraisalParamsFrom(input.params));
  },
  buildReport(
    computed: AppraisalComputed,
    prose: FinanceTaskProse,
    options: FinanceTaskReportOptions = {},
  ): FinanceReport {
    return appraisalReport(computed, prose, options);
  },
  promptFacts(computed: AppraisalComputed, locale: ReportLocale): string {
    return appraisalPromptFacts(computed, locale);
  },
  allowedNumbers(input: AppraisalTaskInput, computed: AppraisalComputed): readonly number[] {
    return appraisalAllowedNumbers(input.items, computed);
  },
  sections: APPRAISAL_SECTIONS,
};
