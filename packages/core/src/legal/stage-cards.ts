/**
 * Stage cards: one short block per model call telling the model where it is in the nine-stage pipeline,
 * what came before, what its output feeds, what not to do, and the exact return shape. Deterministic.
 */

import { DELIVERABLE_LABELS } from "./deliverable-manuals";
import type { ChecklistItem, DeliverableKind } from "./types";
import { DOC_ROLES } from "./types";

export const TOTAL_STAGES = 9;

export type StageCardInput =
  | { stage: "classify"; fileCount: number }
  | { stage: "review"; clauseId: string; unmarkedChanges: number; checklistItems: readonly ChecklistItem[] }
  | { stage: "missing"; item: ChecklistItem }
  | { stage: "interaction"; findingTitle: string; clauseId: string }
  | { stage: "draft"; deliverable: DeliverableKind; manual: string }
  | { stage: "verify-checklist"; deliverable: DeliverableKind; itemCount: number }
  | { stage: "verify-opposing"; deliverable: DeliverableKind }
  | { stage: "edit"; target: string; failure: string };

type StageName = StageCardInput["stage"];

/** Pipeline position of each card. Missing and interaction passes belong to the review stage. */
const STAGE_NUMBER: Readonly<Record<StageName, number>> = {
  classify: 2,
  review: 4,
  missing: 4,
  interaction: 4,
  draft: 5,
  "verify-checklist": 6,
  "verify-opposing": 6,
  edit: 7,
};

const FINDING_SHAPE =
  'a Finding object with fields kind ("adverse" | "deviation" | "unmarked-change" | "interaction" | "missing"), clause, quote (verbatim from the clause; empty for missing), title, why, severity ("high" | "medium" | "low"), negotiability ("preferred" | "fallback" | "walk-away" | "reserved"), proposedText (string or null), basis (array of {doc, ref}), reservedFor (string or null), checklist (array of checklist item ids)';

const MEMO_OUTLINE_SHAPE =
  '{"to", "from", "date", "re", "privileged", "sections": [{"heading", "paragraphs": [...], "findingsTable": [finding ids]}]}';

/** Deliverables the model composes; the others are rendered by code from the findings. */
const MODEL_COMPOSED: readonly DeliverableKind[] = ["issues-memo", "executive-summary"];

type CardParts = { header: string; before: string; feeds: string; doNot: string; returns: string };

function renderCard(stage: StageName, parts: CardParts): string {
  return [
    `STAGE ${STAGE_NUMBER[stage]} of ${TOTAL_STAGES} — ${parts.header}`,
    `Before this: ${parts.before}`,
    `Your output feeds: ${parts.feeds}`,
    `Do not: ${parts.doNot}`,
    `Return: ${parts.returns}`,
  ].join("\n");
}

function classifyCard(fileCount: number): string {
  return renderCard("classify", {
    header: `CLASSIFY, ${fileCount} documents`,
    before: "code ingested the documents, read their text and recorded a 600-character preview of each.",
    feeds:
      "the document roles used for source priority and retrieval in every later stage; the user confirms the roles before the review proceeds.",
    doNot:
      "summarise or assess the documents; assign a role on the basis of the filename alone when the preview contradicts it.",
    returns: `{"docs": [{"id", "role", "reason"}]} with one entry per document and role one of ${DOC_ROLES.map((role) => `"${role}"`).join(", ")}.`,
  });
}

function reviewCard(clauseId: string, unmarkedChanges: number, items: readonly ChecklistItem[]): string {
  const changeNote =
    unmarkedChanges === 0
      ? "found no unmarked changes in this clause"
      : `found ${unmarkedChanges} unmarked changes; the record for this clause is in the payload`;
  const mapped =
    items.length === 0
      ? "No checklist item is mapped to this clause."
      : `Checklist items mapped to this clause: ${items.map((item) => `${item.id} ${item.title}`).join("; ")}.`;
  return renderCard("review", {
    header: `REVIEW, clause ${clauseId} of the counterparty draft`,
    before: `code compared the counterparty draft with the prior turn and ${changeNote}. ${mapped}`,
    feeds:
      "the issues memorandum, the redline and the deviation report. Code applies proposedText to the counterparty draft as a tracked change in the author's name, with your basis as the margin comment.",
    doNot:
      "review other clauses here; summarise the document; propose language for reserved points; quote anything other than the clause text supplied.",
    returns: `one ${FINDING_SHAPE}; or {"kind": "ok"} if the clause is acceptable as drafted; or {"findings": [...]} with at most 8 Finding objects when the clause raises several distinct points.`,
  });
}

function missingCard(item: ChecklistItem): string {
  return renderCard("missing", {
    header: `REVIEW (missing provisions), checklist item ${item.id} ${item.title}`,
    before:
      "code mapped every checklist item to the clauses of the counterparty draft by keyword overlap and found no clause for this item.",
    feeds:
      "a finding of kind missing with the playbook's preferred language as the proposal, listed under Missing provisions in the memorandum and inserted into the redline.",
    doNot:
      "draft the missing provision here; treat a passing mention as the provision itself; confirm absence without checking the passages supplied.",
    returns: '{"itemId", "absent" (boolean), "foundIn": {"clause", "anchor"} or null, "reason"}.',
  });
}

