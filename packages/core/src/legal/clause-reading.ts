/**
 * What a clause review needs beside the clause text: defined terms the clause uses,
 * and instruction lines that share its words. Pure. No model call.
 */

import type { DocxDocument } from "../docx/types";

const TERM_CAP = 8;
const DEFINITION_CAP = 200;
const PASSAGE_CAP = 5;
const PASSAGE_CHARS = 400;
const LINE_CAP = 200;
const MIN_PASSAGE_CHARS = 20;
const MIN_TOKEN_LENGTH = 4;

export type ClauseDefinedTerm = {
  term: string;
  paragraph: string;
  definition: string;
};

export type InstructionPassage = {
  source: string;
  text: string;
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termAppears(clauseText: string, term: string): boolean {
  if (term.trim().length < 2) {
    return false;
  }
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(term)}(?:$|[^\\p{L}\\p{N}])`, "u");
  return pattern.test(clauseText);
}

export function definedTermsForClause(doc: DocxDocument | null, clauseText: string): ClauseDefinedTerm[] {
  if (!doc) {
    return [];
  }
  const out: ClauseDefinedTerm[] = [];
  for (const term of doc.definedTerms) {
    if (!termAppears(clauseText, term.term)) {
      continue;
    }
    out.push({
      term: term.term,
      paragraph: term.paragraph,
      definition:
        term.definition.length > DEFINITION_CAP ? `${term.definition.slice(0, DEFINITION_CAP)}…` : term.definition,
    });
    if (out.length >= TERM_CAP) {
      break;
    }
  }
  return out;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= MIN_TOKEN_LENGTH),
  );
}

function scorePassage(clauseTokens: ReadonlySet<string>, passage: string): number {
  let score = 0;
  for (const token of tokens(passage)) {
    if (clauseTokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

export function instructionPassagesForClause(
  sources: readonly { source: string; text: string }[],
  clauseText: string,
): InstructionPassage[] {
  const clauseTokens = tokens(clauseText);
  const ranked: { source: string; text: string; score: number; order: number }[] = [];
  let order = 0;
  for (const source of sources) {
    const lines = source.text.split(/\n+/u);
    const limited = lines.slice(0, LINE_CAP);
    for (const line of limited) {
      const text = line.trim();
      if (text.length < MIN_PASSAGE_CHARS) {
        continue;
      }
      const score = scorePassage(clauseTokens, text);
      if (score === 0) {
        continue;
      }
      ranked.push({
        source: source.source,
        text: text.length > PASSAGE_CHARS ? `${text.slice(0, PASSAGE_CHARS)}…` : text,
        score,
        order,
      });
      order += 1;
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.order - b.order);
  return ranked.slice(0, PASSAGE_CAP).map((row) => ({ source: row.source, text: row.text }));
}
