import { ApiError } from "@agentforge/core";
import {
  financeBriefSchema,
  markdownTable,
  type FinanceBrief,
  type FinanceBriefLabels,
  type FinanceSection,
} from "@agentforge/core/artifacts";
import {
  UNVERIFIED_MARKER,
  computeFinance,
  formatMetricForPrompt,
  guardNumbers,
  lineItemsSchema,
  type ComputedFinance,
  type FinanceParams,
  type LineItem,
} from "@agentforge/core/finance";
import { type AppLocale, financeCopy, localizeMetricLabel } from "./finance-locale";
import { extractJsonObject } from "./presentation-outline";

export const FINANCE_PARAM_KEYS = ["discountRatePercent", "pricePerUnit", "variableCostPerUnit", "fixedCosts"] as const;

export type BriefDraft = {
  title: string;
  sections: Array<{ heading: string; body: string; metrics: string[] }>;
  assumptions: string[];
};

export type GuardReport = {
  /** Section index → figures that did not trace back to inputs or computed metrics. */
  flagged: Array<{ section: number; text: string }>;
  total: number;
};

export type FinanceInputs = { items: LineItem[]; params: FinanceParams };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown, cap: number): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, cap) : [];
}

/** Line items and params from a request body. Items must already be confirmed by the user. */
export function readFinanceInputs(body: unknown): FinanceInputs | null {
  const record = (body ?? {}) as { items?: unknown; params?: unknown };
  if (record.items === undefined) {
    return null;
  }
  const parsed = lineItemsSchema.safeParse(record.items);
  if (!parsed.success) {
    throw new ApiError("invalid_request", financeCopy().errors.itemsInvalid, 400);
  }
  const rawParams = (record.params ?? {}) as Record<string, unknown>;
  const params: FinanceParams = {};
  for (const key of FINANCE_PARAM_KEYS) {
    const value = rawParams[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      params[key] = value;
    }
  }
  return { items: parsed.data, params };
}

export function parseBriefDraft(raw: string, locale?: AppLocale): BriefDraft {
  const copy = financeCopy(locale);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  } catch {
    throw new ApiError("invalid_finance", copy.errors.invalidBriefJson, 502);
  }
  const sections = (Array.isArray(parsed.sections) ? parsed.sections : [])
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return { heading: text(record.heading), body: text(record.body), metrics: stringList(record.metrics, 20) };
    })
    .filter((section) => section.heading && section.body);
  if (sections.length === 0) {
    throw new ApiError("invalid_finance", copy.errors.noSections, 502);
  }
  return {
    title: text(parsed.title) || copy.pipeline.fallbackTitle,
    sections,
    assumptions: stringList(parsed.assumptions, 30),
  };
}

export function parseBriefSection(raw: string, locale?: AppLocale): BriefDraft["sections"][number] {
  const copy = financeCopy(locale);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  } catch {
    throw new ApiError("invalid_finance", copy.errors.invalidSectionJson, 502);
  }
  const section = { heading: text(parsed.heading), body: text(parsed.body), metrics: stringList(parsed.metrics, 20) };
  if (!section.heading || !section.body) {
    throw new ApiError("invalid_finance", copy.errors.emptySection, 502);
  }
  return section;
}

/** Strip figures the engine cannot vouch for; the brief says "[unverified figure]" instead of inventing. */
export function guardSection(
  section: BriefDraft["sections"][number],
  computed: ComputedFinance,
  knownKeys: Set<string>,
): {
  section: FinanceSection;
  flagged: string[];
} {
  const guarded = guardNumbers(section.body, computed.allowed);
  return {
    section: {
      heading: section.heading,
      body: guarded.text,
      tables: [],
      metrics: section.metrics.filter((key) => knownKeys.has(key)),
    },
    flagged: guarded.flagged.map((token) => token.text),
  };
}

