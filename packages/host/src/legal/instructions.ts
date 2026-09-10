import { extractNumbers } from "@agentforge/core/finance";
import {
  documentText,
  findQuote,
  type DocxClause,
  type DocxDocument,
  type DocxValidation,
  type ParagraphChange,
} from "@agentforge/core/docx";
import type { JobEmitter } from "@agentforge/core/jobs";
import {
  applyFindingEdits,
  DELIVERABLE_FORMAT,
  extractXrefs,
  normaliseClauseId,
  type ChecklistItem,
  type DeliverableKind,
  type DocRole,
  type EditPatch,
  type Finding,
  type FindingDraft,
  type MatterDocCard,
  type MemoOutline,
  type VerifyFailure,
} from "@agentforge/core/legal";
import type { LegalMatterRecord } from "./records";

const HOLD_PATTERN = /\b(?:reserve|leave open|do not propose|hold)\b/gi;
const HOLD_WINDOW = 100;
const KEYWORD_MIN = 3;

export type ReservedInstruction = { reservedClause: string; by: string; keyword: string | null };

export type ReviewParsed = { kind: "ok"; clause?: string } | FindingDraft | { findings: FindingDraft[] };

export function scanReserved(sources: readonly { text: string; by: string }[]): ReservedInstruction[] {
  const out: ReservedInstruction[] = [];
  for (const source of sources) {
    for (const match of source.text.matchAll(HOLD_PATTERN)) {
      const at = match.index ?? 0;
      const around = source.text.slice(
        Math.max(0, at - HOLD_WINDOW),
        Math.min(source.text.length, at + match[0].length + HOLD_WINDOW),
      );
      const xrefs = extractXrefs(around);
      if (xrefs.length > 0) {
        for (const reservedClause of xrefs) {
          out.push({ reservedClause, by: source.by, keyword: null });
        }
        continue;
      }
      const quoted = around.match(/["“]([^"”]{3,80})["”]/);
      if (quoted?.[1]) {
        out.push({ reservedClause: quoted[1], by: source.by, keyword: quoted[1] });
        continue;
      }
      const verbAt = around.toLowerCase().indexOf(match[0].toLowerCase());
      const after = around.slice(verbAt + match[0].length).replace(/^[\s:,;-]+/, "");
      const keyword =
        after
          .split(/[.;\n]/)[0]
          ?.trim()
          .slice(0, 80) ?? "";
      if (keyword.length >= KEYWORD_MIN) {
        out.push({ reservedClause: keyword, by: source.by, keyword });
      }
    }
  }
  return out;
}

function matchesReserved(finding: Finding, entry: ReservedInstruction): boolean {
  if (normaliseClauseId(finding.clause) === normaliseClauseId(entry.reservedClause)) {
    return true;
  }
  const needle = (entry.keyword ?? entry.reservedClause).trim().toLowerCase();
  if (needle.length < KEYWORD_MIN) {
    return false;
  }
  return `${finding.clause} ${finding.title} ${finding.why}`.toLowerCase().includes(needle);
}

export function applyReserved(findings: readonly Finding[], reserved: readonly ReservedInstruction[]): Finding[] {
  if (reserved.length === 0) {
    return [...findings];
  }
  return findings.map((finding) => {
    const hit = reserved.find((entry) => matchesReserved(finding, entry));
    return hit
      ? {
          ...finding,
          proposedText: null,
          reservedFor: finding.reservedFor ?? hit.by,
          negotiability: "reserved" as const,
        }
      : finding;
  });
}

export function draftsFromReview(parsed: ReviewParsed): FindingDraft[] {
  if ("findings" in parsed) {
    return parsed.findings.filter((draft) => draft.kind !== "ok");
  }
  if (parsed.kind === "ok") {
    return [];
  }
  return [parsed];
}

export function findingFromDraft(draft: FindingDraft, id: string, round: number, doc: DocxDocument | null): Finding {
  const hit = draft.quote.trim() !== "" && doc ? findQuote(doc, draft.quote) : null;
  return {
    id,
    clause: draft.clause,
    kind: draft.kind,
    quote: hit ? draft.quote : "",
    quoteAnchor: hit?.anchor ?? null,
    title: draft.title,
    why: draft.why,
    severity: draft.severity,
    negotiability: draft.negotiability,
    proposedText: draft.proposedText,
    basis: draft.basis,
    reservedFor: draft.reservedFor,
    checklist: draft.checklist,
    round,
  };
}

export function missingFinding(item: ChecklistItem, id: string, round: number): Finding {
  return {
    id,
    clause: item.id,
    kind: "missing",
    quote: "",
    quoteAnchor: null,
    title: item.title,
    why: `Required provision "${item.title}" is not present in the counterparty draft.`,
    severity: item.required ? "high" : "medium",
    negotiability: "preferred",
    proposedText: item.preferred.trim() === "" ? null : item.preferred,
    basis: [{ doc: "PB", ref: item.id }],
    reservedFor: null,
    checklist: [item.id],
    round,
  };
}

export function pickRelatedClause(finding: Finding, clauses: readonly DocxClause[]): DocxClause | null {
  const self = normaliseClauseId(finding.clause);
  const others = clauses.filter((clause) => normaliseClauseId(clause.id) !== self);
  const xrefs = new Set(extractXrefs(`${finding.clause} ${finding.why} ${finding.quote}`));
  const byXref = others.find((clause) => xrefs.has(normaliseClauseId(clause.id)));
  if (byXref) {
    return byXref;
  }
  const tokens = finding.quote
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 4);
  const byToken = others.find((clause) => {
    const text = `${clause.heading} ${clause.text}`.toLowerCase();
    return tokens.some((token) => text.includes(token));
  });
  return byToken ?? others[0] ?? null;
}

