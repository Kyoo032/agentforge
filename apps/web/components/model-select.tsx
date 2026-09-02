"use client";

import { formatContextLength, pickerGroups } from "@agentforge/core/preferred";

type ChatModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
  /** Optional curation — when present on any model, Everyday/Advanced optgroups activate. */
  friendlyLabel?: string;
  bestFor?: string;
  tier?: "everyday" | "advanced";
};

type Props = {
  models: ChatModel[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  testId?: string;
  showModalities?: boolean;
  className?: string;
};

function hasCurationFields(models: ChatModel[]): boolean {
  return models.some(
    (model) => model.tier != null || model.friendlyLabel != null || model.bestFor != null,
  );
}

function optionLabel(model: ChatModel, showModalities: boolean): string {
  const name = model.friendlyLabel ?? model.label;
  const withHint = model.bestFor ? `${name} — ${model.bestFor}` : name;
  if (showModalities) {
    return `${withHint} (${model.inputModalities.join(" + ")})`;
  }
  if (model.contextLength) {
    return `${withHint} · ${formatContextLength(model.contextLength)}`;
  }
  return withHint;
}

export function ModelSelect({
  models,
  value,
  onChange,
  disabled,
  testId = "model-picker",
  showModalities = false,
  className = "rounded-md border border-mist bg-paper px-3 py-2 text-ink",
}: Props) {
  const curated = hasCurationFields(models);
  const selected = models.some((model) => model.id === value) ? value : (models[0]?.id ?? "");

  const groups = curated
    ? [
        {
          label: "Everyday",
          models: models.filter((model) => model.tier === "everyday"),
        },
        {
          label: "Advanced",
          models: models.filter((model) => model.tier !== "everyday"),
        },
      ].filter((group) => group.models.length > 0)
    : pickerGroups(models);

  return (
    <select
      className={className}
      value={selected}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || models.length === 0}
      data-testid={testId}
    >
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.models.map((model) => (
            <option key={model.id} value={model.id}>
              {optionLabel(model, showModalities)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