export function buildFinanceBrief(
  draft: BriefDraft,
  computed: ComputedFinance,
): { brief: FinanceBrief; guard: GuardReport } {
  const knownKeys = new Set(computed.metrics.map((entry) => entry.key));
  const guardedSections = draft.sections.map((section) => guardSection(section, computed, knownKeys));
  const flagged = guardedSections.flatMap((entry, index) =>
    entry.flagged.map((token) => ({ section: index, text: token })),
  );
  const brief = financeBriefSchema.parse({
    title: draft.title,
    sections: guardedSections.map((entry) => entry.section),
    assumptions: draft.assumptions,
    computed: { metrics: computed.metrics, tables: computed.tables },
  });
  return { brief, guard: { flagged, total: flagged.length } };
}

export function localizeComputedFinance(computed: ComputedFinance, locale: AppLocale): ComputedFinance {
  const copy = financeCopy(locale);
  return {
    ...computed,
    metrics: computed.metrics.map((entry) => ({
      ...entry,
      label: localizeMetricLabel(entry.label, locale),
      unit: entry.unit === "months" ? copy.metrics.months : entry.unit,
    })),
    tables: computed.tables.map((table) => {
      const name =
        table.name === "Line items"
          ? copy.tables.lineItems
          : table.name === "Totals by period"
            ? copy.tables.totalsByPeriod
            : table.name;
      const columns = table.columns.map((column) => {
        if (column === "Label") return copy.tables.label;
        if (column === "Period") return copy.tables.period;
        if (column === "Category") return copy.tables.category;
        if (column === "Amount") return copy.tables.amount;
        if (column === "Currency") return copy.tables.currency;
        if (column === "(none)") return copy.tables.none;
        return column;
      });
      return { ...table, name, columns };
    }),
  };
}

export function financeMarkdownLabels(locale: AppLocale): FinanceBriefLabels {
  const copy = financeCopy(locale);
  return {
    computedMetrics: copy.preview.computedMetrics,
    assumptions: copy.preview.assumptions,
    noneStated: copy.preview.noneStated,
    missing: copy.metrics.missing,
    metric: copy.preview.metric,
    value: copy.preview.value,
    period: copy.preview.period,
    formula: copy.preview.formula,
  };
}

export function stubFinanceDraft(question: string, computed: ComputedFinance, locale: AppLocale): BriefDraft {
  const copy = financeCopy(locale);
  const metrics = computed.metrics.slice(0, 8);
  const body =
    metrics.length > 0
      ? metrics.map((entry) => `${entry.label}: ${formatMetricForPrompt(entry)}.`).join(" ")
      : copy.stub.empty;
  return {
    title: question.trim().slice(0, 80) || copy.pipeline.fallbackTitle,
    sections: [{ heading: copy.stub.heading, body, metrics: metrics.map((entry) => entry.key) }],
    assumptions: [copy.stub.assumption],
  };
}

/** The model sees inputs and computed metrics as Markdown tables, never raw prose numbers. */
export function financePromptBlock(inputs: FinanceInputs, computed: ComputedFinance, locale: AppLocale = "en"): string {
  const copy = financeCopy(locale);
  const items = markdownTable(
    [copy.tables.label, copy.tables.period, copy.tables.category, copy.tables.amount, copy.tables.currency],
    inputs.items.map((item) => [item.label, item.period, item.category, item.amount, item.currency]),
  );
  const metrics = markdownTable(
    ["Key", copy.preview.metric, copy.preview.value, copy.preview.period, copy.preview.formula],
    computed.metrics.map((entry) => [
      entry.key,
      entry.label,
      formatMetricForPrompt(entry),
      entry.period,
      entry.formula,
    ]),
  );
  const params = Object.entries(inputs.params)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
  return [
    copy.pipeline.lineItemsHeader,
    items,
    params ? `${copy.pipeline.parametersHeader}\n${params}` : null,
    copy.pipeline.metricsHeader,
    metrics || copy.pipeline.metricsNone,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export { UNVERIFIED_MARKER, computeFinance };
