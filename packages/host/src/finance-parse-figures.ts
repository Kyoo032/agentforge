/**
 * Figures text to confirmed rows, deterministic first.
 *
 * An imported sheet arrives as a table with an exact shape, and code reads a table perfectly. So the
 * labels, the periods, the signs and the amounts are all taken in code, and the model is asked one
 * question it is genuinely better at: what category does this *label* belong to? It is given labels
 * and ids, never amounts, and its answers are matched back by id — so however it answers, no figure
 * in the confirm step can differ from the figure on the owner's sheet.
 *
 * A document's prose goes through the same discipline: the figures are read in code and only the
 * sentences are ever offered for naming. Free prose with no table in it at all still goes to the full
 * parse, which now also knows what the importer's `[subtotal]` and `[Section]` tags mean.
 */
import {
  ApiError,
  modeMessage,
  type AppLocale,
  type JobModelFallbackNotice,
  type TenantContext,
} from "@agentforge/core";
import {
  dropCountRows,
  dropDerivedLineItems,
  expandMagnitudes,
  factSentences,
  lineItemsFromRows,
  looksScaled,
  parseLineItems,
  readCategory,
  readFiguresText,
  splitDerivedLineItems,
  statedFactsFromProse,
  withFactLabels,
  type LineItem,
  type LineItemCategory,
  type StatedFact,
  type StatedFigure,
  type UnclassifiedLabel,
} from "@agentforge/core/finance";
import type { FinancePiiSummary } from "./finance-privacy";
import { collectJobAssistantRun } from "./job-regen";
import { extractJsonObject } from "./presentation-outline";

export const FIGURES_TEXT_MAX = 12_000;
/** Above this many unplaced labels the model pass is skipped: they stay `other` and the owner edits. */
export const CATEGORY_BATCH_MAX = 120;
/** Above this many prose figures the naming pass is skipped; the sentence stands in as the name. */
export const FACT_BATCH_MAX = 60;

export const PARSE_SYSTEM = `You turn pasted financial figures into line items. Return ONLY JSON:
{"items": [{"label": string, "period": string, "amount": number, "currency": string, "category": "revenue"|"cogs"|"opex"|"cash"|"debt"|"equity"|"asset"|"liability"|"other"}]}
Rules:
- One item per figure in the text. amount is a plain number (no separators, no symbols); keep the sign the text implies.
- period is the text's own label ("2025", "Q1", "Sep", "monthly") or "" when none is given.
- currency is the ISO code when stated or clearly implied (Rp → IDR, $ → USD), else "".
- A line beginning with [subtotal] is a total of other lines: never make it an item.
- A [Section] tag before a label is the group the row sits in — use it to choose the category, and leave it out of the label.
- Only monetary amounts and percentages or rates are items. Counts of things are not: skip outlets, stores, branches, employees, staff, headcount, units, months, weeks, days, customers and users when the number just says how many there are.
- Amounts are already expanded to full integers; copy them exactly.
- Never add figures that are not in the text. Do not compute totals or averages.`;

export const CATEGORY_SYSTEM = `You file finance row labels into categories. Return ONLY JSON:
{"categories": {"L1": "revenue", "L2": "opex"}}
Rules:
- Answer every id you are given, exactly once, using the id as the key.
- Allowed values, and nothing else: revenue, cogs, opex, cash, debt, equity, asset, liability, other.
- You are given labels only. There are no amounts here; never ask for one and never invent one.
- A [Section] in front of a label is the group the row sits in on the sheet. Trust it over the label.
- A label that fits none of the categories is "other".`;

export const FACT_LABEL_SYSTEM = `You name the figure each sentence states. Return ONLY JSON:
{"labels": {"S1#1": "Number of permanent employees"}}
Rules:
- Answer every id you are given, exactly once, using the id as the key.
- A label is a short noun phrase for what the figure measures, in the language of the sentence. No numbers.
- Never restate, re-round or correct any figure in the sentence. You are naming, not reading.
- When a sentence states no figure you can name, answer "".`;

