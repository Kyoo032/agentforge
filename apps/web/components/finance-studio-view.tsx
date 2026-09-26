"use client";

import type { ComponentType, FormEvent, ReactNode } from "react";
import type { FinancePhaseId, FinanceTask } from "@/lib/finance-task";
import type { FinanceResult } from "@/lib/finance-client";
import type { JobStudioModel } from "@/lib/use-job-model";
import type { JobProgress } from "@agentforge/core/jobs";
import { Confetti } from "@/components/confetti";
import { FinanceExportMenu } from "@/components/finance-export-menu";
import { JobProgressList } from "@/components/job-progress";
import { ModeHeader } from "@/components/mode-header";
import { ModeIllustration } from "@/components/mode-illustration";
import { SettingsLinkHint } from "@/components/settings-link-hint";
import { WorkingStatus } from "@/components/working-status";
import { FinanceChooser, FinanceStepTrail } from "@/components/finance-steps/finance-guide";
import { FinancePhaseStrip } from "@/components/finance-steps/finance-phase-strip";
import { FinancePromptFields } from "@/components/finance-steps/finance-prompt-bar";
import { FinanceResultNotices } from "@/components/finance-steps/finance-result-notices";
import type { FinanceResultPanelProps } from "@/components/finance-steps/finance-result-panel";
import type { FinanceStepProps } from "@/components/finance-steps/types";
import { financePhaseLabel } from "@/lib/finance-phase-label";
import { financeTaskLabel } from "@/lib/finance-task";
import { t } from "@/lib/i18n";
import { Link } from "@/lib/nav";

export type FinanceStudioViewProps = {
  showChooser: boolean;
  task: FinanceTask;
  taskName: string;
  taskTip: string;
  locale: "en" | "id";
  available: boolean;
  productName: string;
  error: string | null;
  notice: string | null;
  needsHint: boolean;
  ready: boolean;
  canRead: boolean;
  reading: boolean;
  result: FinanceResult | null;
  landed: number;
  locked: boolean;
  running: boolean;
  generateLabel: string;
  phases: readonly FinancePhaseId[];
  prompt: string;
  onPrompt: (value: string) => void;
  models: JobStudioModel[];
  model: string;
  onModel: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  onRead: () => void;
  workspaceId: string | null;
  regeneratingIndex: number | null;
  onRegenerate: FinanceResultPanelProps["onRegenerate"];
  showProgress: boolean;
  progress: JobProgress;
  StepInputs: ComponentType<FinanceStepProps>;
  StepResult: ComponentType<FinanceResultPanelProps>;
  stepProps: FinanceStepProps;
};

export function FinanceStudioView({
  showChooser,
  task,
  taskName,
  taskTip,
  locale,
  available,
  productName,
  error,
  notice,
  needsHint,
  ready,
  canRead,
  reading,
  result,
  landed,
  locked,
  running,
  generateLabel,
  phases,
  prompt,
  onPrompt,
  models,
  model,
  onModel,
  onSubmit,
  onCancel,
  onRead,
  workspaceId,
  regeneratingIndex,
  onRegenerate,
  showProgress,
  progress,
  StepInputs,
  StepResult,
  stepProps,
}: FinanceStudioViewProps) {
  const step = result ? "result" : "numbers";
  const outcome = showChooser
    ? t("finance.guide.lead")
    : step === "result"
      ? t("finance.guide.resultLead")
      : t("finance.guide.numbersLead");
  return (
    <main
      data-mode="finance"
      className="mx-auto w-full max-w-[var(--content-stage)] px-6 pb-10 pt-8 text-[var(--text)]"
      data-testid="finance-studio"
    >
      <ModeHeader
        icon="finance"
        title={t("finance.title")}
        outcome={outcome}
        outcomeTestId={showChooser ? "finance-guide-lead" : "expected-inputs"}
      />
      {showChooser ? (
        <div className="mt-6">
          <FinanceChooser />
        </div>
      ) : (
        <TaskPath
          task={task}
          taskName={taskName}
          taskTip={taskTip}
          locale={locale}
          available={available}
          productName={productName}
          error={error}
          notice={notice}
          needsHint={needsHint}
          ready={ready}
          canRead={canRead}
          reading={reading}
          result={result}
          landed={landed}
          locked={locked}
          running={running}
          generateLabel={generateLabel}
          phases={phases}
          prompt={prompt}
          onPrompt={onPrompt}
          models={models}
          model={model}
          onModel={onModel}
          onSubmit={onSubmit}
          onCancel={onCancel}
          onRead={onRead}
          workspaceId={workspaceId}
          regeneratingIndex={regeneratingIndex}
          onRegenerate={onRegenerate}
          showProgress={showProgress}
          progress={progress}
          StepInputs={StepInputs}
          StepResult={StepResult}
          stepProps={stepProps}
          step={step}
        />
      )}
    </main>
  );
}