function interactionCard(findingTitle: string, clauseId: string): string {
  return renderCard("interaction", {
    header: `REVIEW (interactions), finding "${findingTitle}" against clause ${clauseId}`,
    before:
      "code retrieved the clauses that share defined terms or section references with a high-severity finding and supplies one of them here.",
    feeds:
      "a finding of kind interaction when the clauses compound the problem, reported alongside the original finding in every deliverable.",
    doNot:
      "re-review the original finding; raise unrelated points about this clause; propose language for reserved points.",
    returns:
      '{"compounds" (boolean), "clause", "why", "severity" ("high" | "medium" | "low"), "quote" (verbatim from the clause supplied)}.',
  });
}

function draftCard(deliverable: DeliverableKind, manual: string): string {
  const label = DELIVERABLE_LABELS[deliverable];
  const composed = MODEL_COMPOSED.includes(deliverable);
  const returns = composed
    ? `${MEMO_OUTLINE_SHAPE}. Paragraphs reference findings by {{F<n>}} token only; code expands each token to the finding title and citation.`
    : '{"sections": []}. Code renders this deliverable from the findings; do not compose text for it.';
  return renderCard("draft", {
    header: `DRAFT, ${label}`,
    before:
      "code assembled the full findings list, verified every quote against the counterparty draft, and applied the reserved-point instructions.",
    feeds: `the ${label} rendered by code, then the verification stage, which checks quotations, figures, cross-references, defined terms, names and dates.`,
    doNot:
      "introduce facts, figures or quotations not present in the findings or the matter documents; address the Client directly; characterise the counterparty's motives.",
    returns: `${returns}\nFORMAT MANUAL\n${manual}`,
  });
}

function verifyChecklistCard(deliverable: DeliverableKind, itemCount: number): string {
  return renderCard("verify-checklist", {
    header: `VERIFY (checklist pass), ${DELIVERABLE_LABELS[deliverable]}, ${itemCount} checklist items`,
    before:
      "you act as the verifier. Code ran its deterministic checks on this deliverable; you receive only the deliverable text and one chunk of the checklist, not the drafting model's reasoning.",
    feeds:
      "the verification report shown to the reviewing lawyer and the list of failures corrected in the edit stage. A code failure is never overruled by a pass here.",
    doNot:
      "rewrite the deliverable; judge from anything other than the text supplied; pass an item on the assumption that it is covered elsewhere.",
    returns: '{"verdicts": [{"itemId", "pass" (boolean), "reason"}]} with one verdict per checklist item supplied.',
  });
}

function verifyOpposingCard(deliverable: DeliverableKind): string {
  return renderCard("verify-opposing", {
    header: `VERIFY (opposing-counsel pass), ${DELIVERABLE_LABELS[deliverable]}`,
    before:
      "you act as counsel for the other side. Code ran its deterministic checks and the checklist pass; you receive the deliverable text only.",
    feeds:
      "candidate findings for the edit stage where a concession is to be fixed, or the list of points open for the reviewing lawyer where the concession is judged market.",
    doNot:
      "restate points already in the deliverable; propose language for the counterparty; comment on style rather than substance.",
    returns:
      '{"concessions": [{"clause", "detail", "disposition" ("fix" | "market" | "reserved")}]} listing what the deliverable concedes, leaves ambiguous or fails to close.',
  });
}

function editCard(target: string, failure: string): string {
  return renderCard("edit", {
    header: `EDIT, target ${target}`,
    before: `verification failed this check: ${failure}. Code supplies the current text of the affected section or finding only.`,
    feeds:
      "a replacement applied by code to the ledger, after which only the affected deliverables are re-rendered and verified again.",
    doNot:
      "change anything outside the target; introduce new findings, facts or figures; propose language for reserved points.",
    returns:
      'if the target is a memorandum section, {"section": {"heading", "paragraphs": [...], "findingsTable": [...]}}; if the target is a finding, {"quote", "proposedText", "why"} containing only the fields that change.',
  });
}

export function buildStageCard(stage: StageCardInput): string {
  switch (stage.stage) {
    case "classify":
      return classifyCard(stage.fileCount);
    case "review":
      return reviewCard(stage.clauseId, stage.unmarkedChanges, stage.checklistItems);
    case "missing":
      return missingCard(stage.item);
    case "interaction":
      return interactionCard(stage.findingTitle, stage.clauseId);
    case "draft":
      return draftCard(stage.deliverable, stage.manual);
    case "verify-checklist":
      return verifyChecklistCard(stage.deliverable, stage.itemCount);
    case "verify-opposing":
      return verifyOpposingCard(stage.deliverable);
    case "edit":
      return editCard(stage.target, stage.failure);
  }
}
