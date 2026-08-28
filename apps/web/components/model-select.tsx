"use client";

import { formatContextLength, pickerGroups } from "@agentforge/core/preferred";

type ChatModel = {
  id: string;
  label: string;
  provider?: string;
  inputModalities: string[];
  contextLength?: number;
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

export function ModelSelect({
  models,
  value,
  onChange,
  disabled,
  testId = "model-picker",
  showModalities = false,
  className = "rounded-md border border-mist bg-paper px-3 py-2 text-ink",
}: Props) {
  const groups = pickerGroups(models);
  const selected = models.some((model) => model.id === value) ? value : (models[0]?.id ?? "");

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
              {showModalities
                ? `${model.label} (${model.inputModalities.join(" + ")})`
                : model.contextLength
                  ? `${model.label} · ${formatContextLength(model.contextLength)}`
                  : model.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
