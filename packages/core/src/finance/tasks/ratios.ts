/**
 * Ratio health check — the task module.
 *
 * The seam's four pieces, and nothing else: the confirmed input's schema, the pure maths, the fact
 * sheet the model is given, and the figures the guard will take back. The flow behind it is the one
 * its graph draws — balance sheet and P&L in, rows classified into buckets the reader confirms,
 * liquidity / leverage / coverage computed in code, each banded against a documented rule-of-thumb
 * threshold, and a scorecard out.
 *
 * Two decisions are visible from here. Where a ratio has more than one honest reading, this task
 * reports **all** of them, labelled — three debt-to-equity figures and two DSCR bases. And the
 * requested locale rides on the confirmed input, so the report and the fact sheet are written in the
 * language the request asked for rather than the one the process happened to boot in.
 */
import { z } from "zod";
import type { FinanceReport, ReportLocale } from "../report";
import { lineItemsSchema } from "../types";
import { ratioBandOverrideSchema, ratioBandTable } from "../ratios/bands";
import { classifyRatioRows, ratioBucketOverrideSchema, type RatioRowInput } from "../ratios/classify";
import { computeRatios, type ComputedRatios, type RatioParams, type RatioSupporting } from "../ratios/compute";
import { ratioStatedRowSchema } from "../ratios/stated";
import { ratioAllowedNumbers, ratioPromptFacts } from "../ratios/facts";
import { ratioReport } from "../ratios/report";
import type { FinanceTaskModule, FinanceTaskProse, FinanceTaskReportOptions, FinanceTaskSection } from "./types";

/**
 * The knobs beside the rows. `catchall` is here for one reason: a supporting figure may arrive
 * keyed by period (`principalRepayment2024`), which is how a caller says "this year's repayment"
 * without inventing a nested shape. Everything else is named and validated.
 */
export const ratiosParamsSchema = z
  .object({
    daysPerYear: z.number().finite().positive().optional(),
    depreciation: z.number().finite().optional(),
    principalRepayment: z.number().finite().optional(),
    /** Buckets the reader confirmed or changed in the studio. */
    buckets: z.array(ratioBucketOverrideSchema).default([]),
    /** Thresholds the reader moved. The defaults are documented in `ratios/bands.ts`. */
    bands: z.array(ratioBandOverrideSchema).default([]),
    /**
     * The subtotal rows the statement printed, forwarded by the parse. They are never summed with
     * the confirmed rows: they are what those rows are checked against, and what a bucket the sheet
     * printed a total for but no line of is rebuilt from (`ratios/reconcile.ts`).
     */
    stated: z.array(ratioStatedRowSchema).default([]),
    /** The period the scorecard reads. Defaults to the newest the rows carry. */
    period: z.string().optional(),
  })
  .catchall(z.unknown());

export const ratiosInputSchema = z.object({
  items: lineItemsSchema,
  params: ratiosParamsSchema.default({}),
  /** The language the answer was asked for, when the caller says so. */
  locale: z.enum(["id", "en"]).optional(),
});

export type RatiosTaskInput = z.infer<typeof ratiosInputSchema>;

/** What `compute` hands on: the maths, plus the two things the report needs that are not maths. */
export type RatiosComputed = {
  readonly ratios: ComputedRatios;
  readonly locale: ReportLocale | null;
  readonly period: string;
};

/** `principalRepayment2024` → the 2024 supporting figure. The suffix is a period label, not a number. */
const SUPPORTING_KEYS: readonly (readonly [RegExp, keyof RatioSupporting])[] = Object.freeze([
  [/^principalRepayments?(.+)$/, "principalRepayment"],
  [/^depreciationAmorti[sz]ation(.+)$/, "depreciation"],
  [/^depreciation(.+)$/, "depreciation"],
]);

function supportingFrom(params: RatiosTaskInput["params"]): Record<string, RatioSupporting> {
  const out: Record<string, RatioSupporting> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    const hit = SUPPORTING_KEYS.map(([pattern, field]) => ({ field, period: pattern.exec(key)?.[1] })).find(
      (entry) => entry.period !== undefined,
    );
    if (hit?.period) {
      out[hit.period] = { ...out[hit.period], [hit.field]: value };
    }
  }
  return out;
}

function ratioParamsFrom(params: RatiosTaskInput["params"], locale: ReportLocale | null): RatioParams {
  return {
    ...(params.daysPerYear === undefined ? {} : { daysPerYear: params.daysPerYear }),
    ...(params.depreciation === undefined ? {} : { depreciation: params.depreciation }),
    ...(params.principalRepayment === undefined ? {} : { principalRepayment: params.principalRepayment }),
    supporting: supportingFrom(params),
    stated: params.stated,
    ...(locale === null ? {} : { locale }),
  };
}

function toRatioRow(item: RatiosTaskInput["items"][number]): RatioRowInput {
  return {
    label: item.label,
    period: item.period,
    amount: item.amount,
    currency: item.currency,
    category: item.category,
  };
}

/** The four sections the scorecard is narrated in, matching this task's `sections` in `../tasks.ts`. */
const SECTIONS: readonly FinanceTaskSection[] = Object.freeze([
  { id: "scorecard", title: { id: "Kartu skor", en: "Scorecard" } },
  { id: "liquidity", title: { id: "Likuiditas", en: "Liquidity" } },
  { id: "leverage", title: { id: "Beban utang", en: "Leverage" } },
  { id: "coverage", title: { id: "Kemampuan bayar", en: "Coverage" } },
]);

export const ratiosTaskModule: FinanceTaskModule<RatiosTaskInput, RatiosComputed> = {
  id: "ratios",
  inputSchema: ratiosInputSchema,
  compute(input: RatiosTaskInput): RatiosComputed {
    const rows = classifyRatioRows(input.items.map(toRatioRow), input.params.buckets);
    const locale = input.locale ?? null;
    const ratios = computeRatios(rows, ratioParamsFrom(input.params, locale), ratioBandTable(input.params.bands));
    return {
      ratios,
      locale,
      period: input.params.period && ratios.periods.includes(input.params.period) ? input.params.period : ratios.latest,
    };
  },
  buildReport(
    computed: RatiosComputed,
    prose: FinanceTaskProse,
    options: FinanceTaskReportOptions = {},
  ): FinanceReport {
    return ratioReport(computed.ratios, prose, {
      // The request's own locale wins: a report asked for in Indonesian is written in Indonesian
      // whichever language the host process booted in.
      locale: computed.locale ?? options.locale ?? "en",
      period: computed.period,
      ...(options.subtitle ? { subtitle: options.subtitle } : {}),
      ...(options.guard ? { guard: options.guard } : {}),
    });
  },
  promptFacts(computed: RatiosComputed, locale: ReportLocale): string {
    return ratioPromptFacts(computed.ratios, computed.locale ?? locale);
  },
  allowedNumbers(input: RatiosTaskInput, computed: RatiosComputed): readonly number[] {
    return [...new Set([...input.items.map((item) => item.amount), ...ratioAllowedNumbers(computed.ratios)])];
  },
  sections: SECTIONS,
};
