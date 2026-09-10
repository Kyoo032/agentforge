/**
 * Text-level analysis of one paragraph: clause number, heading detection, heading text, defined terms.
 * Pure functions over strings so the reader, the clause splitter, and the diff share one interpretation.
 */
import type { DefinedTerm, ParagraphAnchor } from "./types";

export type NumberKind = "article" | "section" | "numeric" | "paren";

export type NumberMatch = {
  kind: NumberKind;
  /** Token as written without a trailing period: "7.2", "(b)", "Article VII". Section prefixes are dropped. */
  token: string;
  /** Characters consumed from the start of the text (leading whitespace, prefix, token, trailing period). */
  length: number;
};

const ROMAN_NUMERAL = "[IVXLCivxlc]+";
const PAREN_ITEM = "\\([a-zA-Z0-9]{1,4}\\)";

/**
 * Leading clause number at the start of a paragraph. Alternatives, in priority order:
 *   article  "Article VII", "ARTICLE 7"                  -> token kept as written
 *   section  "Section 7.2", "SECTION 1", "§7.2(b)"       -> token is the number only ("7.2", "1", "7.2(b)")
 *   numeric  "7.2", "1.1.", "7.2(b)(iv)", "7(b)"          -> as written, trailing period dropped
 *   single   "1."  (a lone integer needs its period so years, amounts and page numbers are not numbers)
 *   paren    "(b)", "(iv)", "(1)"
 * The token must be followed by whitespace, the end of the text, or a title separator (":", ".", dashes).
 */
export const NUMBER_TOKEN_RE = new RegExp(
  `^\\s*(?:(?<article>(?:Article|ARTICLE)\\s+(?:${ROMAN_NUMERAL}|\\d+))` +
    `|(?:Section|SECTION|§)\\s*(?<section>\\d+(?:\\.\\d+)*(?:${PAREN_ITEM})*)` +
    `|(?<numeric>\\d+(?:\\.\\d+)+(?:${PAREN_ITEM})*|\\d+(?:${PAREN_ITEM})+)` +
    "|(?<single>\\d+)\\." +
    `|(?<paren>${PAREN_ITEM}))\\.?(?=\\s|$|[:.\u2014\u2013-])`,
);

const WHITESPACE_RUN_RE = /\s+/g;

export function detectNumber(text: string): NumberMatch | null {
  const match = NUMBER_TOKEN_RE.exec(text);
  const groups = match?.groups;
  if (!match || !groups) {
    return null;
  }
  const length = match[0].length;
  if (groups.article !== undefined) {
    return { kind: "article", token: groups.article.replace(WHITESPACE_RUN_RE, " "), length };
  }
  if (groups.section !== undefined) {
    return { kind: "section", token: groups.section, length };
  }
  if (groups.numeric !== undefined) {
    return { kind: "numeric", token: groups.numeric, length };
  }
  if (groups.single !== undefined) {
    return { kind: "numeric", token: groups.single, length };
  }
  return { kind: "paren", token: groups.paren ?? "", length };
}

/** Headings and clause titles longer than this are treated as body text. */
export const HEADING_MAX_CHARS = 80;
const HEADING_STYLE_RE = /^(Heading|Title)/;
const UPPERCASE_LETTER_RE = /[A-Z]/;
/** Separators between a clause number and its title: "7.2 — Title", "7.2: Title", "7.2. Title". */
const TITLE_SEPARATOR_RE = /^[\s:.\u2014\u2013-]+/;
/** End of a run-in title: sentence punctuation before whitespace, a spaced dash, or a colon. */
const SENTENCE_BREAK_RE = /[.!?](?=\s|$)|\s[\u2014\u2013]\s|:(?=\s|$)/;

function isAllCaps(text: string): boolean {
  return UPPERCASE_LETTER_RE.test(text) && text === text.toUpperCase();
}

/** Title text after the number token and its separator, or the whole text when there is no number. */
function titleAfterNumber(text: string, number: NumberMatch | null): string {
  return (number ? text.slice(number.length) : text).replace(TITLE_SEPARATOR_RE, "").trim();
}

export function detectHeading(text: string, style: string, number: NumberMatch | null): boolean {
  if (HEADING_STYLE_RE.test(style)) {
    return true;
  }
  const trimmed = text.trim();
  if (trimmed.length > 0 && trimmed.length < HEADING_MAX_CHARS && isAllCaps(trimmed)) {
    return true;
  }
  if (number && (number.kind === "article" || number.kind === "section")) {
    const title = titleAfterNumber(text, number);
    return title.length > 0 && title.length < HEADING_MAX_CHARS;
  }
  return false;
}