function TaskPath(props: Omit<FinanceStudioViewProps, "showChooser"> & { step: "numbers" | "result" }) {
  const {
    task,
    taskName,
    taskTip,
    locale,
    available,
    productName,
    error,
    notice,
    needsHint,
    ready,
    canRead,
    reading,
    result,
    landed,
    locked,
    running,
    generateLabel,
    phases,
    prompt,
    onPrompt,
    models,
    model,
    onModel,
    onSubmit,
    onCancel,
    onRead,
    workspaceId,
    regeneratingIndex,
    onRegenerate,
    showProgress,
    progress,
    StepInputs,
    StepResult,
    stepProps,
    step,
  } = props;
  return (
    <div className="mt-4">
      <FinanceStepTrail step={step} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div role="group" aria-label={t("finance.taskAria")}>
          <span className="text-sm font-medium text-[var(--text)]" title={taskTip} data-testid="finance-task-current">
            {taskName}
          </span>
          <span
            className="mt-0.5 block max-w-[var(--content-narrow)] text-sm text-[var(--text-2)]"
            data-testid="finance-task-hint"
          >
            {taskTip}
          </span>
          <span
            className="mt-1 block max-w-[var(--content-narrow)] text-xs text-[var(--text-3)]"
            data-testid="finance-task-term"
          >
            {t(`finance.guide.terms.${task}`)}
          </span>
        </div>
        <Link href="/finance" className="text-xs font-medium text-[var(--accent)]" data-testid="finance-guide-change">
          {t("finance.guide.change")}
        </Link>
      </div>
      {error ? (
        <p className="mb-4 text-sm text-[var(--danger)]" role="alert" data-testid="finance-error">
          {error}
          {needsHint && !/settings/i.test(error) ? (
            <>
              {" "}
              <SettingsLinkHint i18nKey="finance.openSettings" />
            </>
          ) : null}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 text-sm text-[var(--text-2)]" role="status" data-testid="finance-auto-parsed">
          {notice}
        </p>
      ) : null}
      {available ? (
        <form onSubmit={onSubmit} data-testid="finance-studio-prompt-bar">
          {step === "result" ? (
            <details
              className="mb-4 rounded-lg border border-[var(--line)] px-3 py-2"
              data-testid="finance-inputs-again"
            >
              <summary className="cursor-pointer select-none text-xs font-medium text-[var(--text-2)]">
                {t("finance.guide.yourNumbers")}
              </summary>
              <div className="mt-3">
                <StepInputs {...stepProps} />
              </div>
            </details>
          ) : (
            <StepInputs {...stepProps} />
          )}
          {step === "numbers" ? (
            <Primary
              task={task}
              result={result}
              ready={ready}
              canRead={canRead}
              reading={reading}
              locked={locked}
              running={running}
              generateLabel={generateLabel}
              onRead={onRead}
              onCancel={onCancel}
              workspaceId={workspaceId}
            />
          ) : null}
          {showProgress ? (
            <div className="mt-4">
              <JobProgressList
                progress={progress}
                busy={running}
                testId="finance-progress"
                labelFor={financePhaseLabel}
              />
            </div>
          ) : null}
          {result ? (
            <div className="enter-rise relative mt-4 space-y-4">
              {landed > 0 ? <Confetti key={landed} /> : null}
              <FinanceResultNotices result={result} />
              <StepResult
                result={result}
                task={task}
                locale={locale}
                models={models}
                defaultModel={model}
                regeneratingIndex={regeneratingIndex}
                onRegenerate={onRegenerate}
                disabled={locked}
              />
            </div>
          ) : running ? null : (
            <div
              className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center text-[var(--text-2)]"
              data-testid="finance-studio-empty"
            >
              <ModeIllustration mode="finance" />
              <p className="mt-4 font-medium text-[var(--text)]">{t("finance.emptyOutcome")}</p>
              <p className="mt-1.5 text-sm text-[var(--text-3)]">
                {ready ? t("finance.emptyReady") : t("finance.emptyWait")}
              </p>
            </div>
          )}
          {step === "result" ? (
            <Primary
              task={task}
              result={result}
              ready={ready}
              canRead={canRead}
              reading={reading}
              locked={locked}
              running={running}
              generateLabel={generateLabel}
              onRead={onRead}
              onCancel={onCancel}
              workspaceId={workspaceId}
            />
          ) : null}
          <details className="mt-4 rounded-lg border border-[var(--line)] px-3 py-2" data-testid="finance-advanced">
            <summary className="cursor-pointer select-none text-xs font-medium text-[var(--text-2)]">
              {t("finance.guide.more")}
            </summary>
            <div className="mt-3 space-y-3">
              <FinancePromptFields
                prompt={prompt}
                onPrompt={onPrompt}
                models={models}
                model={model}
                onModel={onModel}
                locked={locked}
              />
              <details className="mb-5 rounded-lg border border-[var(--line)] px-3 py-2" data-testid="finance-how">
                <summary className="cursor-pointer select-none text-xs font-medium text-[var(--text-2)]">
                  {t("finance.howItWorks")}
                </summary>
                <p className="mt-2 mb-3 max-w-[var(--content-narrow)] text-xs text-[var(--text-3)]">
                  {t("finance.howItWorksBody", { productName })}
                </p>
                <FinancePhaseStrip phases={phases} />
              </details>
              {result ? (
                <button type="submit" className="btn" disabled={locked || !ready} data-testid="finance-generate">
                  {running ? <WorkingStatus label={generateLabel} /> : generateLabel}
                </button>
              ) : null}
            </div>
          </details>
        </form>
      ) : (
        <p
          className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-8 text-center text-[var(--text-2)]"
          role="status"
          data-testid="finance-task-unavailable"
        >
          {t("finance.taskUnavailable", { task: financeTaskLabel(task, locale) })}
        </p>
      )}
    </div>
  );
}

