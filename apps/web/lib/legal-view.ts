import type { JobPhaseState } from "@agentforge/core/jobs";
import type {
  Citation,
  DeliverableKind,
  DocRole,
  Finding,
  LegalSide,
  LegalWorkType,
  MatterDocCard,
  Severity,
  VerifyCheckCode,
  VerifyReport,
} from "@agentforge/core/legal";
import { DOC_ROLES, DOC_ROLE_PRIORITY, LEGAL_CAPS } from "@agentforge/core/legal";
import { z } from "zod";

/** Form state for a matter before and after it exists on the host. */
export type LegalDraft = {
  title: string;
  side: LegalSide;
  workType: LegalWorkType;
  deliverables: DeliverableKind[];
  instructions: string;
  playbookId: string | null;
  author: string;
  addressee: string;
  firm: string;
};

export const DEFAULT_LEGAL_DRAFT: LegalDraft = {
  title: "",
  side: { role: "borrower", party: "", counterparty: "" },
  workType: "review",
  deliverables: ["issues-memo", "redline", "deviation-report", "red-flags"],
  instructions: "",
  playbookId: null,
  author: "",
  addressee: "",
  firm: "",
};

/** Form values lifted from a stored matter (reopen, next turn). */
export function draftFromMatter(matter: LegalDraft & { docs?: unknown }): LegalDraft {
  return {
    title: matter.title,
    side: { ...matter.side },
    workType: matter.workType,
    deliverables: [...matter.deliverables],
    instructions: matter.instructions,
    playbookId: matter.playbookId,
    author: matter.author,
    addressee: matter.addressee,
    firm: matter.firm,
  };
}

export type PendingUpload = { name: string; status: "queued" | "uploading" | "done" | "failed" };

export const SIDE_ROLE_OPTIONS = ["borrower", "lender", "other"] as const;

export const WORK_TYPE_LABEL: Readonly<Record<LegalWorkType, string>> = {
  review: "Review",
  markup: "Markup",
  draft: "Draft",
  analyze: "Analyze",
};

export const WORK_TYPE_PROGRESSIVE: Readonly<Record<LegalWorkType, string>> = {
  review: "Reviewing",
  markup: "Marking up",
  draft: "Drafting",
  analyze: "Analysing",
};

export const ARTIFACT_BUTTON_LABEL: Readonly<Record<DeliverableKind, string>> = {
  redline: "Redline .docx",
  "issues-memo": "Memo .docx",
  "deviation-report": "Deviations .xlsx",
  "red-flags": "Red flags .md",
  "executive-summary": "Summary .docx",
};

export const DELIVERABLE_OPTIONS: readonly {
  kind: DeliverableKind;
  label: string;
  format: string;
  available: boolean;
}[] = [
  { kind: "issues-memo", label: "Issues memorandum", format: "DOCX", available: true },
  { kind: "redline", label: "Redlined agreement, tracked changes", format: "DOCX", available: true },
  { kind: "deviation-report", label: "Deviation report", format: "XLSX", available: true },
  { kind: "red-flags", label: "Red-flags summary", format: "MD", available: true },
  { kind: "executive-summary", label: "Executive summary for client", format: "DOCX", available: false },
];

export function deliverableLabel(kind: DeliverableKind): string {
  return DELIVERABLE_OPTIONS.find((option) => option.kind === kind)?.label ?? kind;
}

/** Run needs at least one uploaded document, a client name, and no upload in flight. */
export function canRun(draft: LegalDraft, docCount: number, uploading: boolean): boolean {
  return docCount > 0 && draft.side.party.trim().length > 0 && !uploading;
}

export function nextDocRole(role: DocRole): DocRole {
  const index = DOC_ROLES.indexOf(role);
  return DOC_ROLES[(index + 1) % DOC_ROLES.length];
}

export function roleLabel(role: DocRole): string {
  return role.replace(/-/g, " ");
}

const MAX_PRIORITY = Math.max(...Object.values(DOC_ROLE_PRIORITY));

/** "Wins on conflict" rank from DOC_ROLE_PRIORITY; the drafts under review have no rank. */
export function rankLabel(role: DocRole): string {
  if (role === "counterparty-draft" || role === "our-draft") {
    return "—";
  }
  const rank = DOC_ROLE_PRIORITY[role];
  if (rank === MAX_PRIORITY) {
    return "last";
  }
  const suffix = rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th";
  return `${rank}${suffix}`;
}