/**
 * Short title of a paragraph: the text after its number up to the first sentence break, when that is at most
 * HEADING_MAX_CHARS long; "" when the paragraph reads as body text.
 */
export function headingText(text: string): string {
  const rest = titleAfterNumber(text, detectNumber(text));
  const breakAt = SENTENCE_BREAK_RE.exec(rest)?.index;
  const candidate = (breakAt === undefined ? rest : rest.slice(0, breakAt)).trim();
  return candidate.length <= HEADING_MAX_CHARS ? candidate : "";
}

/** Definitions longer than this are cut; the writer never needs more to identify a change. */
export const DEFINITION_MAX_CHARS = 400;
const OPEN_QUOTE = '["\u201C]';
const CLOSE_QUOTE = '["\u201D]';
const TERM_BODY = '[^"\u201C\u201D]{1,80}?';
const ALIAS_CHAIN = `(?:,?\\s+(?:or|and)\\s+${OPEN_QUOTE}${TERM_BODY}${CLOSE_QUOTE})*`;
const DEFINING_VERB = "(?:shall\\s+)?(?:means?|ha(?:s|ve)\\s+the\\s+meanings?)\\b";
const INLINE_LEAD = "(?:the|this|each|an?|such|collectively,?\\s+(?:the|an?)|together,?\\s+the|individually,?\\s+an?|each,?\\s+an?)";

/** `"Term" means ...`, `"Term" shall mean ...`, `"Term" or "Alias" has the meaning ...`. */
const MEANS_DEFINITION_RE = new RegExp(
  `${OPEN_QUOTE}(${TERM_BODY})${CLOSE_QUOTE}(${ALIAS_CHAIN})\\s*,?\\s+${DEFINING_VERB}`,
  "g",
);
/** Inline definitions such as `(the "Term")` or `(this "Agreement")`. */
const INLINE_DEFINITION_RE = new RegExp(`\\(${INLINE_LEAD}\\s+${OPEN_QUOTE}(${TERM_BODY})${CLOSE_QUOTE}\\)`, "g");
const QUOTED_TERM_RE = new RegExp(`${OPEN_QUOTE}(${TERM_BODY})${CLOSE_QUOTE}`, "g");

type TermHit = { terms: readonly string[]; start: number; definitionFrom: number; inline: boolean };

function meansHits(text: string): readonly TermHit[] {
  return [...text.matchAll(MEANS_DEFINITION_RE)].map((match) => {
    const term = match[1] ?? "";
    const aliases = match[2] ?? "";
    const aliasTerms = [...aliases.matchAll(QUOTED_TERM_RE)].map((alias) => alias[1] ?? "");
    const quoteEnd = (match.index ?? 0) + term.length + 2 + aliases.length;
    return { terms: [term, ...aliasTerms], start: match.index ?? 0, definitionFrom: quoteEnd, inline: false };
  });
}

function inlineHits(text: string): readonly TermHit[] {
  return [...text.matchAll(INLINE_DEFINITION_RE)].map((match) => ({
    terms: [match[1] ?? ""],
    start: match.index ?? 0,
    definitionFrom: match.index ?? 0,
    inline: true,
  }));
}

/**
 * Defined terms in one paragraph. For "means"-style definitions the definition is the text after the closing
 * quote up to the next definition in the same paragraph; for inline `(the "Term")` definitions it is the text
 * preceding the parenthetical, because that is what the term stands for.
 */
export function detectDefinedTerms(text: string, anchor: ParagraphAnchor): DefinedTerm[] {
  const means = meansHits(text);
  const hits = [...means, ...inlineHits(text)].sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  return hits.flatMap((hit) => {
    const definition = hit.inline
      ? text.slice(0, hit.start).trim().slice(-DEFINITION_MAX_CHARS)
      : definitionAfter(text, hit.definitionFrom, means);
    return hit.terms
      .map((term) => term.trim())
      .filter((term) => term !== "" && !seen.has(term) && seen.add(term))
      .map((term) => ({ term, paragraph: anchor, definition }));
  });
}

function definitionAfter(text: string, from: number, means: readonly TermHit[]): string {
  const nextStart = means.map((hit) => hit.start).find((start) => start > from) ?? text.length;
  return text
    .slice(from, nextStart)
    .replace(/^\s*,?\s*/, "")
    .trim()
    .slice(0, DEFINITION_MAX_CHARS);
}
