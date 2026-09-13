"use client";

import type { ReactNode } from "react";
import type { Finding, LegalManifest } from "@agentforge/core/legal";
import { basisLabel, roleLabel } from "@/lib/legal-view";
import { DIM, LegalPanel, TD, TH, ToneTag } from "@/components/legal-parts";

/** Redline tab: the download plus a preview of each change the redline carries. */
export function LegalRedlinePreview({ findings, action }: { findings: readonly Finding[]; action: ReactNode }) {
  const patches = findings.filter((finding) => finding.proposedText !== null && finding.kind !== "ok");
  return (
    <LegalPanel label="Redline" aside="tracked changes with a comment per change" testId="legal-redline">
      <div className="mt-2">{action ?? <p className={`text-sm ${DIM}`}>No redline was produced for this run.</p>}</div>
      {patches.length === 0 ? (
        <p className={`mt-3 text-sm ${DIM}`}>No proposed language; nothing to mark up.</p>
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
                {finding.title}. Basis: {basisLabel(finding.basis) || "—"}.
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
    <LegalPanel label="Audit trail" aside={`${manifest.harness} · run ${runId}`} testId="legal-audit">
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
        <ToneTag tone={STATUS_TONE[manifest.status] ?? "neutral"}>{manifest.status}</ToneTag>
        <span className="tag tag-neutral">Model · {manifest.models.drafting}</span>
        <span className="tag tag-neutral">Verifier · {manifest.models.verifier}</span>
        <span className="tag tag-neutral">
          {manifest.rounds.length} of {manifest.maxRounds} rounds
        </span>
        <span className="tag tag-neutral">{manifest.findingsCount} findings</span>
        {manifest.playbookId ? <span className="tag tag-neutral">Playbook · {manifest.playbookId}</span> : null}
        <span className={`text-xs ${DIM}`}>{manifest.createdAt}</span>
      </div>

      <div className="panel-label mt-4">Documents read</div>
      <table className="mt-1 w-full border-collapse">
        <thead>
          <tr>
            <th className={TH}>Id</th>
            <th className={TH}>Document</th>
            <th className={TH}>Role</th>
            <th className={TH}>Words</th>
          </tr>
        </thead>
        <tbody>
          {read.map((doc) => (
            <tr key={doc.id}>
              <td className={`${TD} font-mono text-xs`}>{doc.id}</td>
              <td className={TD}>{doc.name}</td>
              <td className={TD}>{roleLabel(doc.role)}</td>
              <td className={`${TD} ${DIM}`}>{doc.words.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {skipped.length > 0 ? (
        <>
          <div className="panel-label mt-4">Documents skipped</div>
          <ul className="mt-1 space-y-1 text-xs">
            {skipped.map((doc) => (
              <li key={doc.id}>
                <span className="font-mono text-xs">{doc.id}</span> {doc.name}
                <span className={` ${DIM}`}> · {doc.skipReason ?? "no readable text"}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="panel-label mt-4">Rounds</div>
      {manifest.rounds.length === 0 ? (
        <p className={`mt-1 text-sm ${DIM}`}>No verification rounds were recorded.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs">
          {manifest.rounds.map((round) => {
            const failed = round.verify.codeChecks.reduce((sum, check) => sum + check.failed, 0);
            return (
              <li key={round.round}>
                Round {round.round} · {round.verify.ok ? "passed" : `${failed} code check failures`} ·{" "}
                {round.edits.length} {round.edits.length === 1 ? "correction" : "corrections"} applied
              </li>
            );
          })}
        </ul>
      )}
    </LegalPanel>
  );
}