export function docNotes(card: MatterDocCard): string {
  if (card.status === "skipped") {
    return `Skipped · ${card.skipReason ?? "no readable text"}`;
  }
  const parts = [`${card.paragraphs} paragraphs`, `${card.words.toLocaleString()} words`];
  if (card.insertions || card.deletions) {
    parts.push(`${card.insertions} insertions`, `${card.deletions} deletions`);
  }
  if (card.definedTerms) {
    parts.push(`${card.definedTerms} defined terms`);
  }
  return parts.join(" · ");
}

export type MatterMapRow = { role: DocRole; documents: string; rank: string; notes: string };

const MAP_NAMES_SHOWN = 2;

/** One row per role present, ordered by source priority, documents joined. */
export function matterMapRows(docs: readonly MatterDocCard[]): MatterMapRow[] {
  const byRole = new Map<DocRole, MatterDocCard[]>();
  for (const card of docs) {
    byRole.set(card.role, [...(byRole.get(card.role) ?? []), card]);
  }
  return [...byRole.entries()]
    .sort((a, b) => DOC_ROLE_PRIORITY[a[0]] - DOC_ROLE_PRIORITY[b[0]])
    .map(([role, cards]) => {
      const names = cards.slice(0, MAP_NAMES_SHOWN).map((card) => card.name);
      const more = cards.length - names.length;
      return {
        role,
        documents: more > 0 ? `${names.join(" · ")} + ${more} more` : names.join(" · "),
        rank: rankLabel(role),
        notes: cards.length === 1 ? docNotes(cards[0]) : `${cards.length} documents`,
      };
    });
}

