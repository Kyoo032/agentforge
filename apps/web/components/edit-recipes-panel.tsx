"use client";

import { RECIPES } from "@agentforge/core/edit";

type Props = {
  onRun: (recipeId: string, name: string) => void;
};

export function EditRecipesPanel({ onRun }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 text-sm">
      <p className="text-xs text-ink/50">Each step becomes its own card after Go.</p>
      <ul className="space-y-1">
        {RECIPES.map((recipe) => (
          <li key={recipe.id}>
            <button
              type="button"
              className="w-full rounded-md border border-mist px-2 py-1.5 text-left text-xs hover:bg-mist/30"
              data-testid={`edit-recipe-${recipe.id}`}
              onClick={() => onRun(recipe.id, recipe.name)}
            >
              {recipe.name}
              <span className="mt-0.5 block text-[10px] text-ink/45">
                {recipe.steps.length} step{recipe.steps.length === 1 ? "" : "s"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
