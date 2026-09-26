"use client";

import type { ComponentProps } from "react";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { ModelSelect } from "@/components/model-select";
import { t } from "@/lib/i18n";

/**
 * The optional instruction and the model. They sit inside More options.
 * The primary button lives in one place, under the inputs, not beside this field.
 */
export function FinancePromptFields({
  prompt,
  onPrompt,
  models,
  model,
  onModel,
  locked,
}: {
  prompt: string;
  onPrompt: (value: string) => void;
  models: ComponentProps<typeof ModelSelect>["models"];
  model: string;
  onModel: (value: string) => void;
  locked: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
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
      <input
        value={prompt}
        onChange={(event) => onPrompt(event.target.value)}
        className="input min-w-0 w-full"
        placeholder={t("finance.promptPlaceholder")}
        disabled={locked}
        data-testid="finance-prompt"
      />
    </div>
  );
}
