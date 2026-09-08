/**
 * Helpers shared by the Legal deliverable renderers. Pure, no I/O.
 * Formal register only: parties by defined term, provisions by section number, documents by id.
 */
import type { Citation, Finding, FindingKind, LegalSide, Severity } from "@agentforge/core/legal";

/** Mandatory last line of every deliverable (legal-mode-flow.md §12). */
export const CLOSING_LINE = "Draft work product prepared with automated assistance for review by a qualified lawyer.";

export const NO_CITATION = "no citation recorded";
export const NOT_FOUND_TOKEN = "[finding not found]";
export const NONE_IDENTIFIED = "None identified.";

/** Sort order for severities: high first. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = { high: 0, medium: 1, low: 2 };

/** Display labels for finding kinds, in the register the UI uses. */
export const KIND_LABELS: Readonly<Record<FindingKind, string>> = {
  adverse: "Adverse provision",
  deviation: "Deviation from playbook",
  "unmarked-change": "Unmarked change",
  interaction: "Interaction",
  missing: "Missing provision",
  ok: "Conforms",
};

const CLAUSE_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** "S2 ¶41, PB CA-07" — document id then reference, comma-separated. */
export function formatBasis(basis: readonly Citation[]): string {
  return basis.length === 0 ? NO_CITATION : basis.map((citation) => `${citation.doc} ${citation.ref}`).join(", ");
}

/** "<title> (<clause>; <basis>)" — the expansion used for memo tokens and cross-references. */
export function findingLabel(finding: Finding): string {
  return `${finding.title} (${finding.clause}; ${formatBasis(finding.basis)})`;
}

/** Proposed language, or the reservation note when the point is held for a named reviewer. */
export function proposedLanguage(finding: Finding): string {
  if (finding.reservedFor !== null) {
    return `Reserved for ${finding.reservedFor}`;
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
export function positionLine(side: LegalSide): string {
  return `Acting for ${side.party} (${side.role}) against ${side.counterparty}.`;
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
