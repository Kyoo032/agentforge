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

/** The title a brief takes when the model gave none, or gave one stating a figure nobody can trace. */
export const DEFAULT_BRIEF_TITLE = "Finance brief";

/** The section index a flag carries when its figure sat outside every section: a title or an assumption. */
export const GUARD_OUTSIDE_SECTIONS = -1;

/** What a heading becomes when the untraced figure was all it said. A heading may not be empty. */
const EMPTIED_LABEL = "…";

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
  return {
    title: text(parsed.title) || DEFAULT_BRIEF_TITLE,
    sections,
    assumptions: stringList(parsed.assumptions, 30),
  };
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

export type GuardedLabel = { text: string; flagged: string[] };

/**
 * A heading with every figure the guard cannot trace cut out of it, and the words around it kept.
 *
 * A heading is not a sentence the repair rewrites or removes, and the marker may never reach a
 * reader, so the figure is taken out where it stands. Only a heading that said nothing but the
 * figure falls back.
 */
export function guardLabel(label: string, allowed: readonly number[], fallback = EMPTIED_LABEL): GuardedLabel {
  const guarded = guardNumbers(label, allowed);
  if (guarded.flagged.length === 0) {
    return { text: label, flagged: [] };
  }
  const text = guarded.text
    .split(UNVERIFIED_MARKER)
    .join(" ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:–—-]+|[\s,;:–—-]+$/g, "");
  return { text: /\p{L}/u.test(text) ? text : fallback, flagged: guarded.flagged.map((token) => token.text) };
}

/**
 * A title that states a figure nobody can trace is replaced whole: a headline with a hole cut in it
 * reads worse than a plain one, and the title is the first thing the reader and the file name see.
 */
export function guardTitle(title: string, allowed: readonly number[], fallback: string): GuardedLabel {
  const flagged = guardNumbers(title, allowed).flagged.map((token) => token.text);
  return { text: flagged.length === 0 ? title : fallback, flagged };
}

/**
 * The assumptions, less every one that rests on a figure nobody computed. An assumption is one claim
 * the reader is asked to accept, so it goes whole, and the count says how many went.
 */
export function guardAssumptions(
  assumptions: readonly string[],
  allowed: readonly number[],
): { assumptions: string[]; flagged: string[]; removed: number } {
  const guarded = assumptions.map((assumption) => ({
    assumption,
    flagged: guardNumbers(assumption, allowed).flagged.map((token) => token.text),
  }));
  const kept = guarded.filter((entry) => entry.flagged.length === 0);
  return {
    assumptions: kept.map((entry) => entry.assumption),
    flagged: guarded.flatMap((entry) => entry.flagged),
    removed: guarded.length - kept.length,
  };
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
  const heading = guardLabel(section.heading, computed.allowed);
  const guarded = guardNumbers(section.body, computed.allowed);
  return {
    section: {
      heading: heading.text,
      body: guarded.text,
      tables: [],
      metrics: section.metrics.filter((key) => knownKeys.has(key)),
    },
    flagged: [...heading.flagged, ...guarded.flagged.map((token) => token.text)],
  };
}

/**
 * The draft with every figure the engine cannot vouch for dealt with — in the bodies, and in the
 * title, the headings and the assumptions, which are model prose too and are read first.
 */
export function buildFinanceBrief(
  draft: BriefDraft,
  computed: ComputedFinance,
): { brief: FinanceBrief; guard: GuardReport } {
  const knownKeys = new Set(computed.metrics.map((entry) => entry.key));
  const title = guardTitle(draft.title, computed.allowed, DEFAULT_BRIEF_TITLE);
  const guardedSections = draft.sections.map((section) => guardSection(section, computed, knownKeys));
  const assumptions = guardAssumptions(draft.assumptions, computed.allowed);
  const flagged = [
    ...title.flagged.map((token) => ({ section: GUARD_OUTSIDE_SECTIONS, text: token })),
    ...guardedSections.flatMap((entry, index) => entry.flagged.map((token) => ({ section: index, text: token }))),
    ...assumptions.flagged.map((token) => ({ section: GUARD_OUTSIDE_SECTIONS, text: token })),
  ];
  const brief = financeBriefSchema.parse({
    title: title.text,
    sections: guardedSections.map((entry) => entry.section),
    assumptions: assumptions.assumptions,
    computed: { metrics: computed.metrics, tables: computed.tables },
  });
  return {
    brief,
    guard: { flagged, total: flagged.length, ...(assumptions.removed > 0 ? { removed: assumptions.removed } : {}) },
  };
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
