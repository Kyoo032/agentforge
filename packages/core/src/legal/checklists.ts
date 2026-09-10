/**
 * Built-in playbooks and the checklist-to-clause mapper. Pure functions over immutable data.
 *
 * Mapping scores each (item, clause) pair by keyword overlap over the clause heading and text:
 * case-insensitive, lightly stemmed (plural "s", "ies", and "ing" stripped). Score is the share of the
 * item's keywords found in the clause, 0..1. The best clause per item wins, ties broken by clause order,
 * and only scores at or above CHECKLIST_MATCH_THRESHOLD count as mapped.
 */

import type { DocxClause } from "../docx/types";
import { CREDIT_AGREEMENT_BORROWER_PLAYBOOK } from "./playbook-credit-agreement";
import { GENERIC_CONTRACT_PLAYBOOK } from "./playbook-generic-contract";
import { NDA_RECEIVING_PLAYBOOK } from "./playbook-nda";
import type { ChecklistItem, Playbook } from "./types";

export const CHECKLIST_MATCH_THRESHOLD = 0.25;

const PLURAL_IES_MIN_LENGTH = 5;
const PLURAL_S_MIN_LENGTH = 4;
const GERUND_MIN_LENGTH = 7;

export const BUILTIN_PLAYBOOKS: readonly Playbook[] = [
  GENERIC_CONTRACT_PLAYBOOK,
  CREDIT_AGREEMENT_BORROWER_PLAYBOOK,
  NDA_RECEIVING_PLAYBOOK,
];

export type ChecklistMatch = { itemId: string; clauseId: string; score: number };

export type ChecklistMapping = {
  /** Best clause per item, score 0..1. */
  mapped: readonly ChecklistMatch[];
  /** Item ids with no clause at or above the threshold. */
  unmapped: readonly string[];
};

export function findPlaybook(id: string): Playbook | null {
  return BUILTIN_PLAYBOOKS.find((playbook) => playbook.id === id) ?? null;
}

/** Strip a plural "s" / "ies" and a trailing "ing" so "governing laws" and "governed law" meet in the middle. */
function stem(word: string): string {
  const singular =
    word.length >= PLURAL_IES_MIN_LENGTH && word.endsWith("ies")
      ? `${word.slice(0, -3)}y`
      : word.length >= PLURAL_S_MIN_LENGTH && word.endsWith("s") && !word.endsWith("ss")
        ? word.slice(0, -1)
        : word;
  return singular.length >= GERUND_MIN_LENGTH && singular.endsWith("ing") ? singular.slice(0, -3) : singular;
}

/** Lower-case, split on anything that is not a letter or digit, stem each token, and re-join with single spaces. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
    .map(stem)
    .join(" ");
}

/** Whole-token phrase containment on normalised text. */
function containsPhrase(haystack: string, phrase: string): boolean {
  return phrase.length > 0 && ` ${haystack} `.includes(` ${phrase} `);
}

function scoreItem(item: ChecklistItem, clauseText: string): number {
  if (item.keywords.length === 0) {
    return 0;
  }
  const hits = item.keywords.filter((keyword) => containsPhrase(clauseText, normalise(keyword))).length;
  return hits / item.keywords.length;
}

function bestClause(item: ChecklistItem, clauses: readonly { id: string; text: string }[]): ChecklistMatch | null {
  return clauses.reduce<ChecklistMatch | null>((best, clause) => {
    const score = scoreItem(item, clause.text);
    return best === null || score > best.score ? { itemId: item.id, clauseId: clause.id, score } : best;
  }, null);
}

export function mapChecklistToClauses(playbook: Playbook, clauses: readonly DocxClause[]): ChecklistMapping {
  const normalisedClauses = clauses.map((clause) => ({
    id: clause.id,
    text: normalise(`${clause.heading} ${clause.text}`),
  }));
  const matches = playbook.items.map((item) => ({ item, match: bestClause(item, normalisedClauses) }));
  return {
    mapped: matches.flatMap(({ match }) => (match !== null && match.score >= CHECKLIST_MATCH_THRESHOLD ? [match] : [])),
    unmapped: matches.flatMap(({ item, match }) =>
      match === null || match.score < CHECKLIST_MATCH_THRESHOLD ? [item.id] : [],
    ),
  };
}
