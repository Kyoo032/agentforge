"use client";

import type { VerifyReport } from "@agentforge/core/legal";
import { codeCheckLabel, verifyRows } from "@/lib/legal-view";
import { DIM, LegalPanel, ToneTag } from "@/components/legal-parts";

type Props = { verify: VerifyReport | null };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="panel-label">{title}</div>
      {children}
    </div>
  );
}

/** Screen 3, Verification tab. */
export function LegalVerifyReport({ verify }: Props) {
  if (!verify) {
    return (
      <LegalPanel label="Verification report" testId="legal-verify">
        <p className={`mt-2 text-sm ${DIM}`}>No verification report was produced for this run.</p>
      </LegalPanel>
    );
  }
  const rows = verifyRows(verify);
  const failures = verify.codeChecks.flatMap((check) => check.failures);
  const failedChecklist = verify.checklist.filter((item) => !item.pass);

  return (
    <LegalPanel
      label="Verification report"
      aside={`round ${verify.round} · ${verify.ok ? "passed" : "completed with failures"}`}
      testId="legal-verify"
    >
      <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="contents" data-testid={`legal-verify-${row.key}`}>
            <span>{row.label}</span>
            <ToneTag tone={row.tone}>{row.value}</ToneTag>
          </div>
        ))}
      </div>

      {failures.length > 0 ? (
        <Section title="Code check failures">
          <ul className="mt-1 space-y-1 text-xs">
            {failures.map((failure, index) => (
              <li key={`${failure.code}-${failure.target}-${index}`}>
                <span className="font-medium">{codeCheckLabel(failure.code)}</span> · {failure.deliverable} ·{" "}
                <span className="font-mono text-xs">{failure.target}</span>: {failure.detail}
                {failure.autoFixable ? <span className={` ${DIM}`}> (corrected in code)</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {failedChecklist.length > 0 ? (
        <Section title="Checklist items not satisfied">
          <ul className="mt-1 space-y-1 text-xs">
            {failedChecklist.map((item) => (
              <li key={`${item.itemId}-${item.deliverable}`}>
                <span className="font-mono text-xs">{item.itemId}</span> · {item.deliverable}: {item.reason}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {verify.concessions.length > 0 ? (
        <Section title="Concessions found by opposing counsel">
          <ul className="mt-1 space-y-1 text-xs">
            {verify.concessions.map((item, index) => (
              <li key={`${item.clause}-${index}`}>
                <span className="font-medium">{item.clause}</span>: {item.detail}{" "}
                <span className="tag tag-neutral">{item.disposition}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {verify.documentsSkipped.length > 0 ? (
        <Section title="Documents skipped">
          <ul className="mt-1 space-y-1 text-xs">
            {verify.documentsSkipped.map((item) => (
              <li key={item.doc}>
                <span className="font-mono text-xs">{item.doc}</span>: {item.reason}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {verify.openForHuman.length > 0 ? (
        <Section title="Requires partner decision">
          <ul className="mt-1 space-y-1 text-xs">
            {verify.openForHuman.map((item, index) => (
              <li key={`${item.clause}-${index}`}>
                <span className="font-medium">{item.clause}</span>: {item.detail}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </LegalPanel>
  );
}
