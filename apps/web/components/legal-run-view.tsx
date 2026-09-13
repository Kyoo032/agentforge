"use client";

import type { JobProgress } from "@agentforge/core/jobs";
import {
  deliverableLabel,
  streamedFindings,
  WORK_TYPE_LABEL,
  WORK_TYPE_PROGRESSIVE,
  type LegalDraft,
} from "@/lib/legal-view";
import { JobProgressList } from "@/components/job-progress";
import { LegalStreamedFindings } from "@/components/legal-findings-table";
import { DIM, LegalPanel, ToneTag } from "@/components/legal-parts";

type Props = {
  draft: LegalDraft;
  playbookTitle: string | null;
  progress: JobProgress;
  busy: boolean;
  onCancel: () => void;
};

const SOURCE_TONE = { read: "green", found: "neutral", unreachable: "amber" } as const;
const SOURCE_LABEL = { read: "read", found: "found", unreachable: "skipped" } as const;

/** Screen 2: progress on the left, streamed findings and documents on the right. */
export function LegalRunView({ draft, playbookTitle, progress, busy, onCancel }: Props) {
  const side = draft.side.role === "other" ? draft.side.party : `the ${draft.side.role}`;
  const findings = streamedFindings(progress.phases);

  return (
    <>
      <div className="kicker">Workspace · Legal desk · {draft.title || "Untitled matter"}</div>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h3 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">
            {WORK_TYPE_PROGRESSIVE[draft.workType]} the draft for {side}
          </h3>
          <p className={`mt-1.5 text-sm ${DIM}`}>
            {WORK_TYPE_LABEL[draft.workType]} · {draft.deliverables.map(deliverableLabel).join(", ")}
            {playbookTitle ? ` · playbook ${playbookTitle}` : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {progress.round ? (
            <ToneTag tone="neutral" testId="legal-round">
              Round {progress.round.round} of {progress.round.total}
            </ToneTag>
          ) : null}
          <button type="button" className="btn" onClick={onCancel} data-testid="legal-cancel">
            Cancel
          </button>
        </div>
      </div>
      <div className="grid items-start gap-5 lg:[grid-template-columns:480px_minmax(0,1fr)]">
        <LegalPanel label="Progress">
          <div className="mt-2">
            <JobProgressList progress={progress} busy={busy} testId="legal-progress" />
          </div>
        </LegalPanel>
        <div className="space-y-4">
          <LegalStreamedFindings findings={findings} />
          <LegalPanel label="Documents" testId="legal-documents">
            {progress.sources.length === 0 ? (
              <p className={`mt-2 text-sm ${DIM}`}>Documents are listed as they are read.</p>
            ) : (
              <ul className="mt-2 divide-y divide-divider text-[13px]">
                {progress.sources.map((source) => (
                  <li key={source.id} className="flex items-center gap-2 py-1.5">
                    <span className="font-mono text-xs">{source.id}</span>
                    <span className="min-w-0 flex-1 truncate">{source.title || source.url}</span>
                    <ToneTag tone={SOURCE_TONE[source.status] ?? "neutral"}>
                      {SOURCE_LABEL[source.status] ?? source.status}
                    </ToneTag>
                  </li>
                ))}
              </ul>
            )}
          </LegalPanel>
        </div>
      </div>
    </>
  );
}
