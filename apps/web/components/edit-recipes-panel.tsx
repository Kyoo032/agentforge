"use client";

import { RECIPES } from "@agentforge/core/edit";

type Props = {
  onRun: (recipeId: string, name: string) => void;
};

export function EditRecipesPanel({ onRun }: Props) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm">
      <p className="text-xs text-[var(--text-3)]">Each step becomes its own card after Go.</p>
      <ul className="space-y-1">
        {RECIPES.map((recipe) => (
          <li key={recipe.id}>
            <button
              type="button"
              className="w-full rounded-md border border-[var(--line)] px-2 py-1.5 text-left text-xs hover:bg-[var(--line)]/30"
              data-testid={`edit-recipe-${recipe.id}`}
              onClick={() => onRun(recipe.id, recipe.name)}
            >
              {recipe.name}
              <span className="mt-0.5 block text-xs text-[var(--text-3)]">
                {recipe.steps.length} step{recipe.steps.length === 1 ? "" : "s"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
