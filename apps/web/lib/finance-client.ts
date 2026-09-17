import type { FinanceBrief } from "@agentforge/core/artifacts";
import type { FinanceParams, FinanceReport, FinanceTask, LineItem, LineItemCategory } from "@agentforge/core/finance";
import { apiFetch } from "./api-client";

export type { FinanceBrief, FinanceParams, FinanceReport, FinanceTask, LineItem, LineItemCategory };

export type GuardReport = { flagged: Array<{ section: number; text: string }>; total: number };

export type FinanceResult = {
  brief: FinanceBrief;
  artifactId: string | null;
  markdown: string;
  guard: GuardReport;
  items: LineItem[];
  /** A task that owns its own maths answers with the report itself; the brief does not. */
  report?: FinanceReport;
  /** What the privacy guard hid before anything reached the model. Absent means nothing was found. */
  pii?: { count: number; kinds?: string[] };
  /** Set only when a stand-in model answered, because the one asked for could not be reached. */
  notice?: { code: string; from: string; to: string };
};

/** The kinds of figure a sentence can state, as the host's own parse answers them. */
export const STATED_FACT_UNITS = ["currency", "percent", "ratio", "months", "count", "number"] as const;

export type StatedFactUnit = (typeof STATED_FACT_UNITS)[number];

/**
 * A figure a document states in a sentence rather than in a table — a headcount, a store count, a
 * current ratio, a dividend. The owner confirms it like a line item, the brief may quote it, and it
 * never enters a sum: it is a quotation, not an input to arithmetic.
 */
export type StatedFact = {
  id: string;
  label: string;
  sentence: string;
  value: number;
  unit: StatedFactUnit;
  currency: string;
};

export type ParsedFigures = { items: LineItem[]; statedFacts: StatedFact[] };

export const LINE_ITEM_CATEGORIES: LineItemCategory[] = [
  "revenue",
  "cogs",
  "opex",
  "cash",
  "debt",
  "equity",
  "asset",
  "liability",
  "other",
];

export const FINANCE_PARAM_FIELDS: Array<{ key: keyof FinanceParams; label: string; hint: string }> = [
  { key: "discountRatePercent", label: "Discount rate %", hint: "Enables NPV / IRR over cash line items by period" },
  { key: "fixedCosts", label: "Fixed costs", hint: "With price and variable cost, enables breakeven" },
  { key: "pricePerUnit", label: "Price per unit", hint: "" },
  { key: "variableCostPerUnit", label: "Variable cost per unit", hint: "" },
];

/** A failed finance request, carrying the host code (`invalid_finance`, `runtime_stub`, …) the studio branches on. */
export class FinanceRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "FinanceRequestError";
    this.code = code;
    this.status = status;
  }
}

function errorCode(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { code?: unknown } }).error;
    if (error && typeof error.code === "string" && error.code.trim()) {
      return error.code;
    }
  }
  return "request_failed";
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new FinanceRequestError(errorCode(data), errorMessage(data, fallback), res.status);
  }
  return data as T;
}

function factsFrom(value: unknown): StatedFact[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const amount = record.value;
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      return [];
    }
    const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : "");
    return [
      {
        id: text("id"),
        label: text("label"),
        sentence: text("sentence"),
        value: amount,
        unit: STATED_FACT_UNITS.find((name) => name === record.unit) ?? "number",
        currency: text("currency"),
      },
    ];
  });
}

export type ParseFiguresOptions = {
  readonly model?: string;
  /**
   * `task` rides along so the host can refuse a task that is not built yet in one place; an absent
   * value is the brief, which is what every older caller means.
   */
  readonly task?: FinanceTask;
  /** A document's prose, so the figures it only ever wrote in a sentence are not lost. */
  readonly proseText?: string;
};

/**
 * Free text → the line items the user must confirm before anything is computed, plus the figures
 * the document stated in its sentences. Amounts are read on the host, in code, either way.
 */
export async function parseFinanceFigures(
  figures: string,
  options: ParseFiguresOptions = {},
): Promise<ParsedFigures> {
  const res = await apiFetch("/api/v1/finance/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      figures,
      model: options.model || undefined,
      task: options.task || undefined,
      proseText: options.proseText?.trim() ? options.proseText : undefined,
    }),
  });
  const data = await readJson<{ items?: LineItem[]; proseFacts?: unknown }>(res, "Could not read those figures");
  return { items: Array.isArray(data.items) ? data.items : [], statedFacts: factsFrom(data.proseFacts) };
}

/** The line items alone, for the callers that have no document prose to offer. */
export async function parseFigures(figures: string, model?: string, task?: FinanceTask): Promise<LineItem[]> {
  return (await parseFinanceFigures(figures, { model, task })).items;
}

/** Only facts with a name and a finite figure are sent back with the brief. */
export function usableStatedFacts(facts: readonly StatedFact[]): StatedFact[] {
  return facts.filter((fact) => Number.isFinite(fact.value) && (fact.label.trim() !== "" || fact.sentence.trim() !== ""));
}

export function emptyLineItem(): LineItem {
  return { label: "", period: "", amount: 0, currency: "", category: "other" };
}

export type RegenerateSectionRequest = {
  readonly brief: FinanceBrief;
  readonly sectionIndex: number;
  readonly prompt: string;
  readonly instruction?: string;
  readonly model?: string;
  /** A model chosen in the rewrite panel is as deliberate as one chosen in the prompt bar. */
  readonly modelPinned?: boolean;
  /**
   * The artifact the generate saved. The host answers with the same id and rewrites that one work
   * card, so "Send to Knowledge Base" after a rewrite cannot mint a second, near-identical row.
   */
  readonly artifactId?: string;
  /** The inputs half of the request: the same rows, parameters and stated facts the generate used. */
  readonly inputs: Record<string, unknown>;
};

/** Rewrite one section of a finished brief with the inputs it was written from. */
export async function regenerateFinanceSection(request: RegenerateSectionRequest): Promise<FinanceResult> {
  const res = await apiFetch("/api/v1/finance/regenerate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brief: request.brief,
      sectionIndex: request.sectionIndex,
      prompt: request.prompt,
      instruction: request.instruction || undefined,
      model: request.model || undefined,
      ...(request.modelPinned ? { modelPinned: true } : {}),
      artifactId: request.artifactId ?? undefined,
      ...request.inputs,
    }),
  });
  return readJson<FinanceResult>(res, "That section could not be rewritten");
}

/** Only rows with a label and a finite amount are sent. */
export function usableLineItems(items: readonly LineItem[]): LineItem[] {
  return items.filter((item) => item.label.trim() !== "" && Number.isFinite(item.amount));
}
