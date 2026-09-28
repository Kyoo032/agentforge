/**
 * The financial brief as a task module.
 *
 * This is the reference implementation of the seam, not a second pipeline: the maths is the
 * `computeFinance` the brief has always run and the report is the `financeReportFromBrief` the
 * renderers have always read. The brief's own host path still calls those two directly, so nothing
 * about today's output moves; this module is what the four task flows are written against.
 */
import { z } from "zod";
import type { FinanceBrief } from "../../artifacts/finance-brief";
import type { DirectionClaim } from "../claim-direction";
import { formatMetricValue } from "../format-number";
import { computeFinance, type ComputedFinance, type FinanceParams } from "../metrics";
import { financeReportFromBrief } from "../report-brief";
import type { FinanceReport, ReportLocale } from "../report";
import { lineItemsSchema } from "../types";
import type { FinanceTaskModule, FinanceTaskProse, FinanceTaskReportOptions } from "./types";

/** The optional knobs `FinanceParams` carries, as a boundary schema. */
export const briefParamsSchema = z.object({
  discountRatePercent: z.number().finite().optional(),
  pricePerUnit: z.number().finite().optional(),
  variableCostPerUnit: z.number().finite().optional(),
  fixedCosts: z.number().finite().optional(),
});

/** Confirmed line items plus the optional parameters. Free text never reaches a task module. */
export const briefInputSchema = z.object({
  items: lineItemsSchema,
  params: briefParamsSchema.default({}),
});

export type BriefTaskInput = z.infer<typeof briefInputSchema>;

const FACTS_HEADING: Record<ReportLocale, string> = {
  en: "Computed metrics (already calculated in code; cite by key):",
  id: "Metrik terhitung (sudah dihitung di kode; kutip lewat key-nya):",
};

const FACTS_EMPTY: Record<ReportLocale, string> = {
  en: "(nothing could be computed from these items)",
  id: "(tidak ada yang bisa dihitung dari baris ini)",
};

function briefFrom(computed: ComputedFinance, prose: FinanceTaskProse): FinanceBrief {
  return {
    title: prose.title,
    sections: prose.sections.map((section) => ({
      heading: section.heading,
      body: section.body,
      tables: [],
      metrics: [],
    })),
    assumptions: [...prose.assumptions],
    computed: { metrics: computed.metrics, tables: computed.tables },
  };
}

function factLine(key: string, label: string, value: string, period: string, formula: string): string {
  return `- ${key} | ${label} | ${value} | ${period} | ${formula}`;
}

export const briefTaskModule: FinanceTaskModule<BriefTaskInput, ComputedFinance> = {
  id: "brief",
  inputSchema: briefInputSchema,
  compute(input: BriefTaskInput): ComputedFinance {
    return computeFinance(input.items, input.params as FinanceParams);
  },
  buildReport(
    computed: ComputedFinance,
    prose: FinanceTaskProse,
    options: FinanceTaskReportOptions = {},
  ): FinanceReport {
    return financeReportFromBrief(briefFrom(computed, prose), { task: "brief", ...options });
  },
  promptFacts(computed: ComputedFinance, locale: ReportLocale): string {
    // The model is handed the finished spelling, never the raw double: given `0.8382016764033529`
    // it writes `0.8382016764033529`, and given `0.8%` it writes `0.8%`.
    const lines = computed.metrics.map((metric) =>
      factLine(metric.key, metric.label, formatMetricValue(metric, locale), metric.period, metric.formula),
    );
    const heading = FACTS_HEADING[locale] ?? FACTS_HEADING.en;
    return lines.length === 0
      ? `${heading}\n${FACTS_EMPTY[locale] ?? FACTS_EMPTY.en}`
      : `${heading}\n${lines.join("\n")}`;
  },
  allowedNumbers(input: BriefTaskInput, computed: ComputedFinance): readonly number[] {
    return [...new Set([...input.items.map((item) => item.amount), ...computed.allowed])];
  },
  /** The brief's headings are the model's own — three to six of them — so it declares none. */
  sections: Object.freeze([]),
  directionClaims: briefDirectionClaims,
};

const PROFIT_WORDS: DirectionClaim["agree"] = [
  { en: "a profit", id: "laba" },
  { en: "profitable", id: "menguntungkan" },
];
const LOSS_WORDS: DirectionClaim["agree"] = [
  { en: "a loss", id: "rugi" },
  { en: "is a loss", id: "merugi" },
];

/** The sign of operating profit and of net profit. A zero, or a metric with no value, says nothing. */
export function briefDirectionClaims(computed: ComputedFinance): readonly DirectionClaim[] {
  return computed.metrics.flatMap((metric) => {
    const profit = metric.key.startsWith("operating_profit") || metric.key.startsWith("net_profit");
    if (!profit || metric.value === null || !Number.isFinite(metric.value) || metric.value === 0) {
      return [];
    }
    const loss = metric.value < 0;
    return [
      {
        amount: metric.value,
        agree: loss ? LOSS_WORDS : PROFIT_WORDS,
        contradict: loss ? PROFIT_WORDS : LOSS_WORDS,
      },
    ];
  });
}
