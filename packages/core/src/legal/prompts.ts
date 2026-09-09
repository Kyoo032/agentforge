/**
 * Harness preamble (legal-mode-flow.md §11). Identical for every model call in a run so providers can cache it:
 * no dates, no random ids, no document text beyond names and counters.
 */

import { DELIVERABLE_LABELS } from "./deliverable-manuals";
import type { DeliverableKind, DocRole, LegalSide, LegalWorkType, MatterDocCard, Playbook } from "./types";
import { DELIVERABLE_FORMAT, DOC_ROLE_PRIORITY } from "./types";

export { DELIVERABLE_LABELS, DELIVERABLE_MANUALS, WORK_PRODUCT_LINE } from "./deliverable-manuals";
export { type StageCardInput, TOTAL_STAGES, buildStageCard } from "./stage-cards";

export type PreambleInput = {
  side: LegalSide;
  workType: LegalWorkType;
  deliverables: readonly DeliverableKind[];
  author: string;
  addressee: string;
  firm: string;
  docs: readonly MatterDocCard[];
  playbook: Playbook | null;
  priorityNote: string;
};

export const PLAYBOOK_DOC_ID = "PB";
const INDENT = "  ";
const COLUMN_GAP = 3;
const ID_COLUMN_WIDTH = 4;

const IDENTITY_BLOCK = [
  "You are the drafting and review engine inside DPSBuddy Legal, working for a law firm on one matter.",
  "You do not act alone. Code around you extracts the documents, finds unmarked changes, applies your",
  "proposals to the documents, and checks your output. Your work is discarded if it fails those checks.",
].join("\n");

const LANGUAGE_BLOCK = [
  "LANGUAGE",
  `${INDENT}Formal legal register. Refer to parties by their defined terms. No first person outside the memorandum's`,
  `${INDENT}own voice. State what the documents show; do not speculate about intent beyond the text. No advice to`,
  `${INDENT}the client; the deliverables are draft work product for review by a qualified lawyer.`,
].join("\n");

function capitalise(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

function deliverableList(kinds: readonly DeliverableKind[]): string {
  return kinds.map((kind) => `${DELIVERABLE_LABELS[kind]} (${DELIVERABLE_FORMAT[kind]})`).join(", ");
}

function matterBlock(input: PreambleInput): string {
  const firmLine = input.firm.trim().length > 0 ? [`${INDENT}Firm: ${input.firm.trim()}.`] : [];
  return [
    "MATTER",
    `${INDENT}Client: ${input.side.party} (the "${capitalise(input.side.role)}"). Counterparty: ${input.side.counterparty}.`,
    `${INDENT}Work type: ${input.workType}. Deliverables: ${deliverableList(input.deliverables)}.`,
    `${INDENT}Author of record for the deliverables: ${input.author}. Addressee: ${input.addressee}.`,
    ...firmLine,
  ].join("\n");
}

type DocRow = { id: string; role: string; name: string; counters: string };

function counters(doc: MatterDocCard): string {
  if (doc.status === "skipped") {
    return doc.skipReason?.trim() || "skipped, no reason recorded";
  }
  const terms = doc.definedTerms > 0 ? [`${doc.definedTerms} defined terms`] : [];
  const revisions =
    doc.insertions > 0 || doc.deletions > 0 ? [`${doc.insertions} insertions, ${doc.deletions} deletions`] : [];
  return [`${doc.paragraphs} ¶`, ...terms, ...revisions].join(", ");
}

function docRow(doc: MatterDocCard): DocRow {
  return {
    id: doc.id,
    role: doc.status === "skipped" ? `${doc.role} (skipped)` : doc.role,
    name: doc.name,
    counters: counters(doc),
  };
}

function playbookRow(playbook: Playbook): DocRow {
  const required = playbook.items.filter((item) => item.required).length;
  const fallbacks = playbook.items.filter((item) => item.fallback.trim().length > 0).length;
  return {
    id: PLAYBOOK_DOC_ID,
    role: "playbook",
    name: playbook.title,
    counters: `${required} required provisions, ${fallbacks} fallbacks`,
  };
}

function documentsBlock(docs: readonly MatterDocCard[], playbook: Playbook | null): string {
  const rows = [...docs.map(docRow), ...(playbook ? [playbookRow(playbook)] : [])];
  const roleWidth = Math.max(0, ...rows.map((row) => row.role.length)) + COLUMN_GAP;
  const nameWidth = Math.max(0, ...rows.map((row) => row.name.length)) + COLUMN_GAP;
  const lines = rows.map(
    (row) =>
      `${INDENT}${row.id.padEnd(ID_COLUMN_WIDTH)}${row.role.padEnd(roleWidth)}${row.name.padEnd(nameWidth)}${row.counters}`,
  );
  return ["DOCUMENTS (cite by id; you receive full text only for what a stage gives you)", ...lines].join("\n");
}

type PriorityEntry = { id: string; role: DocRole; priority: number };

function priorityGroups(entries: readonly PriorityEntry[]): string[] {
  const sorted = [...entries].sort((a, b) => a.priority - b.priority);
  const levels = [...new Set(sorted.map((entry) => entry.priority))];
  return levels.map((level) => {
    const group = sorted.filter((entry) => entry.priority === level);
    return group.every((entry) => entry.role === "context") ? "context" : group.map((entry) => entry.id).join(", ");
  });
}

function priorityBlock(docs: readonly MatterDocCard[], playbook: Playbook | null, note: string): string {
  const entries: PriorityEntry[] = [
    ...docs.map((doc) => ({ id: doc.id, role: doc.role, priority: DOC_ROLE_PRIORITY[doc.role] })),
    ...(playbook ? [{ id: PLAYBOOK_DOC_ID, role: "playbook" as const, priority: DOC_ROLE_PRIORITY.playbook }] : []),
  ];
  const chain = priorityGroups(entries).join(" > ");
  const line =
    chain.length > 0 ? `SOURCE PRIORITY when documents conflict: ${chain}.` : "SOURCE PRIORITY: no documents.";
  const noteLines = note.trim().length > 0 ? [`${INDENT}${note.trim()}`] : [];
  return [line, ...noteLines].join("\n");
}

function rulesBlock(docs: readonly MatterDocCard[]): string {
  const draft = docs.find((doc) => doc.role === "counterparty-draft")?.id ?? "the counterparty draft";
  return [
    "RULES ENFORCED BY CODE AFTER YOU ANSWER",
    `${INDENT}1. Every quotation must appear verbatim in the cited document. Paraphrase inside quotation marks is rejected.`,
    `${INDENT}2. Every figure must be cited by reference (S5 Cov!B7) or by a named computation. Free numbers are marked unverified.`,
    `${INDENT}3. Every finding must cite at least one document id and paragraph anchor (S2 ¶41).`,
    `${INDENT}4. Section references must exist in ${draft} after your proposals are applied.`,
    `${INDENT}5. Where an instruction reserves a point, propose no language for it.`,
    `${INDENT}6. Output must validate against the JSON schema for this stage. Invalid output is retried once, then dropped.`,
  ].join("\n");
}

export function buildPreamble(input: PreambleInput): string {
  return [
    IDENTITY_BLOCK,
    matterBlock(input),
    documentsBlock(input.docs, input.playbook),
    priorityBlock(input.docs, input.playbook, input.priorityNote),
    rulesBlock(input.docs),
    LANGUAGE_BLOCK,
  ].join("\n\n");
}
