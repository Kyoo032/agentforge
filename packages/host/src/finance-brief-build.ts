import { ApiError } from "@agentforge/core";
import { financeBriefSchema, markdownTable, type FinanceBrief, type FinanceSection } from "@agentforge/core/artifacts";
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
    throw new ApiError(
      "invalid_request",
      "items must be a non-empty list of line items with a label and a numeric amount",
      400,
    );
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

export function parseBriefDraft(raw: string): BriefDraft {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  } catch {
    throw new ApiError("invalid_finance", "Model returned invalid JSON for the finance brief", 502);
  }
  const sections = (Array.isArray(parsed.sections) ? parsed.sections : [])
    .map((item) => {
      const record = (item ?? {}) as Record<string, unknown>;
      return { heading: text(record.heading), body: text(record.body), metrics: stringList(record.metrics, 20) };
    })
    .filter((section) => section.heading && section.body);
  if (sections.length === 0) {
    throw new ApiError("invalid_finance", "Model returned no sections", 502);
  }
  return { title: text(parsed.title) || "Finance brief", sections, assumptions: stringList(parsed.assumptions, 30) };
}

export function parseBriefSection(raw: string): BriefDraft["sections"][number] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  } catch {
    throw new ApiError("invalid_finance", "Model returned invalid JSON for the section", 502);
  }
  const section = { heading: text(parsed.heading), body: text(parsed.body), metrics: stringList(parsed.metrics, 20) };
  if (!section.heading || !section.body) {
    throw new ApiError("invalid_finance", "Model returned an empty section", 502);
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

/** The model sees inputs and computed metrics as Markdown tables, never raw prose numbers. */
export function financePromptBlock(inputs: FinanceInputs, computed: ComputedFinance): string {
  const items = markdownTable(
    ["Label", "Period", "Category", "Amount", "Currency"],
    inputs.items.map((item) => [item.label, item.period, item.category, item.amount, item.currency]),
  );
  const metrics = markdownTable(
    ["Key", "Metric", "Value", "Period", "Formula"],
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
    "Line items (the only inputs):",
    items,
    params ? `Parameters:\n${params}` : null,
    "Computed metrics (already calculated in code; cite by key):",
    metrics || "(none could be computed from these items)",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export { UNVERIFIED_MARKER, computeFinance };
