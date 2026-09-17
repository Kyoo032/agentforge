"use client";

import type { ComponentProps, FormEvent } from "react";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ModelSelect } from "@/components/model-select";
import { t } from "@/lib/i18n";

/**
 * The instruction bar under the task's steps. It is the studio's one submit, so
 * it is rendered only for a task that actually runs — a task that is not built
 * yet shows no way to start something the host would refuse.
 */
export function FinancePromptBar({
  prompt,
  onPrompt,
  onSubmit,
  onCancel,
  models,
  model,
  onModel,
  locked,
  running,
  submitLabel,
}: {
  prompt: string;
  onPrompt: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  models: ComponentProps<typeof ModelSelect>["models"];
  model: string;
  onModel: (value: string) => void;
  locked: boolean;
  running: boolean;
  submitLabel: string;
}) {
  return (
    <form
      className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      onSubmit={onSubmit}
      data-testid="finance-studio-prompt-bar"
    >
      <div className="mb-2 flex items-center gap-2">
        <EnhancePromptButton
          text={prompt}
          surface="finance"
          model={model}
          disabled={locked}
          testId="finance-enhance"
          onApply={onPrompt}
        />
        <ModelSelect models={models} value={model} onChange={onModel} disabled={locked} testId="finance-studio-model" />
      </div>
      <div className="flex gap-2">
        <input
          value={prompt}
          onChange={(event) => onPrompt(event.target.value)}
          className="input min-w-0 flex-1"
          placeholder={t("finance.promptPlaceholder")}
          disabled={locked}
          data-testid="finance-prompt"
        />
        {running ? (
          <button type="button" className="btn" onClick={onCancel} data-testid="finance-cancel">
            {t("finance.cancel")}
          </button>
        ) : null}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={locked || !prompt.trim()}
          data-testid="finance-generate"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
