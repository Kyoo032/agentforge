/**
 * diffDocuments: aligns the paragraphs of two document versions, computes word-level edits for changed pairs,
 * flags changes that carry no tracked-change revisions, and reports definition changes and renumbering.
 */
import { headingText } from "./paragraph-analysis";
import { splitClauses } from "./sections";
import { alignmentScore, wordDiff, words } from "./similarity";
import type { DocxDiff, DocxDocument, DocxParagraph, ParagraphChange } from "./types";

/** Minimum Dice coefficient (word bigrams) for two paragraphs to count as the same paragraph. */
const SIMILARITY_THRESHOLD = 0.6;
/** Paragraph distance searched on either side of the expected position during similarity alignment. */
const ALIGN_WINDOW = 8;
const WHITESPACE_RUN_RE = /\s+/g;

type Match = { prior: number; next: number };
/** nextToPrior[j] is the prior index aligned with next paragraph j, or null when j was added. */
type Alignment = readonly (number | null)[];

function uniqueNumbers(paragraphs: readonly DocxParagraph[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const paragraph of paragraphs) {
    if (paragraph.number !== "") {
      counts.set(paragraph.number, (counts.get(paragraph.number) ?? 0) + 1);
    }
  }
  return new Map(
    paragraphs.filter((paragraph) => counts.get(paragraph.number) === 1).map((paragraph) => [paragraph.number, paragraph.index]),
  );
}

function hasRevision(paragraph: DocxParagraph): boolean {
  return paragraph.runs.some((run) => run.revision !== undefined);
}

/**
 * Similarity of a prior paragraph to a next paragraph. When the next paragraph carries tracked changes its
 * original view is compared too: a redline's original text is what the prior paragraph looked like.
 */
function paragraphScore(prior: DocxParagraph, next: DocxParagraph): number {
  const priorWords = words(prior.text);
  const accepted = alignmentScore(priorWords, words(next.text));
  return hasRevision(next) ? Math.max(accepted, alignmentScore(priorWords, words(next.originalText))) : accepted;
}

function similar(a: DocxParagraph, b: DocxParagraph): boolean {
  const headingA = headingText(a.text);
  const headingB = headingText(b.text);
  if (headingA !== "" && headingB !== "" && alignmentScore(words(headingA), words(headingB)) >= SIMILARITY_THRESHOLD) {
    return true;
  }
  return paragraphScore(a, b) >= SIMILARITY_THRESHOLD;
}

/** Pass 1: paragraphs whose number token is unique in both documents and whose heading or text is similar. */
function matchByNumber(prior: readonly DocxParagraph[], next: readonly DocxParagraph[]): readonly Match[] {
  const priorNumbers = uniqueNumbers(prior);
  return [...uniqueNumbers(next).entries()].flatMap(([number, j]) => {
    const i = priorNumbers.get(number);
    return i !== undefined && similar(prior[i] as DocxParagraph, next[j] as DocxParagraph) ? [{ prior: i, next: j }] : [];
  });
}

/** Pass 2: exact accepted-text equality among the still unmatched paragraphs, earliest prior first. */
function matchByText(prior: readonly DocxParagraph[], next: readonly DocxParagraph[], taken: Alignment, usedPrior: ReadonlySet<number>): readonly Match[] {
  const queues = new Map<string, number[]>();
  for (const paragraph of prior) {
    if (!usedPrior.has(paragraph.index)) {
      queues.set(paragraph.text, [...(queues.get(paragraph.text) ?? []), paragraph.index]);
    }
  }
  return next.flatMap((paragraph) => {
    if (taken[paragraph.index] !== null) {
      return [];
    }
    const key = [paragraph.text, ...(hasRevision(paragraph) ? [paragraph.originalText] : [])].find(
      (candidate) => (queues.get(candidate) ?? []).length > 0,
    );
    const [i, ...rest] = key === undefined ? [] : (queues.get(key) ?? []);
    if (key === undefined || i === undefined) {
      return [];
    }
    queues.set(key, rest);
    return [{ prior: i, next: paragraph.index }];
  });
}

function expectedPrior(j: number, nextToPrior: Alignment): number {
  for (let k = j - 1; k >= 0; k -= 1) {
    const i = nextToPrior[k];
    if (i !== null && i !== undefined) {
      return i + (j - k);
    }
  }
  return j;
}

/** Pass 3: greedy similarity within ±ALIGN_WINDOW of the position implied by the previous match. */
function matchBySimilarity(prior: readonly DocxParagraph[], next: readonly DocxParagraph[], initial: Alignment, usedPrior: ReadonlySet<number>): Alignment {
  const nextToPrior = [...initial];
  const used = new Set(usedPrior);
  for (const paragraph of next) {
    const j = paragraph.index;
    if (nextToPrior[j] !== null) {
      continue;
    }
    const centre = expectedPrior(j, nextToPrior);
    const low = Math.max(0, centre - ALIGN_WINDOW);
    const high = Math.min(prior.length - 1, centre + ALIGN_WINDOW);
    let best: { i: number; score: number } | null = null;
    for (let i = low; i <= high; i += 1) {
      if (used.has(i)) {
        continue;
      }
      const score = paragraphScore(prior[i] as DocxParagraph, paragraph);
      const closer = best !== null && score === best.score && Math.abs(i - centre) < Math.abs(best.i - centre);
      if (score >= SIMILARITY_THRESHOLD && (best === null || score > best.score || closer)) {
        best = { i, score };
      }
    }
    if (best) {
      nextToPrior[j] = best.i;
      used.add(best.i);
    }
  }
  return nextToPrior;
}

