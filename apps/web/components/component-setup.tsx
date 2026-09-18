"use client";

import { useEffect, useState } from "react";
import type { SetupStage } from "@/lib/components-client";
import { t } from "@/lib/i18n";
import { useProductBrand } from "@/lib/product-brand";
import { useComponentSetup, type ComponentSetupView } from "@/lib/use-component-setup";

/** Same vocabulary as the job progress list: a dot while it runs, a tick when it is behind us. */
const GLYPH: Readonly<Record<SetupStage["state"], string>> = Object.freeze({
  pending: "·",
  running: "●",
  succeeded: "✓",
  skipped: "✓",
  failed: "✕",
});

const TONE: Readonly<Record<SetupStage["state"], string>> = Object.freeze({
  pending: "text-[var(--text-3)]",
  running: "text-[var(--accent)]",
  succeeded: "text-[var(--text-2)]",
  skipped: "text-[var(--text-3)]",
  failed: "text-[var(--danger)]",
});

const DONE_STATES: ReadonlySet<SetupStage["state"]> = new Set<SetupStage["state"]>(["succeeded", "skipped", "failed"]);

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

/** Only worth printing once a stage took long enough for the owner to have noticed it. */
function duration(stage: SetupStage): string | null {
  if (stage.durationMs === undefined || stage.durationMs < 1000) {
    return null;
  }
  return t("onboarding.components.duration", { seconds: (stage.durationMs / 1000).toFixed(1) });
}

/**
 * First-run panel for the optional native components.
 *
 * Purely presentational: it takes the view the hook produced, so the same hook can run without any
 * UI at all from the app shell. It renders nothing when there is nothing to set up, and it never
 * blocks anything — the key form below it stays usable while this runs, fails, or is retried.
 */
export function ComponentSetupPanel({ view }: { view: ComponentSetupView }) {
  const { productName } = useProductBrand();
  const [collapsed, setCollapsed] = useState(false);
  const { component, setup, alreadyRunning, retry, visible } = view;
  const finished = setup.status === "done";

  useEffect(() => {
    if (!finished) {
      return;
    }
    const timer = window.setTimeout(() => setCollapsed(true), 4000);
    return () => window.clearTimeout(timer);
  }, [finished]);

  if (!visible || !component || collapsed) {
    return null;
  }

  const failed = setup.status === "failed";
  const steps = setup.stages.filter((stage) => DONE_STATES.has(stage.state)).length;

  return (
    <div
      className="px-4 py-3 text-xs text-[var(--text-2)]"
      data-testid="component-setup"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm font-medium text-[var(--text)]">{t("onboarding.components.title", { productName })}</p>
      <p className="mt-1">
        {t("onboarding.components.description")}
        {component.bytes > 0 ? ` ${t("onboarding.components.size", { mb: megabytes(component.bytes) })}` : ""}
      </p>
      <div
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--line)]"
        data-testid="component-setup-progress"
        role="progressbar"
        aria-label={t("onboarding.components.title", { productName })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={setup.percent}
      >
        <div
          className={`h-full ${failed ? "bg-[var(--danger)]" : "bg-[var(--accent)]"}`}
          style={{ width: `${setup.percent}%` }}
        />
      </div>
      <p className="mt-1 text-[var(--text-3)]">
        {t("onboarding.components.progress", {
          done: steps,
          total: setup.stages.length,
          percent: setup.percent,
        })}
      </p>
      <ol className="mt-2 space-y-0.5">
        {setup.stages.map((stage) => (
          <li
            key={stage.id}
            className="flex items-baseline gap-2"
            data-testid={`component-setup-stage-${stage.id}`}
            data-stage-state={stage.state}
          >
            <span aria-hidden="true" className={TONE[stage.state]}>
              {GLYPH[stage.state]}
            </span>
            <span className={stage.state === "running" ? "text-[var(--text)]" : undefined}>
              {t(`onboarding.components.steps.${stage.id}`)}
            </span>
            {duration(stage) ? <span className="text-[var(--text-3)]">{duration(stage)}</span> : null}
          </li>
        ))}
      </ol>
      {alreadyRunning ? <p className="mt-2">{t("onboarding.components.alreadyRunning")}</p> : null}
      {finished ? (
        <p className="mt-2 text-[var(--text-2)]" data-testid="component-setup-done">
          {t("onboarding.components.done")}
        </p>
      ) : null}
      {failed ? (
        <div className="mt-2 space-y-1" data-testid="component-setup-error">
          <p className="text-[var(--danger)]">{t(`onboarding.components.errors.${setup.errorCode ?? "unknown"}`)}</p>
          <p className="text-[var(--text-3)]">{t("onboarding.components.worksWithout", { productName })}</p>
          <button
            type="button"
            className="btn btn-secondary px-2 py-0.5 text-xs"
            onClick={retry}
            data-testid="component-setup-retry"
          >
            {t("onboarding.components.retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The same setup, with no UI.
 *
 * An owner who onboarded long ago never sees the onboarding screen, so the shell runs the hook once
 * after the gate opens. A failure is left for the next launch rather than interrupting the desk.
 */
export function ComponentSetupSilent() {
  useComponentSetup();
  return null;
}
