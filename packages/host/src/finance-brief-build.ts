import { ApiError, type AppLocale } from "@agentforge/core";
import { financeBriefSchema, markdownTable, type FinanceBrief, type FinanceSection } from "@agentforge/core/artifacts";
import {
  UNVERIFIED_MARKER,
  computeFinance,
  formatMetricValue,
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
  /** Sentences taken out because their figure could not be traced even after one rewrite. */
  removed?: number;
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

const WRITE_AS: Record<AppLocale, string> = {
  en: 'Write every figure exactly as its "Write as" cell spells it. Never reformat, re-round or re-group a number.',
  id: 'Tulis setiap angka persis seperti di kolom "Tulis sebagai". Jangan mengubah format, pembulatan atau pemisah ribuannya.',
};

type PromptWords = {
  readonly value: string;
  readonly items: string;
  readonly metrics: string;
  readonly stated: string;
  readonly params: string;
  readonly empty: string;
};

const WORDS: Record<AppLocale, PromptWords> = {
  en: {
    value: "Write as",
    items: "Line items (the only inputs):",
    metrics: "Computed metrics (already calculated in code; cite by key):",
    stated: "Stated in the source (the sheet's own totals, which agree with ours):",
    params: "Parameters:",
    empty: "(none could be computed from these items)",
  },
  id: {
    value: "Tulis sebagai",
    items: "Baris angka (satu-satunya masukan):",
    metrics: "Metrik terhitung (sudah dihitung di kode; kutip lewat key-nya):",
    stated: "Tertulis di sumber (total milik lembar itu sendiri, yang cocok dengan hitungan kami):",
    params: "Parameter:",
    empty: "(tidak ada yang bisa dihitung dari baris ini)",
  },
};

function currencyOf(items: readonly LineItem[]): string {
  return items.find((item) => item.currency)?.currency ?? "";
}

function statedBlock(
  computed: ComputedFinance,
  currency: string,
  locale: AppLocale,
  words: PromptWords,
): string | null {
  const stated = (computed.checks ?? []).filter((check) => check.matches !== false);
  if (stated.length === 0) {
    return null;
  }
  const table = markdownTable(
    ["Label", "Period", words.value],
    stated.map((check) => [
      check.label,
      check.period,
      formatMetricValue({ value: check.stated, unit: currency }, locale),
    ]),
  );
  return `${words.stated}\n${table}`;
}

/**
 * The model sees inputs and computed metrics as Markdown tables, never raw prose numbers — and every
 * figure arrives already written the way the reader should read it, so "copy this" is the only
 * instruction it needs and a 29.1282% can never reach a sentence.
 */
export function financePromptBlock(inputs: FinanceInputs, computed: ComputedFinance, locale: AppLocale = "en"): string {
  const words = WORDS[locale] ?? WORDS.en;
  const currency = currencyOf(inputs.items);
  const items = markdownTable(
    ["Label", "Period", "Category", "Amount", "Currency", words.value],
    inputs.items.map((item) => [
      item.label,
      item.period,
      item.category,
      item.amount,
      item.currency,
      formatMetricValue({ value: item.amount, unit: item.currency || currency }, locale),
    ]),
  );
  const metrics = markdownTable(
    ["Key", "Metric", words.value, "Period", "Formula"],
    computed.metrics.map((entry) => [
      entry.key,
      entry.label,
      formatMetricValue(entry, locale),
      entry.period,
      entry.formula,
    ]),
  );
  const params = Object.entries(inputs.params)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");
  return [
    WRITE_AS[locale] ?? WRITE_AS.en,
    words.items,
    items,
    params ? `${words.params}\n${params}` : null,
    words.metrics,
    metrics || words.empty,
    statedBlock(computed, currency, locale, words),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export { UNVERIFIED_MARKER, computeFinance };
