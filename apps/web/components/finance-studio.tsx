"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useSearchParams } from "@/lib/nav";
import { FinanceExportMenu } from "@/components/finance-export-menu";
import { applyBriefDraft, briefDraftOf, briefInputsBody } from "@/components/finance-steps/brief";
import { FinanceComingSoon } from "@/components/finance-steps/finance-coming-soon";
import type { FinanceSource } from "@/components/finance-steps/finance-inputs-panel";
import { FinancePhaseStrip } from "@/components/finance-steps/finance-phase-strip";
import { FinancePromptBar } from "@/components/finance-steps/finance-prompt-bar";
import { FinanceResultNotices } from "@/components/finance-steps/finance-result-notices";
import { FinanceResultPanel } from "@/components/finance-steps/finance-result-panel";
import { financeStepsFor } from "@/components/finance-steps/registry";
import type { FinanceStepDraft, FinanceStepPayload } from "@/components/finance-steps/types";
import { JobProgressList } from "@/components/job-progress";
import type { JobRegenSubmit } from "@/components/job-regen-panel";
import { listDatasets, type DatasetSummary } from "@/lib/data-client";
import { briefLooksLikeFigures, parseFailureMessage } from "@/lib/finance-brief";
import {
  parseFinanceFigures,
  regenerateFinanceSection,
  usableLineItems,
  type FinanceParams,
  type FinanceResult,
  type LineItem,
  type StatedFact,
} from "@/lib/finance-client";
import { loadFinanceDraft, saveFinanceDraft } from "@/lib/finance-drafts";
import { financePhaseLabel } from "@/lib/finance-phase-label";
import {
  FINANCE_PATH,
  financeTaskAvailable,
  financeTaskHint,
  financeTaskLabel,
  financeTaskPhases,
  taskFromParam,
  type FinanceTask,
} from "@/lib/finance-task";
import { useJobModel } from "@/lib/use-job-model";
import { useJobStream } from "@/lib/use-job-stream";
import { useProductBrand } from "@/lib/product-brand";
import { useWorkspaceScope } from "@/lib/workspace-scope";
import { getLocale, t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";
import { SettingsLinkHint } from "@/components/settings-link-hint";


function needsSettingsHint(message: string): boolean {
  return /gateway|api key|settings|runtime_stub|live gateway/i.test(message);
}

export function FinanceStudio() {
  const { productName } = useProductBrand();
  const { models, model, pinned: modelPinned, setModel } = useJobModel("finance");
  const job = useJobStream<FinanceResult>();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { id: workspaceId } = useWorkspaceScope();
  const uiLocale = getLocale();

  /*
   * The task is chosen in the rail, so the URL owns it. This pane is kept
   * mounted behind the other work modes, and off `/finance` the query string
   * belongs to whatever page is showing — so the last task seen on `/finance`
   * is what stays active rather than the default silently taking over.
   */
  const onFinance = pathname === FINANCE_PATH;
  const urlTask = taskFromParam(searchParams.get("task"));
  const lastTaskRef = useRef<FinanceTask>(urlTask);
  const task = onFinance ? urlTask : lastTaskRef.current;

  const available = financeTaskAvailable(task);
  const scopeKey = `${workspaceId ?? ""}|${task}`;
  const lastScopeRef = useRef(scopeKey);
  const initialDraft = useRef(loadFinanceDraft(workspaceId, task));

  const [prompt, setPrompt] = useState(initialDraft.current.prompt);
  const [figures, setFigures] = useState(initialDraft.current.figures);
  const [items, setItems] = useState<LineItem[]>([]);
  /** A document's prose, and the figures it states in a sentence. Both stay empty for a spreadsheet. */
  const [proseText, setProseText] = useState("");
  const [statedFacts, setStatedFacts] = useState<StatedFact[]>([]);
  const [params, setParams] = useState<FinanceParams>({});
  const [source, setSource] = useState<FinanceSource>({ kind: "items" });
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [result, setResult] = useState<FinanceResult | null>(null);
  const [busy, setBusy] = useState<"parse" | "autoParse" | "regen" | null>(null);
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const error = localError ?? job.error?.message ?? null;
  const locked = job.busy || busy !== null;
  const confirmedItems = usableLineItems(items);
  const ready = source.kind === "dataset" || confirmedItems.length > 0;
  const generateLabel =
    busy === "autoParse" ? t("finance.autoParsing") : job.busy ? t("finance.generating") : t("finance.generate");
  const taskName = labeled(`finance.tasks.${task}.label`, financeTaskLabel(task, uiLocale));
  const taskTip = labeled(`finance.tasks.${task}.hint`, financeTaskHint(task, uiLocale));

  useEffect(() => {
    let cancelled = false;
    listDatasets().then(
      (list) => {
        if (!cancelled) {
          setDatasets(list);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Each task asks for its own inputs, so a task switch swaps the whole draft
   * rather than carrying half a cash-flow paste into the brief. The scope is
   * the desk and the task together: two desks never share one draft either.
   */
  useEffect(() => {
    if (lastScopeRef.current === scopeKey) {
      return;
    }
    lastScopeRef.current = scopeKey;
    lastTaskRef.current = task;
    const draft = loadFinanceDraft(workspaceId, task);
    setPrompt(draft.prompt);
    setFigures(draft.figures);
    setItems([]);
    setProseText("");
    setStatedFacts([]);
    setParams({});
    setSource({ kind: "items" });
    setResult(null);
    setLocalError(null);
    setNotice(null);
  }, [scopeKey, workspaceId, task]);

  /* Remember what is typed, but never under a scope the fields do not belong to yet. */
  useEffect(() => {
    if (lastScopeRef.current !== scopeKey) {
      return;
    }
    saveFinanceDraft(workspaceId, task, { prompt, figures });
  }, [scopeKey, workspaceId, task, prompt, figures]);

  /*
   * The studio is a shell: it owns the state, the task owns the steps. One bag of this task's draft
   * goes down, one partial patch comes back — so four task flows can be built in parallel without
   * any of them reaching into this file.
   */
  const steps = financeStepsFor(task);
  const StepInputs = steps.Inputs;
  const StepResult = steps.Result ?? FinanceResultPanel;
  const briefState = { figures, items, params, source, datasets, parsing: busy === "parse", proseText, statedFacts };
  const briefDraft = briefDraftOf(briefState);

  function onStepDraft(patch: FinanceStepDraft): void {
    applyBriefDraft(patch, { setFigures, setItems, setParams, setSource, setProseText, setStatedFacts });
  }

  function onStepAction(payload: FinanceStepPayload): void {
    if (payload.kind === "parse") {
      void onParse();
    }
  }

  function inputsBody(): Record<string, unknown> {
    return { ...briefInputsBody(briefState), task };
  }

  async function onParse() {
    if (!figures.trim() || locked) {
      return;
    }
    setBusy("parse");
    setLocalError(null);
    setNotice(null);
    job.reset();
    try {
      const parsed = await parseFinanceFigures(figures, { model, task, proseText });
      setItems(parsed.items);
      setStatedFacts(parsed.statedFacts);
      setSource({ kind: "items" });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t("finance.errors.parse"));
    } finally {
      setBusy(null);
    }
  }

  /** Brief-only figures: read them into rows and stop; the owner confirms rows before anything is computed. */
  async function autoParseBrief(brief: string) {
    setBusy("autoParse");
    setLocalError(null);
    setNotice(null);
    job.reset();
    try {
      const parsed = await parseFinanceFigures(brief, { model, task, proseText });
      if (parsed.items.length === 0) {
        setLocalError(t("finance.errors.addItems"));
        return;
      }
      setItems(parsed.items);
      setStatedFacts(parsed.statedFacts);
      setSource({ kind: "items" });
      setNotice(t("finance.autoParsed", { n: parsed.items.length }));
    } catch (err) {
      setLocalError(parseFailureMessage(err, t("finance.errors.parse"), t("finance.errors.addItems")));
    } finally {
      setBusy(null);
    }
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    const brief = prompt.trim();
    if (!brief || locked) {
      return;
    }
    if (!ready) {
      if (briefLooksLikeFigures(brief)) {
        await autoParseBrief(brief);
        return;
      }
      setNotice(null);
      setLocalError(t("finance.errors.addItems"));
      return;
    }
    setLocalError(null);
    setNotice(null);
    // Only a deliberate pick travels: a seeded default must stay rescuable by the host's fallback.
    const pick = { model: model || undefined, ...(modelPinned ? { modelPinned: true } : {}) };
    const next = await job.run("/api/v1/finance/stream", { prompt: brief, ...pick, ...inputsBody() });
    if (next) {
      setResult(next);
      if (source.kind === "dataset") {
        setItems(next.items);
      }
    }
  }

  async function onRegenerate(index: number, payload: JobRegenSubmit) {
    if (!result || locked) {
      return;
    }
    setBusy("regen");
    setRegenIndex(index);
    setLocalError(null);
    try {
      setResult(
        await regenerateFinanceSection({
          brief: result.brief,
          sectionIndex: index,
          prompt,
          instruction: payload.instruction,
          model: payload.model || model || undefined,
          modelPinned: Boolean(payload.model) || modelPinned,
          artifactId: result.artifactId ?? undefined,
          inputs: inputsBody(),
        }),
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t("finance.errors.regen"));
    } finally {
      setBusy(null);
      setRegenIndex(null);
    }
  }

  return (
    <main className="px-6 pb-10 pt-8 text-[var(--text)]" data-testid="finance-studio">
      <div className="kicker">{t("finance.kicker")}</div>
      <div className="mb-3 flex flex-wrap items-end gap-4">
        <div>
          <h3 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{t("finance.title")}</h3>
          {/* The task is picked in the rail; this only names the one that is open. */}
          <div className="mt-1.5 flex flex-col gap-0.5" role="group" aria-label={t("finance.taskAria")}>
            <span className="text-sm font-medium text-[var(--text)]" title={taskTip} data-testid="finance-task-current">
              {taskName}
            </span>
            <span className="max-w-xl text-xs text-[var(--text-3)]" data-testid="finance-task-hint">
              {taskTip}
            </span>
          </div>
          <p className="mt-1.5 max-w-xl text-sm text-[var(--text-2)]">{t("finance.subtitle", { productName })}</p>
        </div>
        {/* Excel by default, the deck and the document behind the chevron. The brief on screen is what is sent. */}
        {result && available ? (
          <div className="ml-auto">
            <FinanceExportMenu
              result={result}
              task={task}
              report={result.report}
              artifactId={result.artifactId}
              workspaceId={workspaceId}
              disabled={locked}
            />
          </div>
        ) : null}
      </div>
      <div className="mb-5">
        <FinancePhaseStrip phases={financeTaskPhases(task)} />
      </div>
      {error ? (
        <p className="mb-4 text-sm text-[var(--danger)]" role="alert" data-testid="finance-error">
          {error}
          {needsSettingsHint(error) && !/settings/i.test(error) ? (
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
        <div className="grid items-start gap-5 lg:[grid-template-columns:420px_minmax(0,1fr)]">
          <StepInputs
            task={task}
            workspaceId={workspaceId}
            locked={locked}
            model={model}
            onGenerate={onStepAction}
            draft={briefDraft}
            setDraft={onStepDraft}
          />
          <div className="space-y-4">
            {job.busy || (job.progress.phases.length > 0 && !result) ? (
              <JobProgressList
                progress={job.progress}
                busy={job.busy}
                testId="finance-progress"
                labelFor={financePhaseLabel}
              />
            ) : null}
            {result ? (
              <>
                <FinanceResultNotices result={result} />
                <StepResult
                  result={result}
                  task={task}
                  locale={uiLocale}
                  models={models}
                  defaultModel={model}
                  regeneratingIndex={regenIndex}
                  onRegenerate={(index, payload) => void onRegenerate(index, payload)}
                  disabled={locked}
                />
              </>
            ) : job.busy ? null : (
              <div
                className="wash rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-8 text-center text-[var(--text-2)]"
                data-testid="finance-studio-empty"
              >
                <p>{ready ? t("finance.emptyReady") : t("finance.emptyWait")}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <FinanceComingSoon task={task} locale={uiLocale} />
      )}
      {available ? (
        <FinancePromptBar
          prompt={prompt}
          onPrompt={setPrompt}
          onSubmit={(event) => void onGenerate(event)}
          onCancel={job.cancel}
          models={models}
          model={model}
          onModel={setModel}
          locked={locked}
          running={job.busy}
          submitLabel={generateLabel}
        />
      ) : null}
    </main>
  );
}