export function autoFixInstructionFindings(
  findings: readonly Finding[],
  failures: readonly VerifyFailure[],
  reserved: readonly ReservedInstruction[],
  round: number,
  author: string,
): { findings: readonly Finding[]; patches: EditPatch[] } {
  const patches: EditPatch[] = failures
    .filter((failure) => failure.autoFixable && failure.code === "instructions-obeyed")
    .map((failure) => {
      const finding = findings.find((item) => item.id === failure.target);
      const by =
        (finding &&
          reserved.find((entry) => normaliseClauseId(entry.reservedClause) === normaliseClauseId(finding.clause))
            ?.by) ||
        author;
      return {
        round,
        target: { deliverable: "findings" as const, ref: failure.target },
        reason: "instructions-obeyed" as const,
        replacement: { proposedText: null, reservedFor: by, negotiability: "reserved" },
        appliedBy: "code" as const,
      };
    });
  const applied = applyFindingEdits(findings, patches);
  return {
    findings: applied.findings,
    patches: patches.filter((patch) => !applied.ignored.includes(patch.target.ref)),
  };
}

export function createIdAllocator(start = 1): { next: () => string } {
  let n = start;
  return {
    next: () => {
      const id = `F${n}`;
      n += 1;
      return id;
    },
  };
}

export const PHASE_LABEL: Readonly<Record<string, string>> = {
  classify: "Classifying documents",
  diff: "Comparing with the prior turn",
  review: "Reviewing provisions",
  missing: "Checking required provisions",
  interactions: "Checking interactions",
  draft: "Drafting deliverables",
  verify: "Verifying",
  edit: "Applying corrections",
  package: "Packaging",
};

export const FILENAME: Readonly<Record<DeliverableKind, string>> = {
  "issues-memo": "issues-memorandum.docx",
  redline: "redline.docx",
  "deviation-report": "deviation-report.xlsx",
  "executive-summary": "executive-summary.docx",
  "red-flags": "red-flags.md",
};

export const MIME: Readonly<Record<"docx" | "xlsx" | "md", string>> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  md: "text/markdown",
};

export type PackedDeliverable = {
  kind: DeliverableKind;
  filename: string;
  mime: string;
  bytes: Uint8Array;
  text: string;
  outline?: MemoOutline | null;
  redline?: { validation: DocxValidation; failed: number } | null;
};

export function emptyPacked(kind: DeliverableKind): PackedDeliverable {
  return {
    kind,
    filename: FILENAME[kind],
    mime: MIME[DELIVERABLE_FORMAT[kind]],
    bytes: new Uint8Array(),
    text: "",
    outline: null,
    redline: null,
  };
}

export function emitPhase(emit: JobEmitter, phase: string): void {
  emit({ type: "job.phase", phase, label: PHASE_LABEL[phase] ?? phase });
}

export function emitStep(
  emit: JobEmitter,
  phase: string,
  label: string,
  extra: { detail?: string; current?: number; total?: number } = {},
): void {
  emit({ type: "job.step", phase, label, ...extra });
}

export function cardByRole(cards: readonly MatterDocCard[], role: DocRole): MatterDocCard | undefined {
  return cards.find((card) => card.role === role && card.status === "read");
}

export function fallbackMemo(matter: LegalMatterRecord, dateIso: string, findings: readonly Finding[]): MemoOutline {
  return {
    to: matter.addressee,
    from: matter.author,
    date: dateIso,
    re: matter.title,
    privileged: true,
    sections: [
      {
        heading: "Summary",
        paragraphs: [`${matter.side.party} reviewed the counterparty draft against ${matter.side.counterparty}.`],
        findingsTable: findings.map((finding) => finding.id),
      },
    ],
  };
}

export function allowedNumbers(docs: ReadonlyMap<string, DocxDocument>): number[] {
  return [
    ...new Set([...docs.values()].flatMap((doc) => extractNumbers(documentText(doc)).map((token) => token.value))),
  ];
}

export function citedDocIds(findings: readonly Finding[]): string[] {
  return [...new Set(findings.flatMap((finding) => finding.basis.map((citation) => citation.doc)))];
}

export function unmarkedFinding(change: ParagraphChange, id: string, round: number, draft: DocxDocument): Finding {
  const quote = change.after.trim();
  const hit = quote === "" ? null : findQuote(draft, quote);
  return {
    id,
    clause: change.clause ?? "unnumbered",
    kind: "unmarked-change",
    quote: hit ? quote : "",
    quoteAnchor: hit?.anchor ?? change.next,
    title: "Unmarked change",
    why: change.before.trim() === "" ? "Paragraph added without a tracked change." : `Prior text: ${change.before}`,
    severity: "medium",
    negotiability: "fallback",
    proposedText: null,
    basis: [{ doc: "S1", ref: change.next ?? change.prior ?? "¶0" }],
    reservedFor: null,
    checklist: [],
    round,
  };
}
