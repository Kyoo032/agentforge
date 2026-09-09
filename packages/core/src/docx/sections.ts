/**
 * splitClauses: builds the clause tree of a document from the paragraph number tokens detected by the reader.
 * Numeric tokens ("7.2", "7.2(b)") are absolute paths; parenthesised items ("(b)", "(iv)") continue or open a
 * list relative to the current clause; unnumbered paragraphs attach to the current clause.
 */
import { detectNumber, headingText } from "./paragraph-analysis";
import type { DocxClause, DocxDocument, DocxParagraph, ParagraphAnchor } from "./types";

type SegmentKind = "number" | "letter" | "roman" | "digit";
type Segment = { value: number; kind: SegmentKind };

type ClauseDraft = {
  /** Id without any quoted-term suffix, used to derive sibling and child labels. */
  label: string;
  id: string;
  path: readonly number[];
  kinds: readonly SegmentKind[];
  heading: string;
  paragraphs: readonly ParagraphAnchor[];
  texts: readonly string[];
};

const PREAMBLE_ID = "Preamble";
const PREAMBLE_PATH: readonly number[] = [0];
const SECTION_SIGN = "§";
const PATH_SEPARATOR = ".";
const LETTER_BASE = "a".charCodeAt(0) - 1;
const ALPHABET_SIZE = 26;
const ROMAN_RE = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i;
const ROMAN_VALUES: readonly (readonly [number, string])[] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];
const ARTICLE_RE = /^(?:Article|ARTICLE)\s+(\S+)$/;
const ABSOLUTE_RE = /^(\d+(?:\.\d+)*)((?:\([a-zA-Z0-9]{1,4}\))*)$/;
const PAREN_RE = /^\(([a-zA-Z0-9]{1,4})\)$/;
const PAREN_ITEM_RE = /\(([a-zA-Z0-9]{1,4})\)/g;
const LAST_PAREN_RE = /\([^()]*\)$/;
const QUOTED_TITLE_RE = /^[\s:.—–-]*["“]([^"“”]{1,80})["”]/;
const DIGITS_RE = /^\d+$/;
const SINGLE_LETTER_RE = /^[a-zA-Z]$/;

function romanToInt(text: string): number | null {
  if (text === "" || !ROMAN_RE.test(text)) {
    return null;
  }
  const upper = text.toUpperCase();
  let rest = upper;
  let total = 0;
  for (const [value, numeral] of ROMAN_VALUES) {
    while (rest.startsWith(numeral)) {
      total += value;
      rest = rest.slice(numeral.length);
    }
  }
  return total > 0 ? total : null;
}

function intToRoman(value: number): string {
  let rest = value;
  let out = "";
  for (const [amount, numeral] of ROMAN_VALUES) {
    while (rest >= amount) {
      out += numeral;
      rest -= amount;
    }
  }
  return out;
}

/** Possible readings of one parenthesised item: "(i)" is both the letter i and the roman numeral 1. */
function parenCandidates(raw: string): readonly Segment[] {
  const candidates: Segment[] = [];
  if (SINGLE_LETTER_RE.test(raw)) {
    candidates.push({ value: raw.toLowerCase().charCodeAt(0) - LETTER_BASE, kind: "letter" });
  }
  const roman = romanToInt(raw);
  if (roman !== null) {
    candidates.push({ value: roman, kind: "roman" });
  }
  if (DIGITS_RE.test(raw)) {
    candidates.push({ value: Number.parseInt(raw, 10), kind: "digit" });
  }
  return candidates;
}

/** Inside an absolute token the first item is read as a letter when possible, later ones as roman first. */
function absoluteParen(raw: string, position: number): Segment {
  const candidates = parenCandidates(raw);
  const preferred: SegmentKind = position === 0 ? "letter" : "roman";
  return candidates.find((candidate) => candidate.kind === preferred) ?? candidates[0] ?? { value: 0, kind: "digit" };
}

function renderSegment(segment: Segment): string {
  if (segment.kind === "letter") {
    return `(${String.fromCharCode(LETTER_BASE + ((segment.value - 1) % ALPHABET_SIZE) + 1)})`;
  }
  if (segment.kind === "roman") {
    return `(${intToRoman(segment.value).toLowerCase()})`;
  }
  return `(${segment.value})`;
}

type ParsedToken =
  | { kind: "article"; label: string; value: number }
  | { kind: "absolute"; label: string; segments: readonly Segment[] }
  | { kind: "paren"; candidates: readonly Segment[] };

function parseToken(token: string): ParsedToken | null {
  const article = ARTICLE_RE.exec(token);
  if (article) {
    const raw = article[1] ?? "";
    const value = DIGITS_RE.test(raw) ? Number.parseInt(raw, 10) : romanToInt(raw);
    return value === null ? null : { kind: "article", label: token, value };
  }
  const absolute = ABSOLUTE_RE.exec(token);
  if (absolute) {
    const numbers = (absolute[1] ?? "").split(PATH_SEPARATOR).map((part): Segment => ({ value: Number.parseInt(part, 10), kind: "number" }));
    const parens = [...(absolute[2] ?? "").matchAll(PAREN_ITEM_RE)].map((match, position) => absoluteParen(match[1] ?? "", position));
    return { kind: "absolute", label: `${SECTION_SIGN}${token}`, segments: [...numbers, ...parens] };
  }
  const paren = PAREN_RE.exec(token);
  const candidates = paren ? parenCandidates(paren[1] ?? "") : [];
  return candidates.length > 0 ? { kind: "paren", candidates } : null;
}

type Placement = { label: string; path: readonly number[]; kinds: readonly SegmentKind[] };

function siblingOf(reference: ClauseDraft, segment: Segment): Placement {
  return {
    label: reference.label.replace(LAST_PAREN_RE, renderSegment(segment)),
    path: [...reference.path.slice(0, -1), segment.value],
    kinds: [...reference.kinds.slice(0, -1), segment.kind],
  };
}

function childOf(reference: ClauseDraft, segment: Segment): Placement {
  return {
    label: `${reference.label}${renderSegment(segment)}`,
    path: [...reference.path, segment.value],
    kinds: [...reference.kinds, segment.kind],
  };
}

function lastOf(draft: ClauseDraft): Segment {
  return { value: draft.path.at(-1) ?? 0, kind: draft.kinds.at(-1) ?? "number" };
}

/** The current clause and its ancestors that exist in the tree, nearest first. */
function chainOf(current: ClauseDraft, byPath: ReadonlyMap<string, ClauseDraft>): readonly ClauseDraft[] {
  const ancestors = current.path
    .map((_, length) => byPath.get(pathKey(current.path.slice(0, length))))
    .filter((draft): draft is ClauseDraft => draft !== undefined);
  return [current, ...ancestors.reverse()];
}

/**
 * Places a parenthesised item: continue the nearest list whose last item it follows, otherwise open a new
 * list under the current clause when it reads as a first item, otherwise a non-sequential sibling or child.
 */
function placeParen(candidates: readonly Segment[], current: ClauseDraft, byPath: ReadonlyMap<string, ClauseDraft>): Placement {
  for (const reference of chainOf(current, byPath)) {
    const last = lastOf(reference);
    const next = candidates.find((candidate) => candidate.kind === last.kind && candidate.value === last.value + 1);
    if (next) {
      return siblingOf(reference, next);
    }
  }
  const first = candidates.find((candidate) => candidate.value === 1);
  if (first) {
    return childOf(current, first);
  }
  const sameKind = candidates.find((candidate) => candidate.kind === lastOf(current).kind);
  return sameKind ? siblingOf(current, sameKind) : childOf(current, candidates[0] as Segment);
}

function pathKey(path: readonly number[]): string {
  return path.join(PATH_SEPARATOR);
}

function preambleDraft(): ClauseDraft {
  return { label: PREAMBLE_ID, id: PREAMBLE_ID, path: PREAMBLE_PATH, kinds: ["number"], heading: PREAMBLE_ID, paragraphs: [], texts: [] };
}

function withParagraph(draft: ClauseDraft, paragraph: DocxParagraph): ClauseDraft {
  return { ...draft, paragraphs: [...draft.paragraphs, paragraph.anchor], texts: [...draft.texts, paragraph.text] };
}

function openClause(token: ParsedToken, paragraph: DocxParagraph, current: ClauseDraft, byPath: ReadonlyMap<string, ClauseDraft>): ClauseDraft {
  const placement: Placement =
    token.kind === "article"
      ? { label: token.label, path: [token.value], kinds: ["number"] }
      : token.kind === "absolute"
        ? { label: token.label, path: token.segments.map((segment) => segment.value), kinds: token.segments.map((segment) => segment.kind) }
        : placeParen(token.candidates, current, byPath);
  const number = detectNumber(paragraph.text);
  const quoted = token.kind === "article" ? null : QUOTED_TITLE_RE.exec(number ? paragraph.text.slice(number.length) : paragraph.text);
  const term = quoted?.[1]?.trim() ?? "";
  return {
    ...placement,
    id: term === "" ? placement.label : `${placement.label} "${term}"`,
    heading: term === "" ? headingText(paragraph.text) : term,
    paragraphs: [paragraph.anchor],
    texts: [paragraph.text],
  };
}

type BuildState = { drafts: readonly ClauseDraft[]; current: ClauseDraft | null; byPath: ReadonlyMap<string, ClauseDraft> };

function addDraft(state: BuildState, draft: ClauseDraft): BuildState {
  const key = pathKey(draft.path);
  const byPath = state.byPath.has(key) ? state.byPath : new Map([...state.byPath, [key, draft]]);
  return { drafts: [...state.drafts, draft], current: draft, byPath };
}

function replaceCurrent(state: BuildState, updated: ClauseDraft): BuildState {
  const drafts = state.drafts.map((draft) => (draft === state.current ? updated : draft));
  const byPath = new Map([...state.byPath].map(([key, draft]) => [key, draft === state.current ? updated : draft]));
  return { drafts, current: updated, byPath };
}

function step(state: BuildState, paragraph: DocxParagraph): BuildState {
  const token = paragraph.number === "" ? null : parseToken(paragraph.number);
  const withCurrent = state.current === null ? addDraft(state, preambleDraft()) : state;
  const current = withCurrent.current as ClauseDraft;
  if (token === null) {
    return replaceCurrent(withCurrent, withParagraph(current, paragraph));
  }
  const base = token.kind === "paren" ? withCurrent : state;
  const reference = base.current ?? current;
  return addDraft(base, openClause(token, paragraph, reference, withCurrent.byPath));
}

function uniqueIds(drafts: readonly ClauseDraft[]): readonly string[] {
  const taken = new Set<string>();
  return drafts.map((draft) => {
    let id = draft.id;
    let suffix = 2;
    while (taken.has(id)) {
      id = `${draft.id} [${suffix}]`;
      suffix += 1;
    }
    taken.add(id);
    return id;
  });
}

function parentOf(draft: ClauseDraft, byPath: ReadonlyMap<string, ClauseDraft>, ids: ReadonlyMap<ClauseDraft, string>): string | null {
  for (let length = draft.path.length - 1; length >= 1; length -= 1) {
    const ancestor = byPath.get(pathKey(draft.path.slice(0, length)));
    if (ancestor && ancestor !== draft) {
      return ids.get(ancestor) ?? null;
    }
  }
  return null;
}

export function splitClauses(doc: DocxDocument): readonly DocxClause[] {
  const initial: BuildState = { drafts: [], current: null, byPath: new Map() };
  const { drafts, byPath } = doc.paragraphs.reduce(step, initial);
  const ids = new Map(drafts.map((draft, index) => [draft, uniqueIds(drafts)[index] as string]));
  return drafts.map((draft) => ({
    id: ids.get(draft) as string,
    path: draft.path,
    heading: draft.heading,
    paragraphs: draft.paragraphs,
    text: draft.texts.join("\n"),
    parent: parentOf(draft, byPath, ids),
  }));
}
