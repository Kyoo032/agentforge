"use client";

import type { Finding } from "@agentforge/core/legal";
import { basisLabel, severityLabel, severityTone, type StreamedFinding } from "@/lib/legal-view";
import { DIM, LegalPanel, TD, TH, ToneTag } from "@/components/legal-parts";

type Props = {
  label: string;
  findings: readonly Finding[];
  emptyText: string;
};

const QUOTE = `${TD} italic ${DIM}`;

/** Screen 3: Clause · Provision · Why it is adverse · Severity · Proposed language · Basis. */
export function LegalFindingsTable({ label, findings, emptyText }: Props) {
  return (
    <LegalPanel label={label} aside="sorted by severity" testId="legal-findings">
      {findings.length === 0 ? (
        <p className={`mt-2 text-sm ${DIM}`}>{emptyText}</p>
      ) : (
        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[96px]`}>Clause</th>
              <th className={`${TH} w-[210px]`}>Provision</th>
              <th className={TH}>Why it is adverse</th>
              <th className={`${TH} w-[70px]`}>Severity</th>
              <th className={`${TH} w-[230px]`}>Proposed language</th>
              <th className={`${TH} w-[110px]`}>Basis</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding) => (
              <tr key={finding.id} data-testid="legal-finding-row">
                <td className={TD}>
                  {finding.clause}
                  <br />
                  <span className={`text-[11px] ${DIM}`}>{finding.title}</span>
                </td>
                <td className={QUOTE}>{finding.quote ? `“${finding.quote}”` : "—"}</td>
                <td className={TD}>{finding.why}</td>
                <td className={TD}>
                  <ToneTag tone={severityTone(finding)}>{severityLabel(finding)}</ToneTag>
                </td>
                <td className={finding.proposedText ? QUOTE : `${TD} ${DIM}`}>
                  {finding.proposedText
                    ? `“${finding.proposedText}”`
                    : finding.reservedFor
                      ? `[Reserved for ${finding.reservedFor}]`
                      : "—"}
                </td>
                <td className={`${TD} font-mono text-[11px]`}>{basisLabel(finding.basis) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </LegalPanel>
  );
}

/** Screen 2: the compact table filled from streamed step details. */
export function LegalStreamedFindings({ findings }: { findings: readonly StreamedFinding[] }) {
  return (
    <LegalPanel
      label="Findings so far"
      aside="streaming · final list after verification"
      testId="legal-findings-stream"
    >
      {findings.length === 0 ? (
        <p className={`mt-2 text-sm ${DIM}`}>Findings appear here as each provision is reviewed.</p>
      ) : (
        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>Clause</th>
              <th className={TH}>Finding</th>
              <th className={TH}>Severity</th>
              <th className={TH}>Source</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding, index) => (
              <tr key={`${finding.clause}-${index}`} data-testid="legal-finding-row">
                <td className={TD}>{finding.clause}</td>
                <td className={TD}>{finding.title}</td>
                <td className={TD}>
                  <ToneTag tone={severityTone(finding)}>{severityLabel(finding)}</ToneTag>
                </td>
                <td className={`${TD} font-mono text-[11px]`}>{finding.basis || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </LegalPanel>
  );
}
