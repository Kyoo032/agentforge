"use client";

import { formatContextLength, pickerGroups } from "@agentforge/core/preferred";

type ChatModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
  /** Optional curation metadata (friendly label / best-for hint). */
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
  /** Skip chat hide-lists so embedding ids stay visible. */
  flat?: boolean;
};

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
  className = "h-8 rounded-lg border border-[var(--line)] bg-transparent px-2 text-xs text-[var(--text-2)] wash",
  flat = false,
}: Props) {
  const selected = models.some((model) => model.id === value) ? value : (models[0]?.id ?? "");

  const groups = flat
    ? [{ label: "Embeddings", models }]
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
