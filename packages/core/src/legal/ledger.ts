/**
 * Run ledger: the immutable record of documents, findings and verification rounds for one run.
 * Every function returns a new object; inputs are never mutated.
 */

import { type FindingDraft, findingDraftSchema } from "./schemas";
import type { EditPatch, Finding, MatterDocCard, RoundRecord } from "./types";

export type RunLedger = {
  readonly docs: readonly MatterDocCard[];
  readonly findings: readonly Finding[];
  readonly rounds: readonly RoundRecord[];
};

export type FindingEditResult = {
  findings: readonly Finding[];
  /** Refs of patches that were not applied: unknown finding ids or replacements that failed validation. */
  ignored: readonly string[];
};

const FINDINGS_TARGET = "findings";

/** Replacements may be partial; absent fields keep the original value and schema defaults are not applied. */
const partialDraftSchema = findingDraftSchema.partial();

export function createLedger(docs: readonly MatterDocCard[], findings: readonly Finding[]): RunLedger {
  return { docs: [...docs], findings: [...findings], rounds: [] };
}

export function appendRound(ledger: RunLedger, round: RoundRecord): RunLedger {
  return { ...ledger, rounds: [...ledger.rounds, round] };
}

function definedFields(draft: Partial<FindingDraft>): Partial<FindingDraft> {
  return Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined)) as Partial<FindingDraft>;
}

/** Merge a validated replacement over the original: id and anchor are kept, round is set from the patch. */
function mergeFinding(original: Finding, draft: Partial<FindingDraft>, round: number): Finding {
  return { ...original, ...definedFields(draft), id: original.id, quoteAnchor: original.quoteAnchor, round };
}

function applyOne(state: FindingEditResult, patch: EditPatch): FindingEditResult {
  const index = state.findings.findIndex((finding) => finding.id === patch.target.ref);
  const parsed = partialDraftSchema.safeParse(patch.replacement);
  if (index < 0 || !parsed.success) {
    return { ...state, ignored: [...state.ignored, patch.target.ref] };
  }
  const original = state.findings[index] as Finding;
  const merged = mergeFinding(original, parsed.data, patch.round);
  return { ...state, findings: state.findings.map((finding, at) => (at === index ? merged : finding)) };
}

/**
 * Apply the patches aimed at findings, in order, so later patches win. Patches for other deliverables are
 * skipped silently; unknown ids and invalid replacements are reported in `ignored`.
 */
export function applyFindingEdits(findings: readonly Finding[], edits: readonly EditPatch[]): FindingEditResult {
  const initial: FindingEditResult = { findings: [...findings], ignored: [] };
  return edits
    .filter((patch) => patch.target.deliverable === FINDINGS_TARGET)
    .reduce<FindingEditResult>((state, patch) => applyOne(state, patch), initial);
}
