"use client";

import type { ReactNode } from "react";
import type {
  DeliverableKind,
  DocRole,
  Finding,
  LegalManifest,
  LegalWorkType,
  VerifyReport,
} from "@agentforge/core/legal";
import {
  ARTIFACT_BUTTON_LABEL,
  codeCheckLabel,
  deliverableLabel,
  groupFindingsByTab,
  partnerDecisionCount,
  roleLabel,
  WORK_TYPE_LABEL,
  WORK_TYPE_PROGRESSIVE,
  type ResultTab,
  type Tone,
  type VerifyRow,
} from "@/lib/legal-view";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";

type PanelProps = { label: string; aside?: ReactNode; children: ReactNode; testId?: string; className?: string };

export function LegalPanel({ label, aside, children, testId, className = "" }: PanelProps) {
  return (
    <section
      className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 ${className}`}
      data-testid={testId}
    >
      <div className="flex items-center gap-2">
        <div className="panel-label">{label}</div>
        {aside ? <span className="ml-auto text-xs text-[var(--text-3)]">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  red: "tag border-[var(--danger)] text-[var(--danger)]",
  amber: "tag border-[var(--line)] bg-[var(--accent-soft)] text-[var(--text)]",
  green: "tag border-[var(--ok)] text-[var(--ok)]",
  neutral: "tag border-[var(--line)] text-[var(--text-2)]",
};

export function ToneTag({ tone, children, testId }: { tone: Tone; children: ReactNode; testId?: string }) {
  return (
    <span className={TONE_CLASS[tone]} data-testid={testId}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Catalog copy for the result screens. `lib/legal-view` keeps English labels as the
// fallback; these read `legal.*` so an `id` desk sees Indonesian chrome.
// ---------------------------------------------------------------------------

export function roleText(role: DocRole): string {
  return labeled(`legal.role.${role}`, roleLabel(role));
}

export function deliverableText(kind: DeliverableKind): string {
  return labeled(`legal.deliverable.${kind}`, deliverableLabel(kind));
}

export function artifactButtonText(kind: DeliverableKind): string {
  return labeled(`legal.artifactButton.${kind}`, ARTIFACT_BUTTON_LABEL[kind] ?? kind);
}

export function workTypeText(workType: LegalWorkType): string {
  return labeled(`legal.workType.${workType}`, WORK_TYPE_LABEL[workType] ?? workType);
}

export function workTypeProgressiveText(workType: LegalWorkType): string {
  return labeled(`legal.workTypeProgressive.${workType}`, WORK_TYPE_PROGRESSIVE[workType] ?? workType);
}

export function severityText(finding: Pick<Finding, "severity" | "reservedFor">): string {
  return finding.reservedFor !== null ? t("legal.findings.open") : t(`legal.findings.${finding.severity}`);
}

export function codeCheckText(code: string): string {
  return labeled(`legal.verify.${code}`, codeCheckLabel(code));
}

const TAB_KEY: Readonly<Record<ResultTab, string>> = {
  adverse: "tabAdverse",
  missing: "tabMissing",
  unmarked: "tabUnmarked",
  verification: "tabVerification",
  redline: "tabRedline",
  memo: "tabMemo",
  audit: "tabAudit",
};

export function resultTabText(tab: ResultTab, fallback: string): string {
  return labeled(`legal.result.${TAB_KEY[tab]}`, fallback);
}

const STATUS_KEY: Readonly<Record<LegalManifest["status"], string>> = {
  running: "statusRunning",
  complete: "statusComplete",
  "complete-with-failures": "statusFailures",
  cancelled: "statusCancelled",
  failed: "statusFailed",
};

export function manifestStatusText(status: LegalManifest["status"]): string {
  const key = STATUS_KEY[status];
  return key ? t(`legal.audit.${key}`) : status;
}

export function resultHeadlineText(findings: readonly Finding[], verify: VerifyReport | null): string {
  const groups = groupFindingsByTab(findings);
  const adverse = groups.adverse.length;
  const missing = groups.missing.length;
  const partner = partnerDecisionCount(findings, verify);
  return t("legal.result.headline", {
    adverse,
    adverseWord: t(adverse === 1 ? "legal.result.adverseOne" : "legal.result.adverseMany"),
    missing,
    missingWord: t(missing === 1 ? "legal.result.missingOne" : "legal.result.missingMany"),
    partner,
    partnerWord: t(partner === 1 ? "legal.result.itemOne" : "legal.result.itemMany"),
  });
}

/** Re-label a `verifyRows` row; counts and fractions stay as computed. */
export function verifyRowText(row: VerifyRow, verify: VerifyReport): { label: string; value: string } {
  const label = labeled(`legal.verify.${row.key}`, row.label);
  if (row.value === "pass") {
    return { label, value: t("legal.verify.pass") };
  }
  if (row.key === "opposing") {
    const count = verify.concessions.filter((item) => item.disposition !== "fix").length;
    return { label, value: t(count === 1 ? "legal.verify.concessionLeft" : "legal.verify.concessionsLeft", { count }) };
  }
  return { label, value: row.value };
}

export const TH = "px-2 py-1.5 text-left panel-label whitespace-nowrap";
export const TD = "border-t border-[var(--line)] px-2 py-2 align-top text-sm text-[var(--text)]";
export const DIM = "text-[var(--text-2)]";
