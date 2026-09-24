"use client";

import type { Finding } from "@agentforge/core/legal";
import { basisLabel, severityTone, type StreamedFinding } from "@/lib/legal-view";
import { DIM, LegalPanel, severityText, TD, TH, ToneTag } from "@/components/legal-parts";
import { t } from "@/lib/i18n";

type Props = {
  label: string;
  findings: readonly Finding[];
  emptyText: string;
};

const QUOTE = `${TD} italic ${DIM}`;

/** Screen 3: Clause · Provision · Why it is adverse · Severity · Proposed language · Basis. */
export function LegalFindingsTable({ label, findings, emptyText }: Props) {
  return (
    <LegalPanel label={label} aside={t("legal.findings.sorted")} testId="legal-findings">
      {findings.length === 0 ? (
        <p className={`mt-2 text-sm ${DIM}`}>{emptyText}</p>
      ) : (
        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[96px]`}>{t("legal.findings.clause")}</th>
              <th className={`${TH} w-[210px]`}>{t("legal.findings.provision")}</th>
              <th className={TH}>{t("legal.findings.why")}</th>
              <th className={`${TH} w-[70px]`}>{t("legal.findings.severity")}</th>
              <th className={`${TH} w-[230px]`}>{t("legal.findings.proposed")}</th>
              <th className={`${TH} w-[110px]`}>{t("legal.findings.basis")}</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding) => (
              <tr key={finding.id} data-testid="legal-finding-row">
                <td className={TD}>
                  {finding.clause}
                  <br />
                  <span className={`text-xs ${DIM}`}>{finding.title}</span>
                </td>
                <td className={QUOTE}>{finding.quote ? `“${finding.quote}”` : "—"}</td>
                <td className={TD}>{finding.why}</td>
                <td className={TD}>
                  <ToneTag tone={severityTone(finding)}>{severityText(finding)}</ToneTag>
                </td>
                <td className={finding.proposedText ? QUOTE : `${TD} ${DIM}`}>
                  {finding.proposedText
                    ? `“${finding.proposedText}”`
                    : finding.reservedFor
                      ? t("legal.findings.reserved", { who: finding.reservedFor })
                      : "—"}
                </td>
                <td className={`${TD} font-mono text-xs`}>{basisLabel(finding.basis) || "—"}</td>
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
      label={t("legal.findings.streamTitle")}
      aside={t("legal.findings.streamAside")}
      testId="legal-findings-stream"
    >
      {findings.length === 0 ? (
        <p className={`mt-2 text-sm ${DIM}`}>{t("legal.findings.streamEmpty")}</p>
      ) : (
        <table className="mt-2 w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>{t("legal.findings.clause")}</th>
              <th className={TH}>{t("legal.findings.finding")}</th>
              <th className={TH}>{t("legal.findings.severity")}</th>
              <th className={TH}>{t("legal.findings.source")}</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding, index) => (
              <tr key={`${finding.clause}-${index}`} data-testid="legal-finding-row">
                <td className={TD}>{finding.clause}</td>
                <td className={TD}>{finding.title}</td>
                <td className={TD}>
                  <ToneTag tone={severityTone(finding)}>{severityText(finding)}</ToneTag>
                </td>
                <td className={`${TD} font-mono text-xs`}>{finding.basis || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </LegalPanel>
  );
}