function Primary({
  task,
  result,
  ready,
  canRead,
  reading,
  locked,
  running,
  generateLabel,
  onRead,
  onCancel,
  workspaceId,
}: {
  task: FinanceTask;
  result: FinanceResult | null;
  ready: boolean;
  canRead: boolean;
  reading: boolean;
  locked: boolean;
  running: boolean;
  generateLabel: string;
  onRead: () => void;
  onCancel: () => void;
  workspaceId: string | null;
}) {
  let action: ReactNode;
  if (result) {
    action = (
      <FinanceExportMenu
        result={result}
        task={task}
        report={result.report}
        artifactId={result.artifactId}
        workspaceId={workspaceId}
        disabled={locked}
        emphasis="primary"
      />
    );
  } else if (ready) {
    action = (
      <button type="submit" className="btn btn-primary" disabled={locked} data-testid="finance-generate">
        {running ? <WorkingStatus label={generateLabel} /> : generateLabel}
      </button>
    );
  } else {
    action = (
      <button
        type="button"
        className="btn btn-primary"
        disabled={locked || reading || !canRead}
        onClick={onRead}
        data-testid={task === "ratios" ? "finance-ratios-parse" : "finance-parse"}
      >
        {reading ? <WorkingStatus label={t("finance.parsing")} /> : t("finance.parse")}
      </button>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="finance-primary">
      {action}
      {running ? (
        <button type="button" className="btn" onClick={onCancel} data-testid="finance-cancel">
          {t("finance.cancel")}
        </button>
      ) : null}
    </div>
  );
}
