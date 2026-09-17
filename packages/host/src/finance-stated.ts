/**
 * Figures a document states in a sentence, carried from the confirm step into the brief.
 *
 * Seven of the figures the owner asks about in an annual report — headcount, store count, the current
 * ratio, capex, debt, the dividend — exist only in prose. They reach the confirm step as stated facts,
 * come back on the generate request the way the line items do, and from here they are two things: a
 * table the reader can see under "Stated in the document", and numbers the guard will verify. They
 * are never summed with anything: a stated fact is a quotation, not an input to arithmetic.
 */
import { z } from "zod";
import type { AppLocale } from "@agentforge/core";
import { formatMetricValue, type ComputedFinance, type StatedFact } from "@agentforge/core/finance";

/** What the studio sends back for a fact the owner kept. Amounts are numbers, never strings. */
export const statedFactSchema = z.object({
  id: z.string().default(""),
  label: z.string().default(""),
  sentence: z.string().default(""),
  value: z.number().finite(),
  unit: z.enum(["currency", "percent", "ratio", "months", "count", "number"]).default("number"),
  currency: z.string().default(""),
});

export const statedFactsSchema = z.array(statedFactSchema).max(200);

export type ConfirmedStatedFact = z.infer<typeof statedFactSchema>;

const TABLE_NAME: Record<AppLocale, string> = {
  en: "Stated in the document",
  id: "Tertulis di dokumen",
};

const COLUMNS: Record<AppLocale, readonly string[]> = {
  en: ["What it says", "Figure", "Written as", "Sentence"],
  id: ["Yang disebut", "Angka", "Ditulis sebagai", "Kalimat"],
};

/** Confirmed stated facts from a request body. Absent is normal; malformed is dropped, not repaired. */
export function readStatedFacts(body: unknown): ConfirmedStatedFact[] {
  const value = (body as { statedFacts?: unknown } | null)?.statedFacts;
  if (value === undefined) {
    return [];
  }
  const parsed = statedFactsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function unitFor(fact: ConfirmedStatedFact): string {
  if (fact.unit === "percent") {
    return "%";
  }
  if (fact.unit === "ratio") {
    return "x";
  }
  if (fact.unit === "months") {
    return "months";
  }
  return fact.unit === "currency" ? fact.currency || "" : "";
}

/**
 * The same computed bundle with the document's own sentences added as a table and as allowed figures.
 * `metrics` is untouched: a stated fact is not something we computed and must not read as though it were.
 */
export function withStatedFacts(
  computed: ComputedFinance,
  facts: readonly ConfirmedStatedFact[],
  locale: AppLocale,
): ComputedFinance {
  if (facts.length === 0) {
    return computed;
  }
  const table = {
    name: TABLE_NAME[locale] ?? TABLE_NAME.en,
    columns: [...(COLUMNS[locale] ?? COLUMNS.en)],
    rows: facts.map((fact) => [
      fact.label || fact.sentence,
      fact.value,
      formatMetricValue({ value: fact.value, unit: unitFor(fact) }, locale),
      fact.sentence,
    ]),
  };
  return {
    ...computed,
    tables: [...computed.tables, table],
    allowed: [...computed.allowed, ...facts.map((fact) => fact.value)],
  };
}

/** Stated facts as the prompt should show them: named, pre-written, and marked as quotations. */
export function statedFactsBlock(facts: readonly ConfirmedStatedFact[], locale: AppLocale): string | null {
  if (facts.length === 0) {
    return null;
  }
  const heading =
    locale === "id"
      ? "Tertulis di dokumen (kutip apa adanya; jangan dijumlahkan):"
      : "Stated in the document (quote as written; never add these up):";
  const lines = facts.map(
    (fact) =>
      `- ${fact.label || fact.sentence}: ${formatMetricValue({ value: fact.value, unit: unitFor(fact) }, locale)}`,
  );
  return `${heading}\n${lines.join("\n")}`;
}

/** The parse step's own shape, so the studio gets the same fields it will send back. */
export type ParsedStatedFact = StatedFact;