function applyMatches(alignment: Alignment, matches: readonly Match[]): Alignment {
  const updated = [...alignment];
  for (const match of matches) {
    updated[match.next] = match.prior;
  }
  return updated;
}

function usedPriorIndices(alignment: Alignment): ReadonlySet<number> {
  return new Set(alignment.filter((i): i is number => i !== null));
}

function alignParagraphs(prior: readonly DocxParagraph[], next: readonly DocxParagraph[]): Alignment {
  const empty: Alignment = next.map(() => null);
  const byNumber = applyMatches(empty, matchByNumber(prior, next));
  const byText = applyMatches(byNumber, matchByText(prior, next, byNumber, usedPriorIndices(byNumber)));
  return matchBySimilarity(prior, next, byText, usedPriorIndices(byText));
}

function pairChange(before: DocxParagraph, after: DocxParagraph, clause: string | null): ParagraphChange {
  const changed = before.text !== after.text;
  return {
    kind: changed ? "changed" : "unchanged",
    prior: before.anchor,
    next: after.anchor,
    before: before.text,
    after: after.text,
    edits: changed ? wordDiff(words(before.text), words(after.text)) : [],
    marked: hasRevision(after),
    clause,
  };
}

function addedChange(after: DocxParagraph, clause: string | null): ParagraphChange {
  return { kind: "added", prior: null, next: after.anchor, before: "", after: after.text, edits: [], marked: hasRevision(after), clause };
}

function removedChange(before: DocxParagraph): ParagraphChange {
  return { kind: "removed", prior: before.anchor, next: null, before: before.text, after: "", edits: [], marked: false, clause: null };
}

/** Changes in next-document order, with removed prior paragraphs slotted in before the pair that follows them. */
function buildChanges(prior: DocxDocument, next: DocxDocument, alignment: Alignment): readonly ParagraphChange[] {
  const clauseOf = new Map(splitClauses(next).flatMap((clause) => clause.paragraphs.map((anchor) => [anchor, clause.id] as const)));
  const used = usedPriorIndices(alignment);
  const removed = prior.paragraphs.filter((paragraph) => !used.has(paragraph.index));
  let nextRemoved = 0;
  const changes: ParagraphChange[] = [];
  for (const paragraph of next.paragraphs) {
    const i = alignment[paragraph.index] ?? null;
    const clause = clauseOf.get(paragraph.anchor) ?? null;
    if (i === null) {
      changes.push(addedChange(paragraph, clause));
      continue;
    }
    while (nextRemoved < removed.length && (removed[nextRemoved] as DocxParagraph).index < i) {
      changes.push(removedChange(removed[nextRemoved] as DocxParagraph));
      nextRemoved += 1;
    }
    changes.push(pairChange(prior.paragraphs[i] as DocxParagraph, paragraph, clause));
  }
  return [...changes, ...removed.slice(nextRemoved).map(removedChange)];
}

function normalizeText(text: string): string {
  return text.replace(WHITESPACE_RUN_RE, " ").trim();
}

function firstDefinitions(doc: DocxDocument): ReadonlyMap<string, string> {
  const definitions = new Map<string, string>();
  for (const term of doc.definedTerms) {
    if (!definitions.has(term.term)) {
      definitions.set(term.term, term.definition);
    }
  }
  return definitions;
}

function definitionChanges(prior: DocxDocument, next: DocxDocument): DocxDiff["definitionChanges"] {
  const after = firstDefinitions(next);
  return [...firstDefinitions(prior).entries()].flatMap(([term, before]) => {
    const updated = after.get(term);
    return updated !== undefined && normalizeText(updated) !== normalizeText(before) ? [{ term, before, after: updated }] : [];
  });
}

type NumberedHeading = { number: string; heading: string };

/** Heading key -> number, for headings that occur exactly once with a number in the document. */
function headingNumbers(doc: DocxDocument): ReadonlyMap<string, NumberedHeading> {
  const entries = doc.paragraphs
    .filter((paragraph) => paragraph.number !== "")
    .map((paragraph) => ({ number: paragraph.number, heading: headingText(paragraph.text) }))
    .filter((entry) => entry.heading !== "");
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = normalizeText(entry.heading).toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Map(
    entries.filter((entry) => counts.get(normalizeText(entry.heading).toLowerCase()) === 1).map((entry) => [normalizeText(entry.heading).toLowerCase(), entry]),
  );
}

function renumbered(prior: DocxDocument, next: DocxDocument): DocxDiff["renumbered"] {
  const after = headingNumbers(next);
  return [...headingNumbers(prior).entries()].flatMap(([key, before]) => {
    const updated = after.get(key);
    const moved = updated !== undefined && normalizeText(updated.number).toLowerCase() !== normalizeText(before.number).toLowerCase();
    return moved ? [{ before: before.number, after: updated.number, heading: before.heading }] : [];
  });
}

export function diffDocuments(prior: DocxDocument, next: DocxDocument): DocxDiff {
  const changes = buildChanges(prior, next, alignParagraphs(prior.paragraphs, next.paragraphs));
  return {
    changes,
    unmarked: changes.filter((change) => change.kind !== "unchanged" && !change.marked),
    definitionChanges: definitionChanges(prior, next),
    renumbered: renumbered(prior, next),
  };
}
