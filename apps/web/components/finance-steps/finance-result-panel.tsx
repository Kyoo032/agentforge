"use client";

import { useMemo } from "react";
import { financeReportFromBrief, type ReportLocale } from "@agentforge/core/finance";
import { ArtifactActions } from "@/components/artifact-actions";
import { FinanceBriefView } from "@/components/finance-brief-view";
import { FinanceReportCharts } from "@/components/finance-charts";
import type { JobRegenSubmit } from "@/components/job-regen-panel";
import type { FinanceResult } from "@/lib/finance-client";
import type { JobStudioModel } from "@/lib/use-job-model";

export type FinanceResultPanelProps = {
  result: FinanceResult;
  /** The task the brief was generated for. It rides on the report so every renderer knows it. */
  task: string;
  locale: ReportLocale;
  models: JobStudioModel[];
  defaultModel: string;
  regeneratingIndex: number | null;
  onRegenerate: (index: number, payload: JobRegenSubmit) => void;
  disabled: boolean;
};

/**
 * A finished brief: the shared artifact bar, the report's charts, then the prose.
 *
 * The report is built once from the brief that is on screen and read by the charts; the export
 * menu in the studio header sends that same brief to the host, so the screen, the workbook and
 * the deck can never disagree about a number.
 */
export function FinanceResultPanel({
  result,
  task,
  locale,
  models,
  defaultModel,
  regeneratingIndex,
  onRegenerate,
  disabled,
}: FinanceResultPanelProps) {
  // A task that owns its own maths sends its report back; the brief builds one from its brief. Both
  // end in the same object, so the charts here and the workbook the export writes read the same rows.
  const report = useMemo(
    () => result.report ?? financeReportFromBrief(result.brief, { task, locale, guard: result.guard }),
    [result.report, result.brief, result.guard, task, locale],
  );

  return (
    <>
      <ArtifactActions
        title={result.brief.title}
        markdown={result.markdown}
        artifactId={result.artifactId}
        kbType="Brief"
        disabled={disabled}
        testIdPrefix="finance"
      />
      <FinanceReportCharts report={report} />
      <FinanceBriefView
        brief={result.brief}
        guard={result.guard}
        models={models}
        defaultModel={defaultModel}
        regeneratingIndex={regeneratingIndex}
        onRegenerate={onRegenerate}
      />
    </>
  );
}
