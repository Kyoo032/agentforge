"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useSearchParams } from "@/lib/nav";
import { FinanceStudioView } from "@/components/finance-studio-view";
import { applyBriefDraft, briefDraftOf, briefInputsBody } from "@/components/finance-steps/brief";
import type { FinanceSource } from "@/components/finance-steps/finance-inputs-panel";
import { FinanceReadProvider, type FinanceReadRegistration } from "@/components/finance-steps/finance-read";
import { FinanceResultPanel } from "@/components/finance-steps/finance-result-panel";
import { financeStepsFor } from "@/components/finance-steps/registry";
import type { FinanceStepDraft, FinanceStepPayload } from "@/components/finance-steps/types";
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
import {
  FINANCE_PATH,
  defaultFinancePrompt,
  financeTaskAvailable,
  financeTaskHint,
  financeTaskLabel,
  financeTaskPhases,
  taskFromParam,
  type FinanceTask,
} from "@/lib/finance-task";
import { useJobModel } from "@/lib/use-job-model";
import { regenModelPick } from "@/lib/model-choice";
import { useJobStream } from "@/lib/use-job-stream";
import { useProductBrand } from "@/lib/product-brand";
import { useWorkspaceScope } from "@/lib/workspace-scope";
import { getLocale, t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";

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

  // The rail owns the task via the URL. Off /finance, keep the last task rather than the default.
  const onFinance = pathname === FINANCE_PATH;
  const taskQuery = searchParams.get("task");
  const showChooser = onFinance && (taskQuery == null || taskQuery.trim() === "");
  const urlTask = taskFromParam(taskQuery);
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
  const [landed, setLanded] = useState(0);
  const [customRead, setCustomRead] = useState<FinanceReadRegistration | null>(null);
  const registerRead = useCallback((next: FinanceReadRegistration | null) => {
    setCustomRead(next);
  }, []);

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

  // A task switch swaps the whole draft. Scope is desk plus task, so two desks never share one.
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

  // The studio owns state; the task owns the steps. One draft bag down, one patch back.
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

  function onRead() {
    if (locked) {
      return;
    }
    if (customRead) {
      customRead.run();
      return;
    }
    if (!figures.trim() && briefLooksLikeFigures(prompt)) {
      void autoParseBrief(prompt);
      return;
    }
    void onParse();
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    const language = uiLocale === "id" ? "id" : "en";
    const brief = prompt.trim() || defaultFinancePrompt(task, language);
    if (!brief || locked) {
      return;
    }
    if (!ready) {
      if (briefLooksLikeFigures(prompt)) {
        await autoParseBrief(prompt);
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
      setLanded((count) => count + 1);
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
          ...regenModelPick(payload.model, model, modelPinned),
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

  const language = uiLocale === "id" ? "id" : "en";
  const reading = busy === "parse" || busy === "autoParse" || customRead?.busy === true;
  const canRead = figures.trim().length > 0 || (!customRead && briefLooksLikeFigures(prompt));

  return (
    <FinanceReadProvider register={registerRead}>
      <FinanceStudioView
        showChooser={showChooser}
        task={task}
        taskName={taskName}
        taskTip={taskTip}
        locale={language}
        available={available}
        productName={productName}
        error={error}
        notice={notice}
        needsHint={error ? needsSettingsHint(error) : false}
        ready={ready}
        canRead={canRead}
        reading={reading}
        result={result}
        landed={landed}
        locked={locked}
        running={job.busy}
        generateLabel={generateLabel}
        phases={financeTaskPhases(task)}
        prompt={prompt}
        onPrompt={setPrompt}
        models={models}
        model={model}
        onModel={setModel}
        onSubmit={(event) => void onGenerate(event)}
        onCancel={job.cancel}
        onRead={onRead}
        workspaceId={workspaceId}
        regeneratingIndex={regenIndex}
        onRegenerate={(index, payload) => void onRegenerate(index, payload)}
        showProgress={job.busy || (job.progress.phases.length > 0 && !result)}
        progress={job.progress}
        StepInputs={StepInputs}
        StepResult={StepResult}
        stepProps={{
          task,
          workspaceId,
          locked,
          model,
          onGenerate: onStepAction,
          draft: briefDraft,
          setDraft: onStepDraft,
        }}
      />
    </FinanceReadProvider>
  );
}
