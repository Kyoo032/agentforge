/**
 * Turns findings into redline instructions for the docx writer. Provisions with a verbatim quote
 * become tracked replacements; missing provisions become inserted paragraphs after the closest clause.
 * Reserved points produce nothing: the writer must not touch what a partner has held open.
 */
import { findQuote } from "@agentforge/core/docx";
import type {
  DocxClause,
  DocxDocument,
  ParagraphAnchor,
  RedlineInsertParagraph,
  RedlinePatch,
} from "@agentforge/core/docx";
import type { Finding, FindingKind } from "@agentforge/core/legal";
import { formatBasis, isActionable } from "./render-shared";

const PATCH_KINDS: readonly FindingKind[] = ["adverse", "deviation", "unmarked-change", "interaction"];
const CLAUSE_NORMALISE = /[\s.]+$|\s+/g;

/** "<title>. Basis: <citations>." — the margin comment in formal register. */
export function basisComment(finding: Finding): string {
  const title = finding.title.trim().replace(/[.\s]+$/, "");
  return `${title}. Basis: ${formatBasis(finding.basis)}.`;
}

function normaliseClauseId(id: string): string {
  return id.replace(CLAUSE_NORMALISE, "").toLowerCase();
}

/** Exact id first, then the longest clause id that is a prefix of (or prefixed by) the finding's clause. */
export function matchClause(clauseId: string, clauses: readonly DocxClause[]): DocxClause | null {
  const target = normaliseClauseId(clauseId);
  if (target === "") {
    return null;
  }
  const exact = clauses.find((clause) => normaliseClauseId(clause.id) === target);
  if (exact) {
    return exact;
  }
  const related = clauses.filter((clause) => {
    const id = normaliseClauseId(clause.id);
    return id !== "" && (id.startsWith(target) || target.startsWith(id));
  });
  return related.reduce<DocxClause | null>(
    (best, clause) => (best === null || clause.id.length > best.id.length ? clause : best),
    null,
  );
}

function lastBodyAnchor(draft: DocxDocument): ParagraphAnchor | null {
  const last = draft.paragraphs[draft.paragraphs.length - 1];
  return last ? last.anchor : null;
}

function insertionAnchor(
  finding: Finding,
  draft: DocxDocument,
  clauses: readonly DocxClause[],
): ParagraphAnchor | null {
  const clause = matchClause(finding.clause, clauses);
  const lastOfClause = clause?.paragraphs[clause.paragraphs.length - 1];
  return lastOfClause ?? lastBodyAnchor(draft);
}

function patchAnchor(finding: Finding, draft: DocxDocument): ParagraphAnchor | null {
  return finding.quoteAnchor ?? findQuote(draft, finding.quote)?.anchor ?? null;
}

function toPatch(finding: Finding, draft: DocxDocument): RedlinePatch | null {
  if (!PATCH_KINDS.includes(finding.kind) || finding.quote.trim() === "" || finding.proposedText === null) {
    return null;
  }
  const anchor = patchAnchor(finding, draft);
  return anchor === null
    ? null
    : { anchor, find: finding.quote, replace: finding.proposedText, comment: basisComment(finding) };
}

function toInsert(
  finding: Finding,
  draft: DocxDocument,
  clauses: readonly DocxClause[],
): RedlineInsertParagraph | null {
  if (finding.kind !== "missing" || finding.proposedText === null) {
    return null;
  }
  const after = insertionAnchor(finding, draft, clauses);
  return after === null ? null : { after, text: finding.proposedText, comment: basisComment(finding) };
}

/**
 * One patch per actionable provision finding and one insert per actionable missing finding.
 * Findings without a locatable anchor are skipped; the run reports them through the verifier.
 */
export function buildRedlinePatches(
  findings: readonly Finding[],
  draft: DocxDocument,
  clauses: readonly DocxClause[],
): { patches: RedlinePatch[]; inserts: RedlineInsertParagraph[] } {
  const actionable = findings.filter(isActionable);
  const patches = actionable.flatMap((finding) => {
    const patch = toPatch(finding, draft);
    return patch ? [patch] : [];
  });
  const inserts = actionable.flatMap((finding) => {
    const insert = toInsert(finding, draft, clauses);
    return insert ? [insert] : [];
  });
  return { patches, inserts };
}
