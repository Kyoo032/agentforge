/**
 * Helpers shared by the Legal deliverable renderers. Pure, no I/O.
 * Formal register only: parties by defined term, provisions by section number, documents by id.
 */
import { fillCopy, legalOutputCopy, type LegalLocale } from "@agentforge/core/legal";
import type { Citation, Finding, FindingKind, LegalSide, Severity } from "@agentforge/core/legal";

const EN = legalOutputCopy("en");

/** Mandatory last line of every deliverable (legal-mode-flow.md §12). English default for tests. */
export const CLOSING_LINE = EN.closingLine;

export const NO_CITATION = EN.noCitation;
export const NOT_FOUND_TOKEN = EN.findingNotFound;
export const NONE_IDENTIFIED = EN.noneIdentified;

/** Sort order for severities: high first. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = { high: 0, medium: 1, low: 2 };

/** Display labels for finding kinds, in the register the UI uses. */
export const KIND_LABELS: Readonly<Record<FindingKind, string>> = EN.kindLabels;

const CLAUSE_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** "S2 ¶41, PB CA-07" — document id then reference, comma-separated. */
export function formatBasis(basis: readonly Citation[], locale: LegalLocale = "en"): string {
  return basis.length === 0
    ? legalOutputCopy(locale).noCitation
    : basis.map((citation) => `${citation.doc} ${citation.ref}`).join(", ");
}

/** "<title> (<clause>; <basis>)" — the expansion used for memo tokens and cross-references. */
export function findingLabel(finding: Finding, locale: LegalLocale = "en"): string {
  return `${finding.title} (${finding.clause}; ${formatBasis(finding.basis, locale)})`;
}

/** Proposed language, or the reservation note when the point is held for a named reviewer. */
export function proposedLanguage(finding: Finding, locale: LegalLocale = "en"): string {
  if (finding.reservedFor !== null) {
    return fillCopy(legalOutputCopy(locale).reservedFor, { who: finding.reservedFor });
  }
  return finding.proposedText ?? "";
}

/** True when a finding carries a proposal the renderers may act on. */
export function isActionable(finding: Finding): boolean {
  return finding.reservedFor === null && finding.proposedText !== null;
}

/** Severity high to low, then clause id in natural numeric order, then finding id. */
export function compareFindings(a: Finding, b: Finding): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) {
    return bySeverity;
  }
  const byClause = CLAUSE_COLLATOR.compare(a.clause, b.clause);
  return byClause !== 0 ? byClause : CLAUSE_COLLATOR.compare(a.id, b.id);
}

/** New array sorted with compareFindings; the input is left untouched. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(compareFindings);
}

/** "Acting for Borrower Co (borrower) against the Lenders." */
export function positionLine(side: LegalSide, locale: LegalLocale = "en"): string {
  return fillCopy(legalOutputCopy(locale).positionLine, {
    party: side.party,
    role: side.role,
    counterparty: side.counterparty,
  });
}

/** Index by finding id; later duplicates win, matching the ledger's replace semantics. */
export function findingsById(findings: readonly Finding[]): ReadonlyMap<string, Finding> {
  return new Map(findings.map((finding) => [finding.id, finding]));
}

/** Counts per key over an ordered key list, so every key appears even at zero. */
export function countBy<K extends string>(
  keys: readonly K[],
  findings: readonly Finding[],
  keyOf: (finding: Finding) => K,
): readonly (readonly [K, number])[] {
  return keys.map((key) => [key, findings.filter((finding) => keyOf(finding) === key).length] as const);
}