export function whatWillHappen(draft: LegalDraft, docCount: number, playbookTitle: string | null): string[] {
  const side = draft.side.role === "other" ? draft.side.party || "the client" : `the ${draft.side.role}`;
  const files = docCount === 1 ? "1 file" : `${docCount} files`;
  const deliverables = draft.deliverables.map((kind) => deliverableLabel(kind).toLowerCase()).join(", ") || "no files";
  return [
    `Ingest ${files}, classify roles and source priority`,
    `${WORK_TYPE_LABEL[draft.workType]} the counterparty draft against the executed documents, the instructions${
      playbookTitle ? ` and the playbook ${playbookTitle}` : ""
    }, from the side of ${side}`,
    `Draft ${deliverables}`,
    "Verify in code: defined terms, cross-references, numbers traced, quotations verbatim, docx valid",
    `Verify with a second model as opposing counsel and against the checklist, then edit and re-verify. Up to ${LEGAL_CAPS.maxRounds} rounds.`,
    "Deliver the adverse provisions, the missing provisions, the verification report and the files",
  ];
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export const FINDING_TABS = ["adverse", "missing", "unmarked"] as const;
export type FindingTab = (typeof FINDING_TABS)[number];

export const RESULT_TABS = [
  { id: "adverse", label: "Adverse provisions" },
  { id: "missing", label: "Missing provisions" },
  { id: "unmarked", label: "Unmarked changes" },
  { id: "verification", label: "Verification" },
  { id: "redline", label: "Redline" },
  { id: "memo", label: "Memo" },
  { id: "audit", label: "Audit trail" },
] as const;
export type ResultTab = (typeof RESULT_TABS)[number]["id"];

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { high: 0, medium: 1, low: 2 };

export function sortBySeverity(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Split findings by tab; "ok" findings are never shown. */
export function groupFindingsByTab(findings: readonly Finding[]): Record<FindingTab, Finding[]> {
  const adverse = findings.filter((f) => f.kind === "adverse" || f.kind === "deviation" || f.kind === "interaction");
  const missing = findings.filter((f) => f.kind === "missing");
  const unmarked = findings.filter((f) => f.kind === "unmarked-change");
  return { adverse: sortBySeverity(adverse), missing: sortBySeverity(missing), unmarked: sortBySeverity(unmarked) };
}

/** Findings reserved for a human plus verifier items not already covered by a reserved clause. */
export function partnerDecisionCount(findings: readonly Finding[], verify: VerifyReport | null): number {
  const reserved = findings.filter((f) => f.reservedFor !== null);
  const reservedClauses = new Set(reserved.map((f) => f.clause));
  const open = verify?.openForHuman.filter((item) => !reservedClauses.has(item.clause)) ?? [];
  return reserved.length + open.length;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function resultHeadline(findings: readonly Finding[], verify: VerifyReport | null): string {
  const groups = groupFindingsByTab(findings);
  const partner = partnerDecisionCount(findings, verify);
  return `Review complete · ${plural(groups.adverse.length, "adverse provision")}, ${plural(
    groups.missing.length,
    "missing provision",
  )}, ${partner} ${partner === 1 ? "item" : "items"} for partner decision`;
}

export function basisLabel(basis: readonly Citation[]): string {
  return basis.map((citation) => `${citation.doc} ${citation.ref}`.trim()).join(" · ");
}

export function severityLabel(finding: Pick<Finding, "severity" | "reservedFor">): string {
  if (finding.reservedFor !== null) {
    return "Open";
  }
  return finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1);
}

export type Tone = "red" | "amber" | "green" | "neutral";

export function severityTone(finding: Pick<Finding, "severity" | "reservedFor">): Tone {
  if (finding.reservedFor !== null) {
    return "amber";
  }
  return finding.severity === "high" ? "red" : finding.severity === "medium" ? "amber" : "neutral";
}

// ---------------------------------------------------------------------------
// Streamed findings (screen 2). step.detail may carry a JSON summary; anything else is ignored.
// ---------------------------------------------------------------------------

export type StreamedFinding = {
  clause: string;
  title: string;
  severity: Severity;
  basis: string;
  reservedFor: string | null;
};

const streamedFindingSchema = z.object({
  clause: z.string().min(1),
  title: z.string().min(1),
  severity: z.enum(["high", "medium", "low"]).catch("low"),
  basis: z.array(z.object({ doc: z.string(), ref: z.string().default("") })).default([]),
  reservedFor: z.string().nullable().default(null),
});

export const STREAMED_FINDING_PHASES: ReadonlySet<string> = new Set(["review", "missing", "interactions"]);

export function parseStreamedFinding(detail: string | undefined): StreamedFinding | null {
  if (!detail || !detail.trim().startsWith("{")) {
    return null;
  }
  try {
    const parsed = streamedFindingSchema.safeParse(JSON.parse(detail));
    if (!parsed.success) {
      return null;
    }
    const { basis, ...rest } = parsed.data;
    return { ...rest, basis: basisLabel(basis) };
  } catch {
    return null;
  }
}

export function streamedFindings(phases: readonly JobPhaseState[]): StreamedFinding[] {
  return phases
    .filter((phase) => STREAMED_FINDING_PHASES.has(phase.phase))
    .flatMap((phase) => phase.steps.flatMap((step) => parseStreamedFinding(step.detail) ?? []));
}

// ---------------------------------------------------------------------------
// Verification report rows
// ---------------------------------------------------------------------------

export const CODE_CHECK_LABEL: Readonly<Record<VerifyCheckCode, string>> = {
  "defined-terms": "Defined terms used consistently",
  "xrefs-resolve": "Cross-references resolve",
  "numbers-traced": "Numbers traced to a source cell or computation",
  "quotes-verbatim": "Quotations verbatim in the cited document",
  "facts-match": "Names, dates, parties match sources",
  "instructions-obeyed": "Instructions obeyed",
  "docx-valid": "Redline .docx opens and validates",
  coverage: "Documents read are cited",
};

export function codeCheckLabel(code: string): string {
  return (CODE_CHECK_LABEL as Record<string, string>)[code] ?? code;
}

export type VerifyRow = { key: string; label: string; value: string; tone: Tone };

export function verifyRows(verify: VerifyReport): VerifyRow[] {
  const checks = verify.codeChecks.map((check) => ({
    key: check.code,
    label: codeCheckLabel(check.code),
    value: check.passed + check.failed === 0 ? "pass" : `${check.passed}/${check.passed + check.failed}`,
    tone: (check.failed === 0 ? "green" : "amber") as Tone,
  }));
  const checklistPass = verify.checklist.filter((item) => item.pass).length;
  const concessions = verify.concessions.filter((item) => item.disposition !== "fix").length;
  const partner = verify.openForHuman.length;
  return [
    ...checks,
    {
      key: "checklist",
      label: "Checklist, second model",
      value: verify.checklist.length === 0 ? "—" : `${checklistPass}/${verify.checklist.length}`,
      tone: checklistPass === verify.checklist.length ? "green" : "amber",
    },
    {
      key: "opposing",
      label: "Opposing-counsel pass",
      value: concessions === 0 ? "pass" : `${plural(concessions, "concession")} left`,
      tone: concessions === 0 ? "green" : "amber",
    },
    {
      key: "skipped",
      label: "Documents skipped",
      value: String(verify.documentsSkipped.length),
      tone: verify.documentsSkipped.length === 0 ? "green" : "amber",
    },
    {
      key: "partner",
      label: "Requires partner decision",
      value: String(partner),
      tone: partner === 0 ? "green" : "amber",
    },
  ];
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
