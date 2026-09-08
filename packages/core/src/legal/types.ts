/**
 * Legal mode — shared shapes.
 *
 * Everything the pipeline passes between stages is plain, immutable data validated by the
 * zod schemas in ./schemas.ts. Model output is parsed through those schemas before any code trusts it.
 */

import type { ParagraphAnchor } from "../docx/types";

export const LEGAL_WORK_TYPES = ["review", "markup", "draft", "analyze"] as const;
export type LegalWorkType = (typeof LEGAL_WORK_TYPES)[number];

export const DOC_ROLES = [
  "counterparty-draft",
  "our-draft",
  "prior-turn",
  "executed",
  "instruction",
  "playbook",
  "figures",
  "precedent",
  "context",
] as const;
export type DocRole = (typeof DOC_ROLES)[number];

/** Source priority when documents conflict: lower number wins. */
export const DOC_ROLE_PRIORITY: Readonly<Record<DocRole, number>> = {
  executed: 1,
  instruction: 2,
  playbook: 3,
  "counterparty-draft": 4,
  "our-draft": 4,
  "prior-turn": 5,
  precedent: 6,
  figures: 6,
  context: 7,
};

export const DELIVERABLE_KINDS = ["issues-memo", "redline", "deviation-report", "executive-summary", "red-flags"] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

export const DELIVERABLE_FORMAT: Readonly<Record<DeliverableKind, "docx" | "xlsx" | "md">> = {
  "issues-memo": "docx",
  redline: "docx",
  "deviation-report": "xlsx",
  "executive-summary": "docx",
  "red-flags": "md",
};

export type LegalSide = {
  /** e.g. "borrower", "lender", "buyer", "seller", or free text. */
  role: string;
  /** Client name as it should appear in the deliverables. */
  party: string;
  /** Counterparty label, e.g. "the Lenders". */
  counterparty: string;
};

/** A document in the matter after ingest. Text lives in the docx reader output; this is the index card. */
export type MatterDocCard = {
  /** Stable citation id: S1, S2 … in path order. PB is reserved for the playbook. */
  id: string;
  name: string;
  path: string;
  mime: string;
  bytes: number;
  sha256: string;
  role: DocRole;
  status: "read" | "skipped";
  skipReason?: string;
  /** Counters from the reader for the preamble and the coverage check. */
  paragraphs: number;
  words: number;
  insertions: number;
  deletions: number;
  definedTerms: number;
  /** First 600 characters of accepted text, for classification. */
  preview: string;
};

export const FINDING_KINDS = ["adverse", "deviation", "unmarked-change", "interaction", "missing", "ok"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const NEGOTIABILITY = ["preferred", "fallback", "walk-away", "reserved"] as const;
export type Negotiability = (typeof NEGOTIABILITY)[number];

export type Citation = {
  /** Document id (S1, PB …). */
  doc: string;
  /** Paragraph anchor in that document, or a checklist / playbook item id, or a cell address for figures. */
  ref: string;
};

export type Finding = {
  id: string;
  clause: string;
  kind: FindingKind;
  /** Verbatim from the counterparty draft. Empty for "missing". Verified in code; dropped if not verbatim. */
  quote: string;
  quoteAnchor: ParagraphAnchor | null;
  title: string;
  why: string;
  severity: Severity;
  negotiability: Negotiability;
  proposedText: string | null;
  basis: readonly Citation[];
  /** Set when an instruction reserves the point or the model is not confident. */
  reservedFor: string | null;
  /** Checklist item ids this finding satisfies or relates to. */
  checklist: readonly string[];
  round: number;
};

export type ChecklistItem = {
  id: string;
  title: string;
  /** Regex-free keywords used by the mapper to locate the clause; the model confirms. */
  keywords: readonly string[];
  preferred: string;
  fallback: string;
  walkAway: string;
  required: boolean;
};

export type Playbook = {
  id: string;
  title: string;
  contractType: string;
  items: readonly ChecklistItem[];
};

export type VerifyCheckCode =
  | "quotes-verbatim"
  | "numbers-traced"
  | "xrefs-resolve"
  | "defined-terms"
  | "facts-match"
  | "instructions-obeyed"
  | "docx-valid"
  | "coverage";

export type VerifyCheck = {
  code: VerifyCheckCode;
  passed: number;
  failed: number;
  /** Human-readable failures, each fixable by stage 7. */
  failures: readonly VerifyFailure[];
};

export type VerifyFailure = {
  code: VerifyCheckCode;
  deliverable: DeliverableKind | "findings";
  /** Finding id, clause id, or section heading the failure points at. */
  target: string;
  detail: string;
  /** True when code can fix it without a model call. */
  autoFixable: boolean;
};

export type ChecklistVerdict = {
  itemId: string;
  deliverable: DeliverableKind;
  pass: boolean;
  reason: string;
};

export type Concession = {
  clause: string;
  detail: string;
  /** "market" means the verifier judged it acceptable and it is reported, not fixed. */
  disposition: "fix" | "market" | "reserved";
};

export type VerifyReport = {
  round: number;
  codeChecks: readonly VerifyCheck[];
  checklist: readonly ChecklistVerdict[];
  concessions: readonly Concession[];
  documentsSkipped: readonly { doc: string; reason: string }[];
  openForHuman: readonly { clause: string; detail: string }[];
  ok: boolean;
};

export type MemoSection = {
  heading: string;
  /** Paragraphs. A paragraph may reference findings with {{F3}} tokens, which code expands to the finding title and citation. */
  paragraphs: readonly string[];
  /** Optional table: rendered by code from the findings whose ids are listed. */
  findingsTable?: readonly string[];
};

export type MemoOutline = {
  to: string;
  from: string;
  date: string;
  re: string;
  privileged: boolean;
  sections: readonly MemoSection[];
};

export type EditPatch = {
  round: number;
  target: { deliverable: DeliverableKind | "findings"; ref: string };
  reason: VerifyCheckCode | "checklist" | "concession";
  /** For findings: a replacement Finding. For memo: a replacement MemoSection. For redline: replacement proposedText. */
  replacement: unknown;
  appliedBy: "code" | "model";
};

export type RoundRecord = {
  round: number;
  verify: VerifyReport;
  edits: readonly EditPatch[];
};

export type LegalManifest = {
  harness: "agentforge-legal/1";
  matterId: string;
  createdAt: string;
  side: LegalSide;
  workType: LegalWorkType;
  deliverables: readonly DeliverableKind[];
  playbookId: string | null;
  docs: readonly MatterDocCard[];
  models: { drafting: string; verifier: string };
  rounds: readonly RoundRecord[];
  maxRounds: number;
  findingsCount: number;
  status: "running" | "complete" | "complete-with-failures" | "cancelled" | "failed";
};

export const LEGAL_CAPS = {
  maxFiles: 60,
  maxTotalBytes: 100 * 1024 * 1024,
  maxFileBytes: 40 * 1024 * 1024,
  maxInstructionChars: 4_000,
  maxRounds: 3,
  reviewConcurrency: 3,
  maxInteractions: 10,
  retrievedPassages: 5,
  previewChars: 600,
  checklistChunk: 10,
} as const;
