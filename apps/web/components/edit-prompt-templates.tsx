"use client";

import {
  PROMPT_GUIDE_RULES,
  PROMPT_TEMPLATE_CATEGORIES,
  promptTemplateById,
  promptTemplatesFor,
  type PromptTemplate,
  type PromptTemplateCategory,
} from "@agentforge/core/edit";
import { useMemo, useState } from "react";

type Props = {
  onPick: (template: PromptTemplate) => void;
  selectedId: string | null;
};

const CATEGORY_BTN = "btn whitespace-nowrap px-1.5 py-0.5 text-[12px]";

function TemplateSource({ template }: { template: PromptTemplate }) {
  const { source, tips } = template;
  return (
    <div
      className="rounded-md border border-mist bg-paper px-2 py-1.5 text-[12px] text-ink/70"
      data-testid="edit-prompt-template-source"
    >
      <p className="text-ink">
        From {source.site}: {source.title}
        {source.section ? <span className="text-ink/60"> ({source.section})</span> : null}
      </p>
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="block truncate underline text-ink/60 hover:text-ink"
        title={source.url}
      >
        {source.url}
      </a>
      {source.note ? <p className="mt-1 text-ink/60">{source.note}</p> : null}
      {tips.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PromptGuide() {
  return (
    <details className="rounded-md border border-mist px-2 py-1 text-[12px]" data-testid="edit-prompt-guide">
      <summary className="cursor-pointer select-none text-ink/70">Prompting rules</summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink/70">
        {PROMPT_GUIDE_RULES.map((rule) => (
          <li key={rule.id}>
            {rule.text} <span className="text-ink/45">({rule.source.site})</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function EditPromptTemplates({ onPick, selectedId }: Props) {
  const [category, setCategory] = useState<PromptTemplateCategory | null>(null);
  const templates = useMemo(() => promptTemplatesFor(category ?? undefined), [category]);
  const selected = selectedId ? promptTemplateById(selectedId) : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs" data-testid="edit-prompt-templates">
      <p className="text-[12px] text-ink/50">Start from a prompt template</p>
      <div className="flex min-w-0 flex-wrap gap-1" data-testid="edit-prompt-template-categories">
        <button
          type="button"
          className={`${CATEGORY_BTN} ${category === null ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={category === null}
          data-testid="edit-prompt-template-category-all"
          onClick={() => setCategory(null)}
        >
          All
        </button>
        {PROMPT_TEMPLATE_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${CATEGORY_BTN} ${category === item.id ? "btn-primary" : "btn-secondary"}`}
            aria-pressed={category === item.id}
            data-testid={`edit-prompt-template-category-${item.id}`}
            onClick={() => setCategory(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {templates.length === 0 ? (
        <p className="text-[12px] text-ink/50">No templates in this category.</p>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto" data-testid="edit-prompt-template-list">
          {templates.map((template) => {
            const isSelected = template.id === selectedId;
            return (
              <li key={template.id}>
                <button
                  type="button"
                  className={`w-full rounded-md border px-2 py-1 text-left ${
                    isSelected ? "border-ink bg-mist/40 text-ink" : "border-mist text-ink hover:bg-mist/30"
                  }`}
                  aria-pressed={isSelected}
                  data-testid={`edit-prompt-template-${template.id}`}
                  title={template.title}
                  onClick={() => onPick(template)}
                >
                  <span className="block truncate">{template.title}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[12px] text-ink/50">
                    <span className="rounded border border-mist px-1 leading-4">{template.aspect}</span>
                    <span>{template.seconds}s</span>
                    <span className="truncate">{template.source.site}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selected ? <TemplateSource template={selected} /> : null}
      <PromptGuide />
    </div>
  );
}
