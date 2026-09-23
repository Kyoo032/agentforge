"use client";

import { useEffect, useState } from "react";
import { getArtifact } from "@/lib/artifacts-client";
import { downloadLegalArtifact, type LegalArtifactRef, type LegalRunSummary } from "@/lib/legal-client";
import { groupFindingsByTab, RESULT_TABS, type ResultTab } from "@/lib/legal-view";
import { ArtifactActions } from "@/components/artifact-actions";
import { FormattedText } from "@/components/formatted-text";
import { LegalAuditTrail, LegalRedlinePreview } from "@/components/legal-result-tabs";
import { LegalFindingsTable } from "@/components/legal-findings-table";
import { artifactButtonText, DIM, LegalPanel, resultHeadlineText, resultTabText } from "@/components/legal-parts";
import { t } from "@/lib/i18n";
import { LegalVerifyReport } from "@/components/legal-verify-report";

type Props = {
  title: string;
  party: string;
  result: LegalRunSummary;
  locked: boolean;
  onNextTurn: () => void;
  onNewMatter: () => void;
  onError: (message: string | null) => void;
};

function tabCount(tab: ResultTab, groups: ReturnType<typeof groupFindingsByTab>): number | null {
  return tab === "adverse" || tab === "missing" || tab === "unmarked" ? groups[tab].length : null;
}

/** Screen 3: headline, downloads, tabs. */
export function LegalResultView({ title, party, result, locked, onNextTurn, onNewMatter, onError }: Props) {
  const [tab, setTab] = useState<ResultTab>("adverse");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [memoMarkdown, setMemoMarkdown] = useState<string | null>(null);
  const groups = groupFindingsByTab(result.findings);
  const rounds = result.manifest.rounds.length || result.verify?.round || 1;
  const redFlags = result.artifacts.find((artifact) => artifact.kind === "red-flags") ?? null;
  const memo = result.artifacts.find((artifact) => artifact.kind === "issues-memo") ?? null;
  const redline = result.artifacts.find((artifact) => artifact.kind === "redline") ?? null;
  const busy = locked || downloading !== null;

  useEffect(() => {
    let cancelled = false;
    setMemoMarkdown(null);
    if (!redFlags) {
      return;
    }
    getArtifact(redFlags.artifactId).then(
      (record) => {
        if (!cancelled) {
          setMemoMarkdown(record.body);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [redFlags]);

  async function onDownload(artifact: LegalArtifactRef) {
    setDownloading(artifact.kind);
    onError(null);
    try {
      await downloadLegalArtifact(artifact);
    } catch (err) {
      onError(err instanceof Error ? err.message : t("legal.errors.download", { filename: artifact.filename }));
    } finally {
      setDownloading(null);
    }
  }

  function downloadButton(artifact: LegalArtifactRef | null, primary = false) {
    if (!artifact) {
      return null;
    }
    return (
      <button
        type="button"
        className={primary ? "btn btn-primary" : "btn"}
        onClick={() => void onDownload(artifact)}
        disabled={busy}
        data-testid={`legal-download-${artifact.kind}`}
      >
        {downloading === artifact.kind ? t("legal.studio.saving") : artifactButtonText(artifact.kind)}
      </button>
    );
  }

  return (
    <>
      <div className="kicker">{t("legal.studio.kickerTitle", { title })}</div>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="max-w-3xl">
          <h3
            className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]"
            data-testid="legal-result-headline"
          >
            {resultHeadlineText(result.findings, result.verify)}
          </h3>
          <p className={`mt-1.5 text-sm ${DIM}`}>
            {t("legal.result.verified", {
              rounds,
              roundWord: t(rounds === 1 ? "legal.result.roundOne" : "legal.result.roundMany"),
            })}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {result.artifacts.map((artifact) => (
            <span key={artifact.kind}>{downloadButton(artifact)}</span>
          ))}
          <button type="button" className="btn" onClick={onNewMatter} disabled={busy} data-testid="legal-new-matter">
            {t("legal.studio.newMatter")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onNextTurn}
            disabled={busy}
            data-testid="legal-next-turn"
          >
            {t("legal.result.nextTurn")}
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-divider" role="tablist" data-testid="legal-tabs">
        {RESULT_TABS.map((item) => {
          const count = tabCount(item.id, groups);
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                active ? "border-[var(--accent)] font-medium text-[var(--text)]" : `border-transparent ${DIM}`
              }`}
              onClick={() => setTab(item.id)}
              data-testid={`legal-tab-${item.id}`}
            >
              {resultTabText(item.id, item.label)}
              {count !== null ? <span className="ml-1.5 text-xs">{count}</span> : null}
            </button>
          );
        })}
      </div>

      {tab === "adverse" ? (
        <LegalFindingsTable
          label={t("legal.result.adverseLabel", { party: party || t("legal.result.theClient") })}
          findings={groups.adverse}
          emptyText={t("legal.result.adverseEmpty")}
        />
      ) : null}
      {tab === "missing" ? (
        <LegalFindingsTable
          label={t("legal.result.missingLabel")}
          findings={groups.missing}
          emptyText={t("legal.result.missingEmpty")}
        />
      ) : null}
      {tab === "unmarked" ? (
        <LegalFindingsTable
          label={t("legal.result.unmarkedLabel")}
          findings={groups.unmarked}
          emptyText={t("legal.result.unmarkedEmpty")}
        />
      ) : null}
      {tab === "verification" ? <LegalVerifyReport verify={result.verify} /> : null}
      {tab === "redline" ? (
        <LegalRedlinePreview findings={result.findings} action={downloadButton(redline, true)} />
      ) : null}
      {tab === "memo" ? (
        <LegalPanel
          label={t("legal.deliverable.issues-memo")}
          aside={memo?.filename ?? t("legal.result.memoAsideMissing")}
          testId="legal-memo"
        >
          <div className="mt-2 flex flex-wrap gap-2">
            {downloadButton(memo, true)}
            {downloadButton(redFlags)}
          </div>
          {memoMarkdown ? (
            <article className="mt-4 border-t border-divider pt-4">
              <FormattedText text={memoMarkdown} className="text-sm leading-relaxed" testId="legal-memo-text" />
            </article>
          ) : (
            <p className={`mt-3 text-sm ${DIM}`}>
              {redFlags ? t("legal.result.memoLoading") : t("legal.result.memoDownload")}
            </p>
          )}
        </LegalPanel>
      ) : null}
      {tab === "audit" ? <LegalAuditTrail manifest={result.manifest} runId={result.runId} /> : null}

      <LegalPanel label={t("legal.result.handoff")} testId="legal-handoff" className="mt-4">
        <div className="mt-2">
          <ArtifactActions
            title={title}
            markdown={memoMarkdown ?? ""}
            artifactId={redFlags?.artifactId ?? memo?.artifactId ?? null}
            kbType="Memo"
            disabled={busy || (!memoMarkdown && !redFlags && !memo)}
            testIdPrefix="legal"
          />
        </div>
        <p className={`mt-2 text-xs ${DIM}`}>{t("legal.result.disclaimer")}</p>
      </LegalPanel>
    </>
  );
}
