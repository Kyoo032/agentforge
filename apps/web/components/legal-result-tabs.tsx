"use client";

import type { ReactNode } from "react";
import type { Finding, LegalManifest } from "@agentforge/core/legal";
import { basisLabel } from "@/lib/legal-view";
import { DIM, LegalPanel, manifestStatusText, roleText, TD, TH, ToneTag } from "@/components/legal-parts";
import { t } from "@/lib/i18n";

/** Redline tab: the download plus a preview of each change the redline carries. */
export function LegalRedlinePreview({ findings, action }: { findings: readonly Finding[]; action: ReactNode }) {
  const patches = findings.filter((finding) => finding.proposedText !== null && finding.kind !== "ok");
  return (
    <LegalPanel label={t("legal.redline.title")} aside={t("legal.redline.aside")} testId="legal-redline">
      <div className="mt-2">{action ?? <p className={`text-sm ${DIM}`}>{t("legal.redline.none")}</p>}</div>
      {patches.length === 0 ? (
        <p className={`mt-3 text-sm ${DIM}`}>{t("legal.redline.noProposed")}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {patches.map((finding) => (
            <li key={finding.id} className="border-t border-divider pt-3 text-[13px]" data-testid="legal-redline-row">
              <div className="font-medium">
                {finding.clause} · {finding.title}
              </div>
              <p className="mt-1 leading-relaxed">
                {finding.quote ? <del className="text-[var(--danger)]">{finding.quote}</del> : null}{" "}
                <ins className="text-[var(--ok)] underline">{finding.proposedText}</ins>
              </p>
              <p className={`mt-1 text-xs ${DIM}`}>
                {finding.title}. {t("legal.redline.basis", { basis: basisLabel(finding.basis) || "—" })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </LegalPanel>
  );
}

const STATUS_TONE = {
  running: "neutral",
  complete: "green",
  "complete-with-failures": "amber",
  cancelled: "amber",
  failed: "red",
} as const;

/** Audit trail tab: the manifest as a human-readable record. */
export function LegalAuditTrail({ manifest, runId }: { manifest: LegalManifest; runId: string }) {
  const read = manifest.docs.filter((doc) => doc.status === "read");
  const skipped = manifest.docs.filter((doc) => doc.status === "skipped");
  return (
    <LegalPanel
      label={t("legal.audit.title")}
      aside={t("legal.audit.aside", { harness: manifest.harness, runId })}
      testId="legal-audit"
    >
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
        <ToneTag tone={STATUS_TONE[manifest.status] ?? "neutral"}>{manifestStatusText(manifest.status)}</ToneTag>
        <span className="tag tag-neutral">{t("legal.audit.model", { model: manifest.models.drafting })}</span>
        <span className="tag tag-neutral">{t("legal.audit.verifier", { model: manifest.models.verifier })}</span>
        <span className="tag tag-neutral">
          {t("legal.audit.rounds", { count: manifest.rounds.length, total: manifest.maxRounds })}
        </span>
        <span className="tag tag-neutral">{t("legal.audit.findings", { count: manifest.findingsCount })}</span>
        {manifest.playbookId ? (
          <span className="tag tag-neutral">{t("legal.audit.playbook", { id: manifest.playbookId })}</span>
        ) : null}
        <span className={`text-xs ${DIM}`}>{manifest.createdAt}</span>
      </div>

      <div className="panel-label mt-4">{t("legal.audit.docsRead")}</div>
      <table className="mt-1 w-full border-collapse">
        <thead>
          <tr>
            <th className={TH}>{t("legal.audit.id")}</th>
            <th className={TH}>{t("legal.audit.document")}</th>
            <th className={TH}>{t("legal.audit.role")}</th>
            <th className={TH}>{t("legal.audit.words")}</th>
          </tr>
        </thead>
        <tbody>
          {read.map((doc) => (
            <tr key={doc.id}>
              <td className={`${TD} font-mono text-xs`}>{doc.id}</td>
              <td className={TD}>{doc.name}</td>
              <td className={TD}>{roleText(doc.role)}</td>
              <td className={`${TD} ${DIM}`}>{doc.words.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {skipped.length > 0 ? (
        <>
          <div className="panel-label mt-4">{t("legal.audit.docsSkipped")}</div>
          <ul className="mt-1 space-y-1 text-xs">
            {skipped.map((doc) => (
              <li key={doc.id}>
                <span className="font-mono text-xs">{doc.id}</span> {doc.name}
                <span className={` ${DIM}`}> · {doc.skipReason ?? t("legal.audit.noText")}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="panel-label mt-4">{t("legal.audit.roundsHeading")}</div>
      {manifest.rounds.length === 0 ? (
        <p className={`mt-1 text-sm ${DIM}`}>{t("legal.audit.noRounds")}</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs">
          {manifest.rounds.map((round) => {
            const failed = round.verify.codeChecks.reduce((sum, check) => sum + check.failed, 0);
            const edits = round.edits.length;
            const vars = {
              round: round.round,
              failed,
              edits,
              editWord: t(edits === 1 ? "legal.audit.editOne" : "legal.audit.editMany"),
            };
            return (
              <li key={round.round}>
                {t(round.verify.ok ? "legal.audit.roundPassed" : "legal.audit.roundFailed", vars)}
              </li>
            );
          })}
        </ul>
      )}
    </LegalPanel>
  );
}
