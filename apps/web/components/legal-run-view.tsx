"use client";

import type { JobProgress } from "@agentforge/core/jobs";
import { streamedFindings, type LegalDraft } from "@/lib/legal-view";
import { JobProgressList } from "@/components/job-progress";
import { LegalStreamedFindings } from "@/components/legal-findings-table";
import {
  deliverableText,
  DIM,
  LegalPanel,
  ToneTag,
  workTypeProgressiveText,
  workTypeText,
} from "@/components/legal-parts";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";

type Props = {
  draft: LegalDraft;
  playbookTitle: string | null;
  progress: JobProgress;
  busy: boolean;
  onCancel: () => void;
};

const SOURCE_TONE = { read: "green", found: "neutral", unreachable: "amber" } as const;
const SOURCE_KEY: Readonly<Record<string, string>> = {
  read: "sourceRead",
  found: "sourceFound",
  unreachable: "sourceSkipped",
};

/** Screen 2: progress on the left, streamed findings and documents on the right. */
export function LegalRunView({ draft, playbookTitle, progress, busy, onCancel }: Props) {
  const side =
    draft.side.role === "other"
      ? draft.side.party || t("legal.plan.theClient")
      : t("legal.plan.theRole", { role: labeled(`legal.side.${draft.side.role}`, draft.side.role) });
  const findings = streamedFindings(progress.phases);

  return (
    <>
      <div className="kicker">
        {t("legal.studio.kickerTitle", { title: draft.title || t("legal.studio.untitled") })}
      </div>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h3 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">
            {t("legal.run.headline", { work: workTypeProgressiveText(draft.workType), side })}
          </h3>
          <p className={`mt-1.5 text-sm ${DIM}`}>
            {workTypeText(draft.workType)} · {draft.deliverables.map(deliverableText).join(", ")}
            {playbookTitle ? t("legal.run.playbookMeta", { title: playbookTitle }) : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {progress.round ? (
            <ToneTag tone="neutral" testId="legal-round">
              {t("legal.run.round", { round: progress.round.round, total: progress.round.total })}
            </ToneTag>
          ) : null}
          <button type="button" className="btn" onClick={onCancel} data-testid="legal-cancel">
            {t("legal.run.cancel")}
          </button>
        </div>
      </div>
      <div className="grid items-start gap-5 lg:[grid-template-columns:480px_minmax(0,1fr)]">
        <LegalPanel label={t("legal.run.progress")}>
          <div className="mt-2">
            <JobProgressList progress={progress} busy={busy} mode="legal" testId="legal-progress" />
          </div>
        </LegalPanel>
        <div className="space-y-4">
          <LegalStreamedFindings findings={findings} />
          <LegalPanel label={t("legal.run.documents")} testId="legal-documents">
            {progress.sources.length === 0 ? (
              <p className={`mt-2 text-sm ${DIM}`}>{t("legal.run.documentsEmpty")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-divider text-[13px]">
                {progress.sources.map((source) => (
                  <li key={source.id} className="flex items-center gap-2 py-1.5">
                    <span className="font-mono text-xs">{source.id}</span>
                    <span className="min-w-0 flex-1 truncate">{source.title || source.url}</span>
                    <ToneTag tone={SOURCE_TONE[source.status] ?? "neutral"}>
                      {SOURCE_KEY[source.status] ? t(`legal.run.${SOURCE_KEY[source.status]}`) : source.status}
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
