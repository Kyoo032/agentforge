/**
 * Figures a document states in a sentence rather than in a table.
 *
 * An annual report puts its revenue in a table and its headcount, its store count, its current ratio
 * and its dividend in prose. A reader counts those as figures; a table importer does not see them at
 * all, so a brief written from the tables alone is missing exactly the facts the owner asked about.
 *
 * Everything here is deterministic: the sentence is found, the number is read with the same reader
 * the guard uses, and the unit is taken from the words around it. What it deliberately does not do is
 * name the fact — "the number in this sentence is the headcount" is a language question, and the
 * caller may hand the sentences (never the amounts) to a model for that. The value stays in code.
 */
import type { AppLocale } from "../locale";
import { hasCountWord } from "./count-rows";
import { expandMagnitudes } from "./magnitude";
import { extractNumbers } from "./number-guard";

/** Sentence ends that survive "Rp 2.350.000.000": a full stop between digits is not one. */
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ"“(])|\n+/;
const YEAR_ONLY = /^(?:19|20)\d{2}$/;

const CURRENCY_BEFORE = /(?:rp|idr|usd|us\$|eur|gbp|sgd|jpy|[$€£¥])\s*$/i;
const CURRENCY_INSIDE = /^[-+]?\s*(?:rp|idr|[$€£¥])/i;
const RATIO_AFTER = /^\s*(?:kali|x|times)\b/i;
const PERCENT_AFTER = /^\s*(?:%|persen|percent|pct)\b/i;
const MONTHS_AFTER = /^\s*(?:bulan|months?)\b/i;

/** How far either side of a number its unit words are looked for. */
const CONTEXT_CHARS = 20;

export type StatedFactUnit = "currency" | "percent" | "ratio" | "months" | "count" | "number";

export type StatedFact = {
  /** Stable within one document: which sentence, and which figure inside it. */
  readonly id: string;
  /** The sentence the figure was stated in, for the confirm step and for a label pass. */
  readonly sentence: string;
  readonly value: number;
  readonly unit: StatedFactUnit;
  readonly currency: string;
  /** What the figure is called. Empty until a caller names it; never taken from the same pass as the value. */
  readonly label: string;
};

function currencyOf(before: string, token: string): string {
  const mark = CURRENCY_INSIDE.exec(token)?.[0] ?? CURRENCY_BEFORE.exec(before)?.[0] ?? "";
  const cleaned = mark
    .trim()
    .replace(/^[-+]\s*/, "")
    .toLowerCase();
  if (cleaned === "") {
    return "";
  }
  if (cleaned === "rp" || cleaned === "idr") {
    return "IDR";
  }
  return { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY" }[cleaned] ?? cleaned.toUpperCase();
}

function unitOf(before: string, after: string, token: { text: string; unit: string }): StatedFactUnit {
  if (token.unit === "%" || PERCENT_AFTER.test(after)) {
    return "percent";
  }
  if (CURRENCY_INSIDE.test(token.text) || CURRENCY_BEFORE.test(before)) {
    return "currency";
  }
  if (token.unit === "x" || RATIO_AFTER.test(after)) {
    return "ratio";
  }
  if (MONTHS_AFTER.test(after)) {
    return "months";
  }
  return hasCountWord(after) ? "count" : "number";
}

/** A bare calendar year in prose is a date, not a figure the brief may quote as one. */
function isDateOnly(unit: StatedFactUnit, token: { text: string; value: number }): boolean {
  return unit === "number" && YEAR_ONLY.test(token.text.trim()) && Number.isInteger(token.value);
}

/**
 * Every figure the prose states, with the sentence it came from. Amounts are read, never inferred.
 *
 * The same sentence stating the same figure twice is the same fact: two uploads of one report, or a
 * .docx beside the .pdf of it, would otherwise ask the owner to confirm every figure twice over.
 */
export function statedFactsFromProse(text: string, locale: AppLocale): StatedFact[] {
  const out: StatedFact[] = [];
  const seen = new Set<string>();
  const sentences = (text ?? "").split(SENTENCE_SPLIT);
  sentences.forEach((raw, index) => {
    const sentence = raw.trim();
    if (sentence === "") {
      return;
    }
    const expanded = expandMagnitudes(sentence, locale);
    extractNumbers(expanded).forEach((token, at) => {
      const before = expanded.slice(Math.max(0, token.index - CONTEXT_CHARS), token.index);
      const after = expanded.slice(token.index + token.text.length, token.index + token.text.length + CONTEXT_CHARS);
      const unit = unitOf(before, after, token);
      if (isDateOnly(unit, token)) {
        return;
      }
      const already = `${sentence}\u0000${token.value}\u0000${at}`;
      if (seen.has(already)) {
        return;
      }
      seen.add(already);
      out.push({
        id: `S${index + 1}#${at + 1}`,
        sentence,
        value: token.value,
        unit,
        currency: currencyOf(before, token.text),
        label: "",
      });
    });
  });
  return out;
}

/** The sentences a label pass is asked about, by id — with every amount left behind. */
export function factSentences(facts: readonly StatedFact[]): Array<{ id: string; sentence: string }> {
  return facts.map((fact) => ({ id: fact.id, sentence: fact.sentence }));
}

/**
 * Labels attached back by id. A label for an id that was never asked about is dropped, and a fact
 * whose label did not come back keeps its sentence as its name — the value is untouched either way.
 */
export function withFactLabels(
  facts: readonly StatedFact[],
  labels: ReadonlyMap<string, string>,
  cap = 80,
): StatedFact[] {
  return facts.map((fact) => {
    const named = labels.get(fact.id)?.trim();
    return { ...fact, label: named || fact.sentence.slice(0, cap) };
  });
}

/** Stated facts as numbers the guard may verify, so a brief can quote what the document said. */
export function statedFactValues(facts: readonly StatedFact[]): number[] {
  return facts.map((fact) => fact.value);
}