export type ParsedFigures = {
  items: LineItem[];
  /** Totals the source printed. Shown beside the items, never summed. */
  derived: LineItem[];
  /** Figures the sheet states beside its table ("Saldo awal: 45.000.000"). */
  statedFacts: StatedFigure[];
  /** Figures the document states in a sentence: a headcount, a store count, a ratio, a dividend. */
  proseFacts: StatedFact[];
  needsConfirmation: true;
  /** How the rows were read, so the studio can say whether a model touched them. */
  source: "table" | "prose";
  /** What the privacy guard hid before any prompt was built. Filled in by the route. */
  pii: FinancePiiSummary;
  /** Set only when a model was called: the model that actually answered. */
  model?: string;
  notice?: JobModelFallbackNotice;
};

/** Everything the reader can answer on its own; the route adds what the privacy guard found. */
export type ParsedFiguresDraft = Omit<ParsedFigures, "pii">;

type ModelCall = { readonly tenant: TenantContext; readonly model: string };

type ModelMark = { model?: string; notice?: JobModelFallbackNotice };

function readJson(raw: string, what: string): Record<string, unknown> {
  try {
    return JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  } catch {
    throw new ApiError("invalid_finance", `Model returned invalid JSON for the ${what}`, 502);
  }
}

function stringMap(parsed: Record<string, unknown>, key: string): Map<string, string> {
  const record = (parsed[key] ?? parsed) as Record<string, unknown>;
  const out = new Map<string, string>();
  for (const [id, value] of Object.entries(record)) {
    if (typeof value === "string") {
      out.set(id, value);
    }
  }
  return out;
}

/** The labels-only question, asked once for the whole sheet. */
function categoryPrompt(labels: readonly UnclassifiedLabel[]): string {
  const lines = labels.map((entry) => `${entry.id} | ${entry.section ? `[${entry.section}] ` : ""}${entry.label}`);
  return `Row labels (id | label):\n${lines.join("\n")}`;
}

async function ask(
  call: ModelCall,
  system: string,
  prompt: string,
  versionId: string,
): Promise<{ text: string } & ModelMark> {
  const run = await collectJobAssistantRun({
    tenant: call.tenant,
    model: call.model,
    systemPrompt: system,
    runPrefix: versionId,
    agentId: "finance",
    jobMode: "finance",
    versionId,
    prompt,
  });
  return { text: run.text, model: run.model, ...(run.notice ? { notice: run.notice } : {}) };
}

async function askForCategories(
  call: ModelCall,
  labels: readonly UnclassifiedLabel[],
): Promise<{ categories: Map<string, LineItemCategory> } & ModelMark> {
  const run = await ask(call, CATEGORY_SYSTEM, categoryPrompt(labels), "finance-categories");
  const answered = stringMap(readJson(run.text, "row categories"), "categories");
  const categories = new Map<string, LineItemCategory>();
  for (const [id, value] of answered) {
    const category = readCategory(value);
    if (category) {
      categories.set(id, category);
    }
  }
  return { categories, model: run.model, ...(run.notice ? { notice: run.notice } : {}) };
}

/** Sentences in, names out. The amounts stay here; the model never sees one. */
async function askForFactLabels(
  call: ModelCall,
  facts: readonly StatedFact[],
): Promise<{ facts: StatedFact[] } & ModelMark> {
  if (facts.length === 0 || facts.length > FACT_BATCH_MAX) {
    return { facts: withFactLabels(facts, new Map()) };
  }
  try {
    const lines = factSentences(facts).map((entry) => `${entry.id} | ${entry.sentence}`);
    const run = await ask(
      call,
      FACT_LABEL_SYSTEM,
      `Sentences (id | sentence):\n${lines.join("\n")}`,
      "finance-fact-labels",
    );
    const named = stringMap(readJson(run.text, "stated facts"), "labels");
    return { facts: withFactLabels(facts, named), model: run.model, ...(run.notice ? { notice: run.notice } : {}) };
  } catch {
    // A naming pass that fails costs the reader a nicer label, never a figure.
    return { facts: withFactLabels(facts, new Map()) };
  }
}

