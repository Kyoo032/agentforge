/**
 * Text helpers for the Legal verify engine: cross-reference and clause-id normalisation, quoted-string
 * extraction, and defined-term candidate extraction. Pure string functions; nothing here touches a document.
 */

/** "§7.2(b)", "§ 7.2 (b)", "Section 7.2(b)", "Clause 7.2". Group 1 is the bare path. */
const XREF_PATTERN = /(?:§\s*|\b(?:Section|Clause)\s+)(\d+(?:\.\d+)*(?:\s*\([a-z0-9]+\))*)/gi;
/** Leading path of a clause id such as `§1.1 "Material Adverse Effect"`; the heading tail is ignored. */
const CLAUSE_ID_PATTERN = /^\s*(?:§|Section|Clause)?\s*(\d+(?:\.\d+)*(?:\s*\([a-z0-9]+\))*)/i;
const QUOTED_PATTERN = /["“]([^"“”]+)["”]/g;
const DEFINITION_PATTERN = /["“]([^"“”]+)["”]\s+(?:shall\s+)?(?:means?|has\s+the\s+meaning)\b/gi;

const CAP_WORD = "[A-Z][A-Za-z-]+";
const CONNECTIVE = "(?:of|and|or|to|in|for|the)";
const MULTI_WORD_TERM = new RegExp(`\\b${CAP_WORD}(?:(?:\\s+${CONNECTIVE})?\\s+${CAP_WORD})+\\b`, "g");
const SENTENCE_END = /[.!?]$/;
const LEADING_ARTICLE = /^(?:The|A|An)\s+/;
/** Trailing plural "s" (but not "ss", as in "Business"). */
const PLURAL_S = /([^s])s$/;
const QUOTE_CHARS = new Set(['"', "“", "”"]);

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** "7.2 (b)" → "§7.2(b)". Whitespace is removed and the parenthetical letters lower-cased. */
export function normaliseXref(bare: string): string {
  return `§${bare.replace(/\s+/g, "").toLowerCase()}`;
}

/**
 * Clause id or reference in any accepted form → comparable key. Numbered ids normalise to "§7.2(b)";
 * unnumbered ids ("Article VII") fall back to their whitespace-free lower-cased text.
 */
export function normaliseClauseId(id: string): string {
  const match = CLAUSE_ID_PATTERN.exec(id);
  return match?.[1] ? normaliseXref(match[1]) : id.replace(/\s+/g, "").toLowerCase();
}

/** Unique normalised cross-references in the text, in order of first appearance. */
export function extractXrefs(text: string): string[] {
  return unique([...text.matchAll(XREF_PATTERN)].map((match) => normaliseXref(match[1] ?? "")));
}

/** Blank every cross-reference token at equal length so section numbers are not read as figures. */
export function maskXrefs(text: string): string {
  return text.replace(XREF_PATTERN, (token) => " ".repeat(token.length));
}

/** Strings between straight or curly double quotes whose trimmed length is at least `minLength`. */
export function extractQuotedStrings(text: string, minLength: number): string[] {
  return unique(
    [...text.matchAll(QUOTED_PATTERN)]
      .map((match) => (match[1] ?? "").trim())
      .filter((quote) => quote.length >= minLength),
  );
}

/** Terms introduced by `"Term" means …` / `"Term" shall mean …` / `"Term" has the meaning …`, as term keys. */
export function extractDefinitionTerms(text: string): string[] {
  return unique([...text.matchAll(DEFINITION_PATTERN)].map((match) => termKey(match[1] ?? "")));
}

/** Lower-cased, whitespace-collapsed, surrounding quotes stripped. */
export function normaliseTerm(term: string): string {
  return term
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Comparison key for a defined term: normalised, with a plural "s" dropped so "Business Days" meets "Business Day". */
export function termKey(term: string): string {
  return normaliseTerm(term).replace(PLURAL_S, "$1");
}

/** At a sentence start only "The Fee Cap" style phrases count, minus the article; anything else is skipped. */
function candidateAt(text: string, match: RegExpMatchArray): string | null {
  const start = match.index ?? 0;
  const term = match[0];
  if (isQuotedAt(text, start, start + term.length) || !isSentenceStart(text, start)) {
    return term;
  }
  const withoutArticle = term.replace(LEADING_ARTICLE, "");
  return withoutArticle !== term && withoutArticle.includes(" ") ? withoutArticle : null;
}

function isSentenceStart(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const trimmed = before.trimEnd();
  return trimmed === "" || SENTENCE_END.test(trimmed) || /\n\s*$/.test(before);
}

function isQuotedAt(text: string, start: number, end: number): boolean {
  return QUOTE_CHARS.has(text[start - 1] ?? "") && QUOTE_CHARS.has(text[end] ?? "");
}

function overlapsParty(candidate: string, parties: readonly string[]): boolean {
  const lower = candidate.toLowerCase();
  return parties.some((party) => {
    const partyLower = party.toLowerCase();
    return partyLower !== "" && (partyLower.includes(lower) || lower.includes(partyLower));
  });
}

/**
 * Candidate defined terms in drafted text: "Xxx Yyy" between double quotes, or two or more Capitalised Words
 * not at a sentence start. Single capitalised words and party names are skipped to keep false positives low.
 * Returns the terms as written (unique, first-appearance order).
 */
export function extractDefinedTermCandidates(text: string, parties: readonly string[]): string[] {
  const candidates = [...text.matchAll(MULTI_WORD_TERM)]
    .map((match) => candidateAt(text, match))
    .filter((candidate): candidate is string => candidate !== null && !overlapsParty(candidate, parties));
  return unique(candidates);
}