export type ParseOptions = {
  /** The document's prose, when the import carried one. Read for the figures its tables cannot hold. */
  readonly proseText?: string;
};

function finish(
  items: readonly LineItem[],
  derived: readonly LineItem[],
  facts: readonly StatedFigure[],
  proseFacts: readonly StatedFact[],
  mark: ModelMark,
): ParsedFiguresDraft {
  return {
    items: [...items],
    derived: [...derived],
    statedFacts: [...facts],
    proseFacts: [...proseFacts],
    needsConfirmation: true,
    source: "table",
    ...(mark.model ? { model: mark.model } : {}),
    ...(mark.notice ? { notice: mark.notice } : {}),
  };
}

async function proseFactsFor(call: ModelCall, options: ParseOptions, locale: AppLocale): Promise<StatedFact[]> {
  const prose = options.proseText?.trim();
  if (!prose) {
    return [];
  }
  return (await askForFactLabels(call, statedFactsFromProse(prose, locale))).facts;
}

/** The deterministic read. Returns null when the text is not a table the reader recognises. */
export async function parseFiguresTable(
  call: ModelCall,
  text: string,
  locale: AppLocale,
  options: ParseOptions = {},
): Promise<ParsedFiguresDraft | null> {
  const read = readFiguresText(expandMagnitudes(text, locale));
  if (!read.deterministic) {
    return null;
  }
  const prose = await proseFactsFor(call, options, locale);
  const first = lineItemsFromRows(read.rows);
  if (first.unclassified.length === 0 || first.unclassified.length > CATEGORY_BATCH_MAX) {
    return finish(first.items, first.derived, read.facts, prose, {});
  }
  const answered = await askForCategories(call, first.unclassified);
  const second = lineItemsFromRows(read.rows, { categories: answered.categories });
  return finish(second.items, second.derived, read.facts, prose, answered);
}

/** The old path, for text that has no table in it. The model reads the figures; code checks the scale. */
export async function parseFiguresProse(
  call: ModelCall,
  text: string,
  locale: AppLocale,
  options: ParseOptions = {},
): Promise<ParsedFiguresDraft> {
  const expanded = expandMagnitudes(text, locale).slice(0, FIGURES_TEXT_MAX);
  const run = await ask(call, PARSE_SYSTEM, `Figures:\n${expanded}`, "finance-parse");
  // The prompt already asks for money only; this drops the count rows a model still slips in.
  // looksScaled reads the text as the owner typed it: the suffixes are the evidence a row lost its scale.
  const parsed = looksScaled(text, dropCountRows(parseLineItems(readJson(run.text, "figures"))), locale);
  const split = splitDerivedLineItems(parsed);
  if (split.items.length === 0) {
    throw new ApiError("invalid_finance", modeMessage("noFiguresParsed", locale), 422);
  }
  return {
    items: dropDerivedLineItems(split.items),
    derived: split.derived,
    statedFacts: [],
    proseFacts: await proseFactsFor(call, options, locale),
    needsConfirmation: true,
    source: "prose",
    model: run.model,
    ...(run.notice ? { notice: run.notice } : {}),
  };
}

/** Table first, prose second. The one entry point the parse route and the brief's parser both call. */
export async function parseFiguresText(
  call: ModelCall,
  text: string,
  locale: AppLocale,
  options: ParseOptions = {},
): Promise<ParsedFiguresDraft> {
  const table = await parseFiguresTable(call, text, locale, options);
  if (table && table.items.length > 0) {
    return table;
  }
  return parseFiguresProse(call, text, locale, options);
}
